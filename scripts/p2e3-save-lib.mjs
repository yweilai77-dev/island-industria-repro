// M2.0-P2-E3 存档/读档验收共用库：存档通道触发、存档 JSON 读取、快照归一化与断言辅助。
//
// 存档通道边界：存储读写在前端 realm（localStorage；key 由 __II_TEST_FLAGS__.saveStorageKey 指定）。
// 触发方式（按优先级，二者走完全相同的正式协议）：
//   1) window.__II_TEST_SAVE__ = { save(), restore(), newGame(), readRaw() }（若前端提供）；
//   2) 正式存档 UI 的按钮：.ii-save-btn[data-ii-action=save-request|save-restore|save-new]
//      （元素常驻 DOM，用 DOM click() 触发，不依赖模态框是否可见）。

export const SAVE_HOOK = '__II_TEST_SAVE__';
// 每次运行使用唯一 isolated key：绝不读到上一次运行/本局更早 autosave 的旧存档。
// Date.now() 在模块加载时求值一次，同一次 play 的所有 phase 共用同一个 key。
export const SAVE_KEY = 'island-industria/p2e3-save-reload/' + Date.now();
export const NODE_GEAR = 'tech:gear-manufacture';
export const EXPECTED_PARTS = 11;
// 体积上限：设计文档估算中型工厂 < 20 KB；这里留 3 倍余量防回归。
export const MAX_SAVE_BYTES = 64 * 1024;

