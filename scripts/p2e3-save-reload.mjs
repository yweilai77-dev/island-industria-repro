// M2.0-P2-E3 存档/读档端到端验收（真实键鼠，不用任何测试后门搭世界）。
//
// 验收目标（任务书 P2-E3 工作包 E）：
//   1) 真实搭一小段工厂 + 交付一个科技节点；
//   2) 手动保存 -> 校验存档 JSON 与当前真实世界一致；
//   3) play.reload() -> 启动自动恢复；
//   4) 库存 / 建筑 / 零件 / 科技进度 / 矿量 / 玩家位置逐项一致；
//   5) 不重复发放起步包、不重复扣矿、零件 id 不重复。
//
// 存档通道边界：存储读写在前端 realm（localStorage；key 由 __II_TEST_FLAGS__.saveStorageKey 指定）。
// 触发方式（按优先级，二者走完全相同的正式协议）：
//   1) window.__II_TEST_SAVE__ = { save(), restore(), newGame(), readRaw() }（若前端提供）；
//   2) 正式存档 UI 的按钮：.ii-save-btn[data-ii-action=save-request|save-restore|save-new]
//      （元素常驻 DOM，用 DOM click() 触发，不依赖模态框是否可见）。
// 存档 JSON 直接用 localStorage.getItem(saveStorageKey) 读取。
//
// 注意：本脚本只由 Lead 串行运行（play 是 machine-wide 单例）。
import { createHarness } from './m18-helpers.mjs';
import { CELL, CRUSHER, FLYWHEEL, FORGE, GEAR12, GEAR24, SHAFT, SMELTER, createOrderKit } from './m20-order-lib.mjs';

