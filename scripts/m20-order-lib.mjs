// M2.0-P1-D 订单 Playthrough 共用工具：HUD 读取、真实状态快照、等待/补储、证据记录。
//
// 边界：只读真实 DOM（玩家看到的 HUD）与 GameRead(mechanical)（引擎真实状态），
// 所有操作仍由 play.step 里的真实键鼠事件完成；本文件不产生任何游戏状态。
export const SHAFT = 0;
export const GEAR12 = 1;
export const GEAR24 = 2;
export const FLYWHEEL = 8;
export const CRUSHER = 9;
export const SMELTER = 10;
export const FORGE = 11;

export const CELL = {
  flywheel: { gx: -8, gz: 7 },
  shaftA: { gx: -7, gz: 7 },
  gear12: { gx: -6, gz: 7 },
  shaftB: { gx: -5, gz: 7 },
  crusher: { gx: -4, gz: 7 },
  gear24A: { gx: -6, gz: 8 },
  shaftC: { gx: -5, gz: 8 },
  smelter: { gx: -4, gz: 8 },
  gear24B: { gx: -6, gz: 9 },
  shaftD: { gx: -5, gz: 9 },
  forge: { gx: -4, gz: 9 },
};

export const EXPECT_STEP_TITLE = {
  'gather-ore': '采集铁矿石',
  'build-machines': '建造生产机器',
  'connect-power': '建立机械动力连接',
  'start-power': '启动动力网络',
  'crush-ore': '完成矿石破碎',
  'smelt-ingot': '完成铁锭熔炼',
  'forge-shaft': '完成传动轴锻压',
  complete: '订单完成',
};

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export function createOrderKit(play, h) {
  const assert = h.assert;
  const points = {};
  const evidence = {};
  let cal = null;

  const state = () => h.state();
  const producedOf = (s, itemId) => s.production.produced.find((entry) => entry.itemId === itemId)?.count ?? 0;
  const invOf = (s, itemId) => s.inventory.find((entry) => entry.itemId === itemId)?.count ?? 0;
  const machineByRecipe = (s, recipeId) => s.production.machines.find((machine) => machine.recipeId === recipeId);

  /** 精简证据快照（只保留验收需要的字段）。 */
  const snap = (s) => ({
    parts: s.parts.length,
    machines: s.production.machines.map((m) => ({
      id: m.partId, recipe: m.recipeId, powered: m.powered, block: m.block,
      progress: Math.round(m.progress * 1000) / 1000,
      input: m.inputCount, output: m.outputCount, produced: m.producedTotal,
    })),
    chutes: s.production.chutes.map((c) => ({ id: c.partId, item: c.itemId, blocked: c.blocked })),
    produced: s.production.produced,
    inventory: s.inventory,
    sources: s.sources.map((x) => ({
      id: x.partId, enabled: x.enabled, engaged: x.engaged,
      energy: Math.round(x.energy ?? 0), capacity: x.energyCapacity,
    })),
    networks: s.networks.map((n) => ({
      id: n.id, status: n.status, reason: n.reason,
      parts: n.partIds.length, machines: n.machineIds.length,
      sources: n.sourceIds.length, speedFactor: Math.round(n.speedFactor * 1000) / 1000,
    })),
    player: { level: s.player.level, cell: s.player.cell },
  });

  /** 读取真实 DOM 中的订单面板（玩家看到的 HUD，不是引擎内部状态）。 */
  const readUi = () => play.page.evaluate(() => {
    const panel = document.querySelector('.ii-goal');
    if (!panel) return null;
    const text = (selector) => panel.querySelector(selector)?.textContent ?? '';
    const blockerEl = panel.querySelector('.ii-goal-blocker');
    const banner = panel.querySelector('.ii-goal-complete');
    const detailEl = panel.querySelector('.ii-goal-detail');
    const steps = Array.from(panel.querySelectorAll('.ii-goal-step')).map((el) => ({
      id: el.dataset.stepId ?? '',
      current: el.dataset.current === '1',
      completed: el.classList.contains('completed'),
      progress: (el.querySelector('.ii-goal-step-progress')?.textContent ?? '').trim(),
      text: (el.textContent ?? '').trim(),
    }));
    const rect = panel.getBoundingClientRect();
    return {
      state: panel.dataset.state ?? '',
      collapsed: panel.dataset.collapsed ?? '',
      title: text('.ii-goal-title'),
      subtitle: text('.ii-goal-sub'),
      count: text('.ii-goal-count'),
      currentLine: text('.ii-goal-current-line'),
      detailTitle: text('.ii-goal-detail-title'),
      detailDesc: text('.ii-goal-detail-desc'),
      detailProgress: text('.ii-goal-detail-progress'),
      blocker: blockerEl && !blockerEl.hasAttribute('hidden') ? text('.ii-goal-blocker') : '',
      status: text('.ii-goal-status'),
      detailHidden: detailEl ? detailEl.hasAttribute('hidden') : true,
      completeBannerHidden: banner ? banner.hasAttribute('hidden') : true,
      completeBanner: banner ? text('.ii-goal-complete') : '',
      steps,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    };
  });

  /** 补储：离开机器悬停后按住 C 摇柄；必要时重新接合离合。 */
  const rewind = async (ms = 3200) => {
    await h.clearHover();
    await h.holdKey('KeyC', ms);
    await play.advance(0.15);
    let s = await state();
    if (s.sources[0]?.enabled !== true && points.flywheel) {
      await h.selectSlot(SHAFT);
      await play.mouse.move(points.flywheel);
      await play.wait(120);
      await h.rightClickAt(points.flywheel);
      await play.advance(0.35);
      s = await state();
    }
    return s;
  };

  const logStep = (label, payload) => console.log('D-EVIDENCE ' + label + '=' + JSON.stringify(payload));

  /** 等待 HUD+运行时同时满足条件；keepPowered 时自动补储。 */
  const waitUntil = async (label, predicate, options = {}) => {
    const timeoutMs = options.timeoutMs ?? 30000;
    const keepPowered = options.keepPowered === true;
    const gameStep = options.gameStep ?? 0.4;
    const pauseMs = options.pauseMs ?? 110;
    const started = Date.now();
    let lastUi = null;
    let lastState = null;
    while (Date.now() - started < timeoutMs) {
      if (gameStep > 0) await play.advance(gameStep);
      await play.wait(pauseMs);
      lastUi = await readUi();
      lastState = await state();
      if (lastUi && predicate(lastUi, lastState)) return { ui: lastUi, state: lastState };
      if (keepPowered && lastState.sources.length > 0 && lastState.sources[0].engaged !== true) {
        await rewind(3000);
      }
    }
    throw new Error(label + ' timeout; ui=' + JSON.stringify(lastUi) + ' state=' + JSON.stringify(snap(lastState)));
  };

  /** 等待真实生产条件（每帧推进 1 秒游戏时间）。 */
  const waitProduction = async (label, predicate, options = {}) => {
    const timeoutMs = options.timeoutMs ?? 60000;
    const started = Date.now();
    let lastState = null;
    while (Date.now() - started < timeoutMs) {
      await play.advance(1.0);
      lastState = await state();
      if (predicate(lastState)) return lastState;
      if (lastState.sources.length > 0 && lastState.sources[0].engaged !== true) {
        await rewind(3200);
      }
    }
    throw new Error(label + ' timeout; state=' + JSON.stringify(snap(lastState)));
  };

  const assertStep = (ui, expectedId, context) => {
    const current = ui.steps.find((step) => step.current);
    assert(ui.state === 'active', context + ': panel must be active, got ' + ui.state);
    assert(current !== undefined && current.id === expectedId,
      context + ': expected current step ' + expectedId + ', got ' + JSON.stringify(current && current.id));
    assert(ui.detailTitle === EXPECT_STEP_TITLE[expectedId],
      context + ': expected detail title ' + EXPECT_STEP_TITLE[expectedId] + ', got ' + ui.detailTitle);
    assert(ui.rect.left >= 0 && ui.rect.top >= 0 && ui.rect.right <= 1280 && ui.rect.bottom <= 720,
      context + ': goal panel outside 1280x720 viewport: ' + JSON.stringify(ui.rect));
  };

  return {
    play, h, assert, points, evidence,
    getCal: () => cal,
    setCal: (value) => { cal = value; },
    state, producedOf, invOf, machineByRecipe, snap, readUi,
    rewind, logStep, waitUntil, waitProduction, assertStep,
  };
}