/** 构造验收辅助函数（每个 phase 共用同一套；只读游戏状态，不产生任何游戏状态）。 */
export function createSaveHelpers(play, kit) {
  const { assert, state } = kit;
  const sleep = (ms) => play.wait(ms);

  /** 是否存在前端测试入口（可选；没有就走正式 UI 按钮）。 */
  const saveHookAvailable = () => play.page.evaluate(
    (name) => {
      const hook = globalThis[name];
      return typeof hook === 'object' && hook !== null && typeof hook.save === 'function';
    },
    SAVE_HOOK,
  );
  /** 读存档 JSON：优先测试入口，其次正式存储 key（saveStorageKey）。 */
  const readRawSave = () => play.page.evaluate(
    (args) => {
      const hook = globalThis[args.name];
      if (hook && typeof hook.readRaw === 'function') return hook.readRaw();
      try {
        return globalThis.localStorage.getItem(args.key);
      } catch {
        return null;
      }
    },
    { name: SAVE_HOOK, key: SAVE_KEY },
  );
  /** 点正式存档 UI 按钮（元素常驻 DOM，不依赖模态框可见性）。 */
  const clickSaveAction = (action) => play.page.evaluate(
    (value) => {
      const element = document.querySelector('[data-ii-action="' + value + '"]');
      if (!element) return false;
      element.click();
      return true;
    },
    action,
  );
  const triggerSave = async () => {
    if (await saveHookAvailable()) {
      await play.page.evaluate((name) => globalThis[name].save(), SAVE_HOOK);
      return;
    }
    const clicked = await clickSaveAction('save-request');
    assert(clicked, '找不到存档按钮 [data-ii-action=save-request]；前端存档 UI 未挂载');
  };
  const triggerRestore = async () => {
    if (await saveHookAvailable()) {
      await play.page.evaluate((name) => globalThis[name].restore(), SAVE_HOOK);
      return;
    }
    const clicked = await clickSaveAction('save-restore');
    assert(clicked, '找不到存档按钮 [data-ii-action=save-restore]');
  };
  const triggerNewGame = async () => {
    if (await saveHookAvailable()) {
      await play.page.evaluate((name) => globalThis[name].newGame(), SAVE_HOOK);
      return;
    }
    const clicked = await clickSaveAction('save-new');
    assert(clicked, '找不到存档按钮 [data-ii-action=save-new]');
  };
  const waitForSaveUi = async (timeoutMs = 15000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const ready = await play.page.evaluate(
        (name) => typeof globalThis[name] === 'object'
          || document.querySelector('[data-ii-action="save-request"]') !== null,
        SAVE_HOOK,
      );
      if (ready) return;
      await play.advance(0.2);
      await sleep(80);
    }
    throw new Error('前端存档 UI/测试入口未就绪：需要 .ii-save-btn[data-ii-action] 或 ' + SAVE_HOOK);
  };

  const invTotals = (s) => {
    const totals = {};
    for (const entry of s.inventory) totals[entry.itemId] = entry.count;
    return totals;
  };
  const normParts = (s) => s.parts
    .map((part) => ({
      id: part.partId,
      kind: part.kind,
      gx: part.placement.gx,
      gz: part.placement.gz,
      rotation: part.placement.rotation,
      level: part.placement.level,
    }))
    .sort((a, b) => a.id - b.id);
  const normBuildings = (s) => (s.buildings ?? [])
    .map((b) => ({ id: b.id, kind: b.kind, gx: b.gx, gz: b.gz, rotation: b.rotation, level: b.level }))
    .sort((a, b) => a.id - b.id);
  const normResources = (s) => (s.resources ?? [])
    .map((r) => ({ id: r.id, amount: r.amount, depleted: r.depleted }))
    .sort((a, b) => a.id - b.id);
  const normTech = (s) => ({
    unlocked: [...(s.tech?.unlocked ?? [])].sort(),
    delivered: (s.tech?.nodes ?? []).map((node) => ({
      id: node.id,
      delivered: Object.fromEntries(Object.entries(node.delivered ?? {}).sort()),
    })),
  });
  const playerOf = (s) => ({
    x: s.player.position[0],
    z: s.player.position[2],
    level: s.player.level,
  });

  /** 存档 JSON 的 TechState 与 GameRead 科技快照逐节点比较（未交付节点按 0 计）。 */
  const assertTechEqual = (liveState, savedSnapshot) => {
    const liveUnlocked = [...(liveState.tech?.unlocked ?? [])].sort();
    const savedUnlocked = [...(savedSnapshot.tech.unlocked ?? [])].sort();
    assert(JSON.stringify(liveUnlocked) === JSON.stringify(savedUnlocked),
      'tech unlocked mismatch: live=' + JSON.stringify(liveUnlocked) + ' saved=' + JSON.stringify(savedUnlocked));
    for (const node of liveState.tech?.nodes ?? []) {
      const expected = (savedSnapshot.tech.delivered ?? {})[node.id] ?? {};
      for (const [itemId, count] of Object.entries(node.delivered ?? {})) {
        const want = expected[itemId] ?? 0;
        assert(count === want,
          'tech delivered mismatch ' + node.id + '/' + itemId + ': live=' + count + ' saved=' + want);
      }
    }
  };

  const parseSave = (raw) => {
    assert(typeof raw === 'string' && raw.length > 0, 'save hook readRaw() must return the saved JSON string');
    const parsed = JSON.parse(raw);
    assert(parsed.version === 1, 'saved snapshot version must be 1, got ' + String(parsed.version));
    assert(typeof parsed.savedAt === 'string' && !Number.isNaN(Date.parse(parsed.savedAt)), 'saved snapshot must carry ISO savedAt');
    return parsed;
  };

  /** 轮询等待真实世界恢复完成（启动自动恢复是异步的）。 */
  const waitRestored = async (label, predicate, timeoutMs = 30000) => {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
      last = await state();
      if (predicate(last)) return last;
      await play.advance(0.4);
      await sleep(120);
    }
    throw new Error(label + ' timeout; state=' + JSON.stringify({
      parts: (last?.parts ?? []).length,
      inventory: last?.inventory,
      tech: last?.tech?.unlocked,
      player: last ? playerOf(last) : null,
    }));
  };

  return {
    SAVE_HOOK, SAVE_KEY, NODE_GEAR, EXPECTED_PARTS, MAX_SAVE_BYTES,
    sleep, saveHookAvailable, readRawSave, clickSaveAction,
    triggerSave, triggerRestore, triggerNewGame, waitForSaveUi,
    invTotals, normParts, normBuildings, normResources, normTech, playerOf,
    assertTechEqual, parseSave, waitRestored,
  };
}