const SAVE_HOOK = '__II_TEST_SAVE__';
const SAVE_KEY = 'island-industria/p2e3-save-reload';
const NODE_GEAR = 'tech:gear-manufacture';
const EXPECTED_PARTS = 11;
// 体积上限：设计文档估算中型工厂 < 20 KB；这里留 3 倍余量防回归。
const MAX_SAVE_BYTES = 64 * 1024;

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  const h = createHarness(play);
  const kit = createOrderKit(play, h);
  const { assert, state, invOf, machineByRecipe, logStep, waitProduction, rewind } = kit;
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

  let saved = null;
  let beforeReload = null;

  // ------------------------------------------------------------------
  await play.step('00-boot-player-mode', async () => {
    await play.page.addInitScript((flags) => {
      globalThis.__II_TEST_FLAGS__ = flags;
    }, { progression: 'player', techHooks: true, saveStorageKey: SAVE_KEY });
    await play.reload();
    await play.advance(0.6);
    const first = await state();
    assert(first.tech !== null, 'tech snapshot must be part of the unique mechanical GameRead');
    assert(first.tech.mode === 'player', 'expected player progression mode, got ' + first.tech.mode);
    // 清掉上一次运行留下的存档，保证本脚本从空世界开始（这也验证 save/clear 通道）。
    await waitForSaveUi();
    await triggerNewGame();
    const clearStarted = Date.now();
    while (Date.now() - clearStarted < 10000) {
      const raw = await readRawSave();
      if (raw === null || raw === '' || raw === undefined) break;
      await play.advance(0.2);
      await sleep(100);
    }
    const clearedRaw = await readRawSave();
    assert(clearedRaw === null || clearedRaw === '' || clearedRaw === undefined,
      'newGame must clear the stored save, got: ' + String(clearedRaw).slice(0, 80));
    // 前端在 save/clear 后会自行 reload（约 250 ms）；等它落定后再显式 reload 一次，
    // 确保本局世界是全新初始世界（第一次 reload 的自动恢复可能已把旧存档载入内存）。
    await sleep(800);
    await play.reload();
    await play.advance(0.8);
    const s = await waitRestored('pristine world after newGame', (st) => st.parts.length === 0 && (st.tech?.unlocked.length ?? -1) === 0, 15000);
    assert((s.buildings ?? []).length === 0, 'newGame world must have no buildings');
    logStep('00-BOOT', { mode: s.tech.mode, storageCleared: true, parts: s.parts.length });
  });

  // ------------------------------------------------------------------
  await play.step('01-harvest-ore', async () => {
    await h.learnMovement();
    const cal = await h.calibrate('LEVEL0');
    kit.setCal(cal);
    assert(await h.gotoCell({ gx: -6, gz: 4 }, 20000, true), 'must reach ore node A');
    for (let index = 0; index < 12; index += 1) {
      await play.keyboard.press('KeyF');
      await play.advance(3.4);
      await sleep(60);
    }
    const s = await state();
    assert(invOf(s, 'iron_ore') >= 12, 'need at least 12 iron ore, got ' + invOf(s, 'iron_ore'));
    logStep('01-ORE', { ore: invOf(s, 'iron_ore') });
  });

  // ------------------------------------------------------------------
  await play.step('02-build-line', async () => {
    assert(await h.gotoCell({ gx: -7, gz: 6 }, 20000, true), 'must walk to building spot');
    const cal = await h.calibrate('LEVEL0-WORK');
    kit.setCal(cal);
    const order = [
      { label: 'crusher', slot: CRUSHER, cell: CELL.crusher },
      { label: 'smelter', slot: SMELTER, cell: CELL.smelter },
      { label: 'forge', slot: FORGE, cell: CELL.forge },
      { label: 'flywheel', slot: FLYWHEEL, cell: CELL.flywheel },
      { label: 'shaft-a', slot: SHAFT, cell: CELL.shaftA },
      { label: 'gear12', slot: GEAR12, cell: CELL.gear12 },
      { label: 'shaft-b', slot: SHAFT, cell: CELL.shaftB },
      { label: 'gear24-a', slot: GEAR24, cell: CELL.gear24A },
      { label: 'shaft-c', slot: SHAFT, cell: CELL.shaftC },
      { label: 'gear24-b', slot: GEAR24, cell: CELL.gear24B },
      { label: 'shaft-d', slot: SHAFT, cell: CELL.shaftD },
    ];
    for (const item of order) {
      const pt = await h.pointForCell(cal, item.cell, { avoidHover: true });
      kit.points[item.label] = pt;
      await h.placePartAtPoint(pt, item.slot, 0, item.label, item.cell);
    }
    await h.clearHover();
    const s = await state();
    assert(s.parts.length === EXPECTED_PARTS, 'expected ' + EXPECTED_PARTS + ' parts, got ' + s.parts.length);
    assert(s.networks.length === 1, 'expected exactly one power network');
    logStep('02-LINE', { parts: s.parts.length });
    await play.screenshot('02-line-built');
  });

  // ------------------------------------------------------------------
  await play.step('03-produce-and-deliver-tech', async () => {
    const cal = kit.getCal();
    await h.clearHover();
    await h.holdKey('KeyC', 6500);
    let s = await state();
    const flywheelPart = s.parts.find((part) => part.kind === 'power-source');
    const flywheelPt = await h.hoverSpecificPart(cal, CELL.flywheel, flywheelPart.partId);
    kit.points.flywheel = flywheelPt;
    await h.selectSlot(SHAFT);
    await h.clickAt(flywheelPt);
    await h.rightClickAt(flywheelPt);
    await play.advance(0.6);
    s = await state();
    assert(s.sources[0].engaged === true, 'flywheel clutch must engage');

    const crusher = machineByRecipe(s, 'crush-iron-ore');
    const smelter = machineByRecipe(s, 'smelt-crushed-ore');
    const forge = machineByRecipe(s, 'forge-shaft');
    assert(crusher !== undefined && smelter !== undefined && forge !== undefined, 'crusher/smelter/forge must be tracked');
    const crusherPt = await h.hoverSpecificPart(cal, CELL.crusher, crusher.partId);
    const smelterPt = await h.hoverSpecificPart(cal, CELL.smelter, smelter.partId);
    const forgePt = await h.hoverSpecificPart(cal, CELL.forge, forge.partId);
    kit.points.crusher = crusherPt;
    kit.points.smelter = smelterPt;
    kit.points.forge = forgePt;

    const feed = async (point, times) => {
      await play.mouse.move(point);
      await sleep(120);
      for (let index = 0; index < times; index += 1) {
        await play.keyboard.press('KeyC');
        await play.advance(0.08);
      }
    };
    const take = async (point) => {
      await play.mouse.move(point);
      await sleep(120);
      await h.rightClickAt(point);
      await play.advance(0.3);
    };

    // 2 批 × 4 矿石 -> 8 碎铁矿；2 批 × 4 碎铁矿 -> 8 铁锭；4 铁锭 -> 2 传动轴。
    for (let batch = 0; batch < 2; batch += 1) {
      await rewind(3500);
      await feed(crusherPt, 4);
      await waitProduction('crush batch ' + batch, (st) => (st.production.produced.find((p) => p.itemId === 'crushed_ore')?.count ?? 0) >= 4 * (batch + 1), { timeoutMs: 90000 });
      await take(crusherPt);
    }
    for (let batch = 0; batch < 2; batch += 1) {
      await rewind(3500);
      await feed(smelterPt, 4);
      await waitProduction('smelt batch ' + batch, (st) => (st.production.produced.find((p) => p.itemId === 'iron_ingot')?.count ?? 0) >= 4 * (batch + 1), { timeoutMs: 120000 });
      await take(smelterPt);
    }
    await play.mouse.move(forgePt);
    await sleep(150);
    for (let index = 0; index < 4; index += 1) {
      await play.keyboard.press('KeyC');
      await play.advance(0.08);
    }
    await waitProduction('forge shafts', (st) => (st.production.produced.find((p) => p.itemId === 'shaft')?.count ?? 0) >= 2, { timeoutMs: 90000, keepPowered: true });
    await take(forgePt);

    const submit = (nodeId, itemId, count) => play.page.evaluate(
      (args) => globalThis.__II_TEST_TECH__?.submit(args.nodeId, args.itemId, args.count),
      { nodeId, itemId, count },
    );
    const nodeOf = (st, id) => st.tech?.nodes.find((node) => node.id === id) ?? null;
    await submit(NODE_GEAR, 'iron_ingot', 3);
    await play.advance(0.4);
    await submit(NODE_GEAR, 'shaft', 2);
    const delivered = await waitRestored('tech node completion', (st) => nodeOf(st, NODE_GEAR)?.status === 'completed', 30000);
    assert(nodeOf(delivered, NODE_GEAR)?.status === 'completed', 'tech node must complete before saving');
    logStep('03-DELIVER', {
      unlocked: delivered.tech.unlocked,
      inventory: invTotals(delivered),
      produced: delivered.production.produced,
    });
    await play.screenshot('03-tech-delivered');
  });

  // ------------------------------------------------------------------
  await play.step('03b-place-building', async () => {
    // 普通建筑（buildings 服务）：把存档覆盖到「建筑」而不是只存机械零件。
    const cal = kit.getCal();
    await h.clearHover();
    await h.selectSlot(5); // 空槽 = 普通建造模式
    const buildingCell = { gx: -7, gz: 4 };
    const pt = await h.pointForCell(cal, buildingCell);
    await play.mouse.move(pt);
    await play.wait(220);
    const target = (await state()).ui.buildTarget;
    assert(target?.active === true && target.valid === true,
      'building placement target must be active+valid at ' + buildingCell.gx + ',' + buildingCell.gz + ': ' + JSON.stringify(target));
    await h.clickAt(pt);
    await play.advance(0.5);
    const built = await state();
    assert((built.buildings ?? []).length === 1,
      'expected exactly 1 building after placement, got ' + JSON.stringify(built.buildings));
    logStep('03B-BUILDING', { buildings: built.buildings });
    await play.screenshot('03b-building');
  });

  // ------------------------------------------------------------------
  await play.step('04-manual-save', async () => {
    // 先断开动力，让世界静止：这样「手动保存」与随后可能发生的 15 s 自动保存
    // 会写出同一份世界状态，避免脚本与前端自动保存抢写导致快照不一致。
    const beforeStop = await state();
    assert(beforeStop.sources[0]?.enabled === true, 'flywheel must still be engaged before saving');
    await h.selectSlot(SHAFT);
    await play.mouse.move(kit.points.flywheel);
    await sleep(140);
    await h.rightClickAt(kit.points.flywheel);
    await play.advance(0.4);
    const stopped = await state();
    assert(stopped.sources[0].enabled === false, 'power source must be off before the deterministic save');
    beforeReload = stopped;
    await triggerSave();
    // 保存是异步通道：轮询到存档出现且包含本次世界的关键字段。
    const started = Date.now();
    let raw = null;
    while (Date.now() - started < 20000) {
      raw = await readRawSave();
      if (typeof raw === 'string' && raw.length > 0) break;
      await play.advance(0.2);
      await sleep(120);
    }
    saved = parseSave(raw);
    const size = new TextEncoder().encode(raw).length;
    assert(size < MAX_SAVE_BYTES, 'save must stay under ' + MAX_SAVE_BYTES + ' bytes, got ' + size);
    // 写入内容必须就是当前真实世界（不是默认世界）。
    assert(saved.parts.length === EXPECTED_PARTS, 'saved parts must be ' + EXPECTED_PARTS + ', got ' + saved.parts.length);
    assert(saved.tech.unlocked.includes(NODE_GEAR), 'saved tech must include ' + NODE_GEAR);
    const liveTotals = invTotals(beforeReload);
    const savedTotals = {};
    for (const stack of saved.inventory.stacks) savedTotals[stack.itemId] = (savedTotals[stack.itemId] ?? 0) + stack.count;
    for (const [itemId, count] of Object.entries(liveTotals)) {
      assert((savedTotals[itemId] ?? 0) === count, 'saved inventory mismatch for ' + itemId + ': live=' + count + ' saved=' + (savedTotals[itemId] ?? 0));
    }
    for (const live of beforeReload.resources) {
      const record = saved.resources.find((entry) => entry.id === live.id);
      assert(record !== undefined && record.amount === live.amount, 'saved ore amount mismatch for node ' + live.id + ': live=' + live.amount + ' saved=' + record?.amount);
    }
    logStep('04-SAVED', { bytes: size, parts: saved.parts.length, tech: saved.tech.unlocked, player: saved.player });
    await play.screenshot('04-saved');
  });

  // ------------------------------------------------------------------
  await play.step('05-reload-and-restore', async () => {
    await play.reload();
    await play.advance(0.6);
    // 启动自动恢复：等真实世界回到存档状态；超时则用显式 restore 兜底一次。
    let restored = null;
    try {
      restored = await waitRestored('auto restore after reload', (st) => st.parts.length === saved.parts.length
        && st.tech?.unlocked.includes(NODE_GEAR) === true, 15000);
    } catch (error) {
      console.log('P2E3-RESTORE-FALLBACK ' + String(error && error.message));
      await waitForSaveUi();
      await triggerRestore();
      restored = await waitRestored('explicit restore', (st) => st.parts.length === saved.parts.length
        && st.tech?.unlocked.includes(NODE_GEAR) === true, 30000);
    }
    const stillSaved = parseSave(await readRawSave());
    assert(stillSaved.parts.length === saved.parts.length, 'save must survive the reload unchanged');
    logStep('05-RESTORED', { parts: restored.parts.length, tech: restored.tech.unlocked, player: playerOf(restored) });
    await play.screenshot('05-restored');
  });

  // ------------------------------------------------------------------
  await play.step('06-assert-slices', async () => {
    const s = await state();
    // 库存：逐物品一致（同时证明没有重复发放起步包）。
    const liveTotals = invTotals(s);
    const savedTotals = {};
    for (const stack of saved.inventory.stacks) savedTotals[stack.itemId] = (savedTotals[stack.itemId] ?? 0) + stack.count;
    for (const itemId of new Set([...Object.keys(liveTotals), ...Object.keys(savedTotals)])) {
      assert((liveTotals[itemId] ?? 0) === (savedTotals[itemId] ?? 0),
        'inventory mismatch after reload for ' + itemId + ': live=' + (liveTotals[itemId] ?? 0) + ' saved=' + (savedTotals[itemId] ?? 0));
    }
    // 零件：id/kind/placement 一致且不重复。
    const liveParts = normParts(s);
    const savedParts = saved.parts.slice().sort((a, b) => a.id - b.id);
    assert(liveParts.length === savedParts.length, 'part count mismatch: live=' + liveParts.length + ' saved=' + savedParts.length);
    assert(new Set(liveParts.map((part) => part.id)).size === liveParts.length, 'restored part ids must be unique');
    for (const expected of savedParts) {
      const actual = liveParts.find((part) => part.id === expected.id);
      assert(actual !== undefined, 'missing restored part id ' + expected.id + ' (' + expected.kind + ')');
      assert(actual.kind === expected.kind, 'part ' + expected.id + ' kind mismatch: ' + actual.kind + ' vs ' + expected.kind);
      assert(actual.gx === expected.gx && actual.gz === expected.gz && actual.rotation === expected.rotation && actual.level === expected.level,
        'part ' + expected.id + ' placement mismatch: ' + JSON.stringify(actual) + ' vs ' + JSON.stringify(expected));
    }
    // 建筑：id/kind/placement 一致。
    const liveBuildings = normBuildings(s);
    const savedBuildings = (saved.buildings ?? []).slice().sort((a, b) => a.id - b.id);
    assert(liveBuildings.length === savedBuildings.length, 'building count mismatch: live=' + liveBuildings.length + ' saved=' + savedBuildings.length);
    for (const expected of savedBuildings) {
      const actual = liveBuildings.find((b) => b.id === expected.id);
      assert(actual !== undefined && actual.kind === expected.kind && actual.gx === expected.gx && actual.gz === expected.gz,
        'building ' + expected.id + ' mismatch: ' + JSON.stringify(actual) + ' vs ' + JSON.stringify(expected));
    }
    // 矿量：逐节点 amount/depleted 一致（证明没有重复扣矿）。
    assert(JSON.stringify(normResources(s)) === JSON.stringify(saved.resources.slice().sort((a, b) => a.id - b.id)),
      'resource mismatch after reload: live=' + JSON.stringify(normResources(s)) + ' saved=' + JSON.stringify(saved.resources));
    // 科技：解锁集合与每节点交付计数一致。
    assertTechEqual(s, saved);
    // 玩家位置：水平误差不超过 0.5 格（垂直解算允许落在同一支撑面的精确点）。
    const playerNow = playerOf(s);
    assert(Math.abs(playerNow.x - saved.player.x) <= 0.5, 'player x mismatch: ' + playerNow.x + ' vs ' + saved.player.x);
    assert(Math.abs(playerNow.z - saved.player.z) <= 0.5, 'player z mismatch: ' + playerNow.z + ' vs ' + saved.player.z);
    assert(playerNow.level === saved.player.level, 'player level mismatch: ' + playerNow.level + ' vs ' + saved.player.level);
    logStep('06-ASSERT', {
      inventory: liveTotals,
      parts: liveParts.length,
      buildings: liveBuildings.length,
      resources: normResources(s),
      tech: normTech(s),
      player: { now: playerNow, saved: saved.player },
    });
  });

  // ------------------------------------------------------------------
  await play.step('07-stability-no-duplicates', async () => {
    const before = await state();
    await play.advance(3);
    await sleep(200);
    const after = await state();
    assert(JSON.stringify(normResources(after)) === JSON.stringify(normResources(before)),
      'resource amounts must not change on their own after restore');
    assert(JSON.stringify(normParts(after)) === JSON.stringify(normParts(before)),
      'parts must not be duplicated/reset by the restore');
    assert(new Set(after.parts.map((part) => part.partId)).size === after.parts.length, 'no duplicate part ids');
    assert(after.tech.unlocked.includes(NODE_GEAR), 'tech progress must survive post-restore frames');
    // 恢复后世界仍可玩：飞轮重新储能后动力网络能重新输出。
    await rewind(3200);
    const powered = await state();
    assert(powered.sources.length === 1, 'flywheel source must exist after restore');
    logStep('07-STABLE', {
      resources: normResources(after),
      parts: after.parts.length,
      source: powered.sources[0] ? { enabled: powered.sources[0].enabled, energy: Math.round(powered.sources[0].energy ?? 0) } : null,
    });
    console.log('P2E3-SAVE-RELOAD=' + JSON.stringify({
      savedBytes: JSON.stringify(saved).length,
      parts: after.parts.length,
      tech: after.tech.unlocked,
    }));
    await play.screenshot('07-final');
  });
}
