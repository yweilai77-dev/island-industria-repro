// M2.0-P1-D 订单 Playthrough A 段：步骤 1-5（采集 → 建机器 → 接动力 → 启动 → 破碎）。
// 每一步都同时断言真实 DOM HUD 与 GameRead(mechanical) 的真实状态。
import { CELL, CRUSHER, FLYWHEEL, FORGE, GEAR12, GEAR24, SHAFT, SMELTER } from './m20-order-lib.mjs';

export async function runOrderPhaseA(kit) {
  const {
    play, h, assert, points, evidence, state, producedOf, invOf, machineByRecipe,
    snap, readUi, logStep, waitUntil, assertStep, setCal, getCal,
  } = kit;

  // ------------------------------------------------------------------
  await play.step('01-initial-hud-and-order-baseline', async () => {
    const { ui } = await waitUntil('initial goal panel active', (u) => u.state === 'active', { timeoutMs: 15000 });
    assert(ui.title === '第一份工业订单', 'title mismatch: ' + ui.title);
    assert(ui.count === '0 / 8', 'expected 0 / 8, got ' + ui.count);
    assert(ui.steps.length === 8, 'expected 8 steps, got ' + ui.steps.length);
    assertStep(ui, 'gather-ore', 'initial');
    assert(ui.blocker.includes('铁矿石'), 'expected missing-ore blocker, got ' + ui.blocker);

    // 订单开始基线：首帧真实 produced（此时为 0）；订单完成只看相对它的增量。
    const s = await state();
    evidence.baseline = {
      produced: s.production.produced,
      crushedOre: producedOf(s, 'crushed_ore'),
      ironIngot: producedOf(s, 'iron_ingot'),
      shaft: producedOf(s, 'shaft'),
      inventoryShafts: invOf(s, 'shaft'),
    };
    logStep('01-INITIAL', { ui: { count: ui.count, current: ui.detailTitle, blocker: ui.blocker }, baseline: evidence.baseline, state: snap(s) });

    const chrome = await play.page.evaluate(() => ({
      hotbarSlots: document.querySelectorAll('.ii-hotbar .ii-slot').length,
      hint: document.querySelector('.ii-hint')?.textContent ?? '',
    }));
    assert(chrome.hotbarSlots === 12, 'hotbar must stay visible with 12 slots, got ' + chrome.hotbarSlots);
    assert(chrome.hint.includes('Tab'), 'backpack hint must stay visible');
    await play.screenshot('01-initial-order-hud');
  });

  // ------------------------------------------------------------------
  await play.step('02-harvest-ore-step1', async () => {
    await h.learnMovement();
    setCal(await h.calibrate('LEVEL0'));
    assert(await h.gotoCell({ gx: -6, gz: 4 }, 16000, true), 'must reach ore node A');
    for (let index = 0; index < 2; index += 1) {
      await play.keyboard.press('KeyF');
      await play.advance(3.4);
      await play.wait(90);
    }
    const s = await state();
    const ore = invOf(s, 'iron_ore');
    assert(ore >= 2, 'expected at least 2 iron ore, got ' + ore);

    const { ui } = await waitUntil('step 1 completed', (u) => u.count === '1 / 8', { timeoutMs: 15000 });
    assert(ui.steps[0].completed, 'gather-ore must be completed');
    assertStep(ui, 'build-machines', 'after harvest');
    assert(ui.steps[1].progress === '0 / 3', 'build-machines progress must be 0 / 3, got ' + ui.steps[1].progress);
    assert(ui.blocker.includes('生产机器尚未建造'), 'expected missing-machine blocker, got ' + ui.blocker);
    evidence.harvest = { ore, ui: { count: ui.count, current: ui.detailTitle, progress: ui.steps[1].progress, blocker: ui.blocker } };
    logStep('02-HARVEST', evidence.harvest);
    await play.screenshot('02-step1-done-build-machines');
  });

  // ------------------------------------------------------------------
  await play.step('03-build-machines-step2', async () => {
    assert(await h.gotoCell({ gx: -7, gz: 6 }, 16000, true), 'must walk to the building spot');
    setCal(await h.calibrate('LEVEL0-WORK'));

    // 逐台放置：第三台放下时 step2 立刻锁存、当前目标切到 connect-power。
    const buildOrder = [
      { label: 'crusher', slot: CRUSHER, cell: CELL.crusher, expectedProgress: '1 / 3', expectedCurrent: 'build-machines' },
      { label: 'smelter', slot: SMELTER, cell: CELL.smelter, expectedProgress: '2 / 3', expectedCurrent: 'build-machines' },
      { label: 'forge', slot: FORGE, cell: CELL.forge, expectedProgress: '3 / 3', expectedCurrent: 'connect-power' },
    ];
    for (const item of buildOrder) {
      const pt = await h.pointForCell(getCal(), item.cell, { avoidHover: true });
      points[item.label] = pt;
      await h.placePartAtPoint(pt, item.slot, 0, item.label, item.cell);
      const { ui } = await waitUntil('build progress ' + item.label,
        (u) => u.state === 'active' && u.steps[1].progress === item.expectedProgress, { timeoutMs: 12000 });
      assert(ui.steps[1].progress === item.expectedProgress, 'build progress mismatch: ' + ui.steps[1].progress);
      const current = ui.steps.find((step) => step.current);
      assert(current !== undefined && current.id === item.expectedCurrent,
        'after placing ' + item.label + ': expected current ' + item.expectedCurrent + ', got ' + JSON.stringify(current && current.id));
      logStep('03-PLACE-' + item.label.toUpperCase(), { progress: ui.steps[1].progress, current: current.id, count: ui.count, blocker: ui.blocker });
    }
    await h.clearHover();
    const s = await state();
    assert(s.parts.length === 3, 'expected 3 machines, got ' + s.parts.length);
    assert(s.production.machines.length === 3, 'expected 3 tracked machines, got ' + s.production.machines.length);

    const { ui } = await waitUntil('step 2 completed', (u) => u.count === '2 / 8', { timeoutMs: 15000 });
    assert(ui.steps[1].completed, 'build-machines must be completed');
    assertStep(ui, 'connect-power', 'after 3 machines');
    assert(ui.blocker.includes('动力源'), 'expected missing-power-source blocker, got ' + ui.blocker);
    evidence.build = { parts: s.parts.length, machines: s.production.machines.length, ui: { count: ui.count, current: ui.detailTitle, blocker: ui.blocker } };
    logStep('03-BUILT', evidence.build);
    await play.screenshot('03-step2-done-missing-power-source');
  });

  // ------------------------------------------------------------------
  await play.step('04-connect-power-network-step3', async () => {
    const cal = getCal();
    const flywheelPt = await h.pointForCell(cal, CELL.flywheel, { avoidHover: true });
    points.flywheel = flywheelPt;
    await h.placePartAtPoint(flywheelPt, FLYWHEEL, 0, 'flywheel', CELL.flywheel);
    // 飞轮放下后阻塞从「还没有动力源」变为「动力连接尚未完成」（文案里也含"动力源"，不能只做否定匹配）。
    const afterFlywheel = await waitUntil('missing power source resolved',
      (u) => u.state === 'active' && u.blocker.includes('动力连接尚未完成'), { timeoutMs: 12000 });
    assertStep(afterFlywheel.ui, 'connect-power', 'after flywheel');
    logStep('04-FLYWHEEL', { count: afterFlywheel.ui.count, blocker: afterFlywheel.ui.blocker });

    const chain = [
      { label: 'shaft-a', slot: SHAFT, cell: CELL.shaftA },
      { label: 'gear12', slot: GEAR12, cell: CELL.gear12 },
      { label: 'shaft-b', slot: SHAFT, cell: CELL.shaftB },
      { label: 'gear24-a', slot: GEAR24, cell: CELL.gear24A },
      { label: 'shaft-c', slot: SHAFT, cell: CELL.shaftC },
      { label: 'gear24-b', slot: GEAR24, cell: CELL.gear24B },
      { label: 'shaft-d', slot: SHAFT, cell: CELL.shaftD },
    ];
    for (const item of chain) {
      const pt = await h.pointForCell(cal, item.cell, { avoidHover: true });
      points[item.label] = pt;
      await h.placePartAtPoint(pt, item.slot, 0, item.label, item.cell);
    }
    await h.clearHover();
    const s = await state();
    assert(s.parts.length === 11, 'expected 11 parts, got ' + s.parts.length);
    assert(s.networks.length === 1, 'expected exactly one power network, got ' + s.networks.length);
    assert(s.networks[0].partIds.length === 11, 'all 11 parts must share one network, got ' + s.networks[0].partIds.length);
    assert(s.production.machines.every((machine) => machine.powered === false), 'machines must be unpowered before engaging');
    assert(s.production.machines.every((machine) => machine.block === 'no-power'), 'machines must report no-power before engaging');

    const { ui } = await waitUntil('step 3 completed', (u) => u.count === '3 / 8', { timeoutMs: 15000 });
    assert(ui.steps[2].completed, 'connect-power must be completed');
    assertStep(ui, 'start-power', 'after network built');
    assert(ui.blocker.includes('没有输出') || ui.blocker.includes('动力'), 'expected no-power blocker, got ' + ui.blocker);
    evidence.network = {
      parts: s.parts.length,
      networks: s.networks.map((n) => ({ status: n.status, parts: n.partIds.length })),
      ui: { count: ui.count, current: ui.detailTitle, blocker: ui.blocker },
    };
    logStep('04-CONNECTED', evidence.network);
    await play.screenshot('04-step3-done-no-power');
  });

  // ------------------------------------------------------------------
  await play.step('05-wind-and-engage-step4', async () => {
    const cal = getCal();
    await h.clearHover();
    await h.holdKey('KeyC', 7000);
    let s = await state();
    assert(s.sources.length === 1, 'expected one flywheel source');
    assert((s.sources[0].energy ?? 0) > 0, 'winding must store energy, got ' + s.sources[0].energy);
    const sourcePart = s.parts.find((part) => part.kind === 'power-source');
    assert(sourcePart !== undefined, 'the flywheel source must exist');
    await h.selectSlot(SHAFT);
    const flywheelPt = await h.hoverSpecificPart(cal, CELL.flywheel, sourcePart.partId);
    assert(flywheelPt !== null, 'must be able to aim at the flywheel');
    points.flywheel = flywheelPt;
    await h.clickAt(flywheelPt);
    await h.rightClickAt(flywheelPt);
    await play.advance(0.6);
    s = await state();
    assert(s.sources[0].enabled === true, 'clutch must engage');
    assert(s.sources[0].engaged === true, 'source must output energy after engaging');
    assert(s.production.machines.every((machine) => machine.powered === true), 'all three machines must be powered');
    assert(s.production.machines.every((machine) => machine.block === 'no-input'), 'powered machines with no material must report no-input');

    const { ui } = await waitUntil('step 4 completed', (u) => u.count === '4 / 8', { timeoutMs: 15000 });
    assert(ui.steps[3].completed, 'start-power must be completed');
    assertStep(ui, 'crush-ore', 'after engaging');
    assert(ui.blocker.includes('缺少原料'), 'expected no-input blocker, got ' + ui.blocker);
    evidence.engage = { sources: snap(s).sources, machines: snap(s).machines, ui: { count: ui.count, current: ui.detailTitle, blocker: ui.blocker } };
    logStep('05-ENGAGED', evidence.engage);
    await play.screenshot('05-step4-done-no-input');
  });

  // ------------------------------------------------------------------
  await play.step('06-crush-two-ore-step5', async () => {
    const cal = getCal();
    await h.selectSlot(SHAFT);
    const crusherId = machineByRecipe(await state(), 'crush-iron-ore').partId;
    const crusherPt = await h.hoverSpecificPart(cal, CELL.crusher, crusherId);
    assert(crusherPt !== null, 'must be able to aim at the crusher');
    points.crusher = crusherPt;
    await play.mouse.move(crusherPt);
    await play.wait(150);
    const oreBefore = invOf(await state(), 'iron_ore');
    for (let index = 0; index < 2; index += 1) {
      await play.keyboard.press('KeyC');
      await play.advance(0.08);
    }
    const fed = await state();
    const oreAfter = invOf(fed, 'iron_ore');
    const crusher = machineByRecipe(fed, 'crush-iron-ore');
    assert(oreAfter === oreBefore - 2, 'pressing C twice must take 2 ore from the inventory (' + oreBefore + ' -> ' + oreAfter + ')');
    assert(crusher.running === true || crusher.inputCount > 0, 'crusher must start a real cycle');
    logStep('06-FED', { oreBefore, oreAfter, crusher: snap(fed).machines.find((m) => m.recipe === 'crush-iron-ore') });
    await play.screenshot('06-crusher-fed');

    const one = await waitUntil('crush progress 1 / 2', (u) => u.detailProgress === '1 / 2',
      { timeoutMs: 30000, keepPowered: true, gameStep: 0.5 });
    assert(one.ui.steps[4].current, 'crush-ore must stay current at 1 / 2');
    assert(producedOf(one.state, 'crushed_ore') - evidence.baseline.crushedOre === 1,
      'HUD 1/2 must match real produced delta 1, got ' + (producedOf(one.state, 'crushed_ore') - evidence.baseline.crushedOre));
    logStep('06-PROGRESS', { progress: one.ui.detailProgress, produced: one.state.production.produced, baseline: evidence.baseline });
    await play.screenshot('07-crushing-progress');

    const two = await waitUntil('step 5 completed', (u) => u.count === '5 / 8',
      { timeoutMs: 40000, keepPowered: true, gameStep: 0.5 });
    assert(two.ui.steps[4].completed, 'crush-ore must be completed');
    assertStep(two.ui, 'smelt-ingot', 'after crushing');
    assert(two.ui.blocker.includes('缺少原料'), 'expected smelter no-input blocker, got ' + two.ui.blocker);
    const crushedDelta = producedOf(two.state, 'crushed_ore') - evidence.baseline.crushedOre;
    assert(crushedDelta === 2, 'real crushed_ore produced delta must be exactly 2, got ' + crushedDelta);
    evidence.crush = { produced: two.state.production.produced, crushedDelta, ui: { count: two.ui.count, current: two.ui.detailTitle, blocker: two.ui.blocker } };
    logStep('06-STEP5', evidence.crush);
    await play.screenshot('08-step5-done');
  });
}
