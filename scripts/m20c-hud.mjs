// M2.0-P1-C 工业订单 HUD 验收：真实游戏运行中的界面检查。
//
// 边界：这不是完整订单 Playthrough（完整八步交付留给 D 阶段）。本脚本只把玩家推进到
// 「已采集 → 已建线 → 已启动动力 → 正在破碎」的部分进度，用真实机械/生产状态验证 HUD：
// 初始态、部分完成、机械阻塞、生产数量、展开/收起、背包/HUD 回归。
// 1280x600 由 forgeax project play 的 viewports（默认 1280x720,1280x600）在脚本结束后
// 自动截图并做 HUD layout 检查。
import { createHarness } from './m18-helpers.mjs';

const SHAFT = 0;
const GEAR12 = 1;
const GEAR24 = 2;
const FLYWHEEL = 8;
const CRUSHER = 9;
const SMELTER = 10;
const FORGE = 11;

// 与 M2.0-P1-B 单测相同的「一源三机」动力网络，平移到矿点旁的可建造地面。
const LAYOUT = [
  { cell: { gx: -8, gz: 7 }, slot: FLYWHEEL, rot: 0, label: 'flywheel' },
  { cell: { gx: -7, gz: 7 }, slot: SHAFT, rot: 0, label: 'shaft-a' },
  { cell: { gx: -6, gz: 7 }, slot: GEAR12, rot: 0, label: 'gear12' },
  { cell: { gx: -5, gz: 7 }, slot: SHAFT, rot: 0, label: 'shaft-b' },
  { cell: { gx: -4, gz: 7 }, slot: CRUSHER, rot: 0, label: 'crusher' },
  { cell: { gx: -6, gz: 8 }, slot: GEAR24, rot: 0, label: 'gear24-a' },
  { cell: { gx: -5, gz: 8 }, slot: SHAFT, rot: 0, label: 'shaft-c' },
  { cell: { gx: -4, gz: 8 }, slot: SMELTER, rot: 0, label: 'smelter' },
  { cell: { gx: -6, gz: 9 }, slot: GEAR24, rot: 0, label: 'gear24-b' },
  { cell: { gx: -5, gz: 9 }, slot: SHAFT, rot: 0, label: 'shaft-d' },
  { cell: { gx: -4, gz: 9 }, slot: FORGE, rot: 0, label: 'forge' },
];

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  const h = createHarness(play);
  const points = {};
  let cal;

  // 读取真实 DOM 中的订单面板（HUD 渲染结果，不是引擎内部状态）。
  const goalUi = () => play.page.evaluate(() => {
    const panel = document.querySelector('.ii-goal');
    if (!panel) return null;
    const text = (selector) => panel.querySelector(selector)?.textContent ?? '';
    const blockerEl = panel.querySelector('.ii-goal-blocker');
    const detailEl = panel.querySelector('.ii-goal-detail');
    const steps = Array.from(panel.querySelectorAll('.ii-goal-step')).map((el) => ({
      id: el.dataset.stepId ?? '',
      current: el.dataset.current === '1',
      completed: el.classList.contains('completed'),
      text: (el.textContent ?? '').trim(),
    }));
    const rect = panel.getBoundingClientRect();
    return {
      state: panel.dataset.state ?? '',
      collapsed: panel.dataset.collapsed ?? '',
      title: text('.ii-goal-title'),
      count: text('.ii-goal-count'),
      currentLine: text('.ii-goal-current-line'),
      detailTitle: text('.ii-goal-detail-title'),
      detailProgress: text('.ii-goal-detail-progress'),
      blocker: blockerEl && !blockerEl.hasAttribute('hidden') ? text('.ii-goal-blocker') : '',
      status: text('.ii-goal-status'),
      detailHidden: detailEl?.hasAttribute('hidden') ?? true,
      steps,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    };
  });

  const waitGoal = async (label, predicate, timeoutMs = 8000) => {
    const start = Date.now();
    let last = null;
    while (Date.now() - start < timeoutMs) {
      await play.advance(0.15);
      await play.wait(120);
      last = await goalUi();
      if (last && predicate(last)) return last;
    }
    throw new Error(label + ' timeout; last=' + JSON.stringify(last));
  };

  await play.step('01-initial-hud', async () => {
    // 机械运行时首帧后目标服务才会提供；等面板从初始化态进入 active。
    const initial = await waitGoal('initial goal panel', (goal) => goal.state === 'active', 12000);
    h.assert(initial.title === '第一份工业订单', 'title mismatch: ' + initial.title);
    h.assert(initial.count === '0 / 8', 'expected 0 / 8, got ' + initial.count);
    h.assert(initial.steps.length === 8, 'expected 8 steps, got ' + initial.steps.length);
    h.assert(initial.steps[0].id === 'gather-ore' && initial.steps[0].current, 'first step must be current gather-ore');
    h.assert(initial.detailTitle === '采集铁矿石', 'current detail mismatch: ' + initial.detailTitle);
    h.assert(initial.blocker.includes('铁矿石'), 'expected missing-ore blocker, got ' + initial.blocker);
    h.assert(initial.rect.left >= 0 && initial.rect.top >= 0 && initial.rect.right <= 1280 && initial.rect.bottom <= 720,
      'goal panel outside 1280x720 viewport: ' + JSON.stringify(initial.rect));
    console.log('GOAL-INITIAL=' + JSON.stringify({ count: initial.count, current: initial.detailTitle, blocker: initial.blocker, rect: initial.rect }));

    const chrome = await play.page.evaluate(() => ({
      hotbarSlots: document.querySelectorAll('.ii-hotbar .ii-slot').length,
      hint: document.querySelector('.ii-hint')?.textContent ?? '',
    }));
    h.assert(chrome.hotbarSlots === 12, 'hotbar must stay visible with 12 slots, got ' + chrome.hotbarSlots);
    h.assert(chrome.hint.includes('Tab'), 'backpack hint must stay visible');
    await play.screenshot('01-initial-1280x720');
  });

  await play.step('02-harvest-two-ore', async () => {
    await h.learnMovement();
    cal = await h.calibrate('LEVEL0');
    h.assert(await h.gotoCell({ gx: -6, gz: 4 }, 16000, true), 'must reach ore node A');
    for (let index = 0; index < 2; index += 1) {
      await play.keyboard.press('KeyF');
      await play.advance(3.4);
      await play.wait(90);
    }
    const state = await h.state();
    const ore = state.inventory.find((entry) => entry.itemId === 'iron_ore')?.count ?? 0;
    h.assert(ore >= 2, 'expected at least 2 iron ore, got ' + ore);

    const partial = await waitGoal('first step completed', (goal) => goal.count === '1 / 8');
    h.assert(partial.steps[0].completed, 'gather-ore step must be completed');
    h.assert(partial.steps[1].current, 'build-machines must be current');
    h.assert(partial.blocker.includes('生产机器尚未建造'), 'expected missing-machine blocker, got ' + partial.blocker);
    console.log('GOAL-PARTIAL=' + JSON.stringify({ count: partial.count, current: partial.detailTitle, blocker: partial.blocker }));
    await play.screenshot('02-partial-1280x720');
  });

  await play.step('03-build-production-line', async () => {
    h.assert(await h.gotoCell({ gx: -7, gz: 6 }, 16000, true), 'must walk to the building spot');
    cal = await h.calibrate('LEVEL0-WORK');
    for (const item of LAYOUT) {
      const point = await h.pointForCell(cal, item.cell, { avoidHover: true });
      points[item.label] = point;
      await h.placePartAtPoint(point, item.slot, item.rot, item.label, item.cell);
    }
    await h.clearHover();
    const state = await h.state();
    h.assert(state.parts.length === LAYOUT.length, 'expected ' + LAYOUT.length + ' parts, got ' + state.parts.length);
    h.assert(state.production.machines.length === 3, 'expected 3 production machines, got ' + state.production.machines.length);

    const built = await waitGoal('connection step completed', (goal) => goal.count === '3 / 8');
    h.assert(built.steps[2].completed, 'connect-power step must be completed');
    h.assert(built.steps[3].current, 'start-power must be current');
    h.assert(built.blocker.includes('没有输出') || built.blocker.includes('动力'), 'expected no-power blocker, got ' + built.blocker);
    console.log('GOAL-BUILT=' + JSON.stringify({ count: built.count, current: built.detailTitle, blocker: built.blocker }));
    await play.screenshot('03-blocker-no-power-1280x720');
  });

  await play.step('04-engage-flywheel', async () => {
    await h.holdKey('KeyC', 7200);
    cal = await h.calibrate('LEVEL0-POWER');
    await h.selectSlot(SHAFT);
    const sourcePart = (await h.state()).parts.find((part) => part.kind === 'power-source');
    h.assert(sourcePart !== undefined, 'the flywheel source must exist');
    const flywheelPoint = await h.hoverSpecificPart(cal, { gx: -8, gz: 7 }, sourcePart.partId);
    h.assert(flywheelPoint !== null, 'must be able to aim at the flywheel');
    points['flywheel'] = flywheelPoint;
    await h.clickAt(flywheelPoint);
    await play.wait(220);
    await h.rightClickAt(flywheelPoint);
    await play.advance(0.6);

    const engaged = await waitGoal('start-power completed', (goal) => goal.count === '4 / 8');
    h.assert(engaged.steps[3].completed, 'start-power step must be completed');
    h.assert(engaged.steps[4].current, 'crush-ore must be current');
    h.assert(engaged.blocker.includes('缺少原料'), 'expected no-input blocker, got ' + engaged.blocker);
    console.log('GOAL-ENGAGED=' + JSON.stringify({ count: engaged.count, current: engaged.detailTitle, blocker: engaged.blocker }));
    await play.screenshot('04-blocker-no-input-1280x720');
  });

  await play.step('05-real-production-progress', async () => {
    // 悬停破碎机，按 C 从库存投 2 个铁矿石；等待真实加工出 1 个碎铁矿。
    await h.selectSlot(SHAFT);
    const crusher = (await h.state()).production.machines.find((machine) => machine.recipeId === 'crush-iron-ore');
    h.assert(crusher !== undefined, 'crusher must be tracked');
    const crusherPoint = await h.hoverSpecificPart(cal, { gx: -4, gz: 7 }, crusher.partId);
    h.assert(crusherPoint !== null, 'must be able to aim at the crusher');
    points['crusher'] = crusherPoint;
    await play.mouse.move(crusherPoint);
    await play.wait(150);
    for (let index = 0; index < 2; index += 1) {
      await play.keyboard.press('KeyC');
      await play.advance(0.06);
    }
    // 真实生产：等订单步骤 5 的产量差值到 1 / 2。
    const one = await waitGoal('crushed progress 1 / 2', (goal) => goal.detailProgress === '1 / 2', 20000);
    h.assert(one.steps[4].current, 'crush-ore must stay current at 1 / 2');
    console.log('GOAL-PROGRESS=' + JSON.stringify({ count: one.count, progress: one.detailProgress }));
    await play.screenshot('05-production-progress-1280x720');

    const two = await waitGoal('crush step completed', (goal) => goal.count === '5 / 8', 20000);
    h.assert(two.steps[4].completed, 'crush-ore must be completed after 2 crushed ore');
    h.assert(two.steps[5].current, 'smelt-ingot must be current');
    console.log('GOAL-STEP5=' + JSON.stringify({ count: two.count, current: two.detailTitle, blocker: two.blocker }));
    await play.screenshot('06-step-completed-1280x720');
  });

  await play.step('06-collapse-and-expand', async () => {
    await play.page.click('.ii-goal-toggle');
    await play.advance(0.1);
    await play.wait(150);
    const collapsed = await goalUi();
    h.assert(collapsed.collapsed === '1', 'panel must collapse');
    h.assert(collapsed.currentLine.includes('当前：'), 'collapsed header must keep the current step');
    const bodyVisible = await play.page.evaluate(() => {
      const body = document.querySelector('.ii-goal-body');
      return body ? getComputedStyle(body).display !== 'none' : false;
    });
    h.assert(bodyVisible === false, 'collapsed panel must hide the step list');
    await play.screenshot('07-collapsed-1280x720');

    await play.page.click('.ii-goal-toggle');
    await play.advance(0.1);
    await play.wait(150);
    const expanded = await goalUi();
    h.assert(expanded.collapsed === '0', 'panel must expand again');
    h.assert(expanded.count === '5 / 8', 'toggling must not change order state, got ' + expanded.count);
  });

  await play.step('07-existing-hud-regression', async () => {
    await play.keyboard.press('Tab');
    await play.advance(0.1);
    await play.wait(250);
    const open = await play.page.evaluate(() => {
      const backdrop = document.querySelector('.ii-backpack');
      return { open: backdrop ? !backdrop.hasAttribute('hidden') : false, rows: document.querySelectorAll('.ii-row').length };
    });
    h.assert(open.open, 'backpack must still open with Tab');
    await play.screenshot('08-backpack-open-1280x720');
    await play.keyboard.press('Escape');
    await play.advance(0.1);
    await play.wait(250);
    const closed = await play.page.evaluate(() => {
      const backdrop = document.querySelector('.ii-backpack');
      return backdrop ? backdrop.hasAttribute('hidden') : false;
    });
    h.assert(closed, 'backpack must close with Escape');
    const after = await goalUi();
    h.assert(after.count === '5 / 8', 'goal panel must survive backpack open/close, got ' + after.count);
  });
}
