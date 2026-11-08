// M2.0-P1-D 订单 Playthrough B 段：步骤 6-8（熔炼 → 异常恢复 → 锻压完成 → 终局核对）。
// 异常 A：动力中断；异常 B：拆除并重建锻压机。两者都必须先在 HUD 显示正确阻塞，再恢复推进。
import { CELL, FORGE, SHAFT } from './m20-order-lib.mjs';

export async function runOrderPhaseB(kit) {
  const {
    play, h, assert, points, evidence, state, producedOf, invOf, machineByRecipe,
    snap, readUi, logStep, bindHotbarFromBackpack, waitUntil, assertStep, getCal, rewind, setCal,
  } = kit;
  const cal = getCal();

  // ------------------------------------------------------------------
  await play.step('07-smelt-two-ingots-step6', async () => {
    await h.selectSlot(SHAFT);
    await play.mouse.move(points.crusher);
    await play.wait(150);
    const beforeTake = await state();
    await h.rightClickAt(points.crusher);
    await play.advance(0.4);
    let s = await state();
    const crushedInInventory = invOf(s, 'crushed_ore') - invOf(beforeTake, 'crushed_ore');
    assert(crushedInInventory >= 2, 'right-click must collect 2 crushed ore from the crusher, got ' + crushedInInventory);

    const smelterId = machineByRecipe(s, 'smelt-crushed-ore').partId;
    const smelterPt = await h.hoverSpecificPart(cal, CELL.smelter, smelterId);
    assert(smelterPt !== null, 'must be able to aim at the smelter');
    points.smelter = smelterPt;
    await play.mouse.move(smelterPt);
    await play.wait(150);
    const crushedBeforeLoad = invOf(await state(), 'crushed_ore');
    for (let index = 0; index < 2; index += 1) {
      await play.keyboard.press('KeyC');
      await play.advance(0.08);
    }
    s = await state();
    const crushedAfterLoad = invOf(s, 'crushed_ore');
    assert(crushedAfterLoad === crushedBeforeLoad - 2,
      'C twice must load 2 crushed ore into the smelter (' + crushedBeforeLoad + ' -> ' + crushedAfterLoad + ')');
    logStep('07-LOADED', { crushedBeforeLoad, crushedAfterLoad, smelter: snap(s).machines.find((m) => m.recipe === 'smelt-crushed-ore') });
    await play.screenshot('09-smelter-fed');

    const one = await waitUntil('smelt progress 1 / 2', (u) => u.detailProgress === '1 / 2',
      { timeoutMs: 40000, keepPowered: true, gameStep: 0.5 });
    assertStep(one.ui, 'smelt-ingot', 'smelting 1/2');
    assert(producedOf(one.state, 'iron_ingot') - evidence.baseline.ironIngot === 1,
      'HUD 1/2 must match real ingot produced delta 1');
    logStep('07-PROGRESS', { progress: one.ui.detailProgress, produced: one.state.production.produced });

    const two = await waitUntil('step 6 completed', (u) => u.count === '6 / 8',
      { timeoutMs: 50000, keepPowered: true, gameStep: 0.5 });
    assert(two.ui.steps[5].completed, 'smelt-ingot must be completed');
    assertStep(two.ui, 'forge-shaft', 'after smelting');
    assert(two.ui.blocker.includes('缺少原料'), 'expected forge no-input blocker, got ' + two.ui.blocker);
    const ingotDelta = producedOf(two.state, 'iron_ingot') - evidence.baseline.ironIngot;
    assert(ingotDelta === 2, 'real iron_ingot produced delta must be exactly 2, got ' + ingotDelta);
    evidence.smelt = {
      produced: two.state.production.produced, ingotDelta,
      ui: { count: two.ui.count, current: two.ui.detailTitle, blocker: two.ui.blocker },
    };
    logStep('07-STEP6', evidence.smelt);
    await play.screenshot('10-step6-done');
  });

  // ------------------------------------------------------------------
  await play.step('08-anomaly-power-cut-and-recover', async () => {
    // 异常 A：右键飞轮断开离合 → 动力网络停转；HUD 必须报「没有动力」，真实产量冻结。
    assertStep(await readUi(), 'forge-shaft', 'anomaly A before');
    await h.selectSlot(SHAFT);
    await play.mouse.move(points.flywheel);
    await play.wait(140);
    await h.rightClickAt(points.flywheel);
    await play.advance(0.8);
    let s = await state();
    assert(s.sources[0].enabled === false, 'clutch must disengage, got enabled=' + s.sources[0].enabled);
    assert(s.sources[0].engaged === false, 'source must not output power after disengage');

    const cut = await waitUntil('HUD reports no-power after power cut',
      (u) => u.state === 'active' && u.steps[6].current && (u.blocker.includes('没有动力') || u.blocker.includes('动力')),
      { timeoutMs: 12000, gameStep: 0.25 });
    assertStep(cut.ui, 'forge-shaft', 'power cut');
    const producedBeforeCut = JSON.stringify(cut.state.production.produced);
    await play.advance(2.0);
    const frozen = await state();
    assert(JSON.stringify(frozen.production.produced) === producedBeforeCut,
      'production must freeze while power is cut; before=' + producedBeforeCut + ' after=' + JSON.stringify(frozen.production.produced));
    logStep('08-POWER-CUT', { blocker: cut.ui.blocker, produced: cut.state.production.produced, sources: snap(cut.state).sources });
    await play.screenshot('11-anomaly-power-cut');

    // 恢复：重新接合离合 + 补储，HUD 回到「缺少原料」。
    await play.mouse.move(points.flywheel);
    await play.wait(120);
    await h.rightClickAt(points.flywheel);
    await play.advance(0.4);
    s = await state();
    assert(s.sources[0].enabled === true, 'clutch must re-engage');
    if (s.sources[0].engaged !== true) await rewind(3000);
    const restored = await waitUntil('HUD recovers after power restore',
      (u) => u.steps[6].current && !u.blocker.includes('没有动力') && u.blocker.includes('缺少原料'),
      { timeoutMs: 15000, keepPowered: true, gameStep: 0.3 });
    assertStep(restored.ui, 'forge-shaft', 'power restored');
    logStep('08-POWER-RESTORED', { blocker: restored.ui.blocker, sources: snap(restored.state).sources });
    await play.screenshot('12-anomaly-power-restored');
  });

  // ------------------------------------------------------------------
  await play.step('09-anomaly-dismantle-and-rebuild-forge', async () => {
    // 异常 B：拆除当前步骤需要的锻压机 → missing-machine；重建后恢复。
    await h.selectSlot(SHAFT);
    const forgeId = machineByRecipe(await state(), 'forge-shaft').partId;
    const forgePt = await h.hoverSpecificPart(cal, CELL.forge, forgeId);
    assert(forgePt !== null, 'must be able to aim at the forge');
    points.forge = forgePt;
    await h.clickAt(forgePt);
    await play.keyboard.press('Delete');
    await play.advance(0.8);
    let s = await state();
    assert(s.parts.length === 10, 'dismantling the forge must leave 10 parts, got ' + s.parts.length);
    const missing = await waitUntil('HUD reports missing-machine',
      (u) => u.state === 'active' && u.steps[6].current && u.blocker.includes('缺少锻压机'),
      { timeoutMs: 12000, gameStep: 0.25 });
    assertStep(missing.ui, 'forge-shaft', 'forge dismantled');
    logStep('09-DISMANTLED', { parts: s.parts.length, blocker: missing.ui.blocker, produced: missing.state.production.produced });
    await play.screenshot('13-anomaly-forge-dismantled');

    // 唯一数量的锻压机拆下后库存为 0 时快捷栏 11 格会自动解绑（M1.4 既有行为）；
    // 重建前必须走真实 UI：Tab 背包 → 选中锻压机 → 点快捷栏第 12 格绑定 → Esc。
    await bindHotbarFromBackpack('forge', FORGE);

    const rebuildPt = await h.pointForCell(cal, CELL.forge, { avoidHover: true });
    await h.placePartAtPoint(rebuildPt, FORGE, 0, 'forge-rebuilt', CELL.forge);
    await h.clearHover();
    s = await state();
    assert(s.parts.length === 11, 'rebuilding the forge must restore 11 parts, got ' + s.parts.length);
    const rebuilt = await waitUntil('HUD recovers after rebuild',
      (u) => u.state === 'active' && u.steps[6].current && u.blocker.includes('缺少原料'),
      { timeoutMs: 15000, keepPowered: true, gameStep: 0.3 });
    assertStep(rebuilt.ui, 'forge-shaft', 'forge rebuilt');
    assert(machineByRecipe(rebuilt.state, 'forge-shaft') !== undefined, 'rebuilt forge must be tracked again');
    logStep('09-REBUILT', { parts: rebuilt.state.parts.length, blocker: rebuilt.ui.blocker, machines: snap(rebuilt.state).machines });
    await play.screenshot('14-anomaly-forge-rebuilt');
  });

  // ------------------------------------------------------------------
  await play.step('10-forge-shaft-and-complete-order', async () => {
    await h.selectSlot(SHAFT);
    const smelterId = machineByRecipe(await state(), 'smelt-crushed-ore').partId;
    const smelterPt = await h.hoverSpecificPart(cal, CELL.smelter, smelterId);
    assert(smelterPt !== null, 'must be able to aim at the smelter to collect ingots');
    points.smelter = smelterPt;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await play.mouse.move(smelterPt);
      await play.wait(120);
      await h.rightClickAt(smelterPt);
      await play.advance(0.4);
      if (invOf(await state(), 'iron_ingot') >= 2) break;
    }
    let s = await state();
    const ingots = invOf(s, 'iron_ingot');
    assert(ingots >= 2, 'need 2 iron ingots to forge a shaft, got ' + ingots);

    const forgeId = machineByRecipe(s, 'forge-shaft').partId;
    const forgePt = await h.hoverSpecificPart(cal, CELL.forge, forgeId);
    assert(forgePt !== null, 'must be able to aim at the rebuilt forge');
    points.forge = forgePt;
    await play.mouse.move(forgePt);
    await play.wait(150);
    for (let index = 0; index < 2; index += 1) {
      await play.keyboard.press('KeyC');
      await play.advance(0.08);
    }
    s = await state();
    const forged = machineByRecipe(s, 'forge-shaft');
    // 两个铁锭在周期开始时被整笔消耗，因此「已收到料」的证据是 progress/running，而不是 inputCount。
    assert(forged.running === true || forged.progress > 0 || forged.inputCount > 0 || forged.outputCount > 0 || producedOf(s, 'shaft') > 0,
      'the forge must start forging after receiving the 2 ingots');
    assert(invOf(s, 'iron_ingot') === ingots - 2, 'the forge must consume exactly 2 ingots from the inventory');
    logStep('10-FORGE-FED', { ingots, forge: snap(s).machines.find((m) => m.recipe === 'forge-shaft'), produced: s.production.produced });
    await play.screenshot('15-forge-fed');

    // 锻压进行中：HUD 目标仍是 forge-shaft，进度 0/1，阻塞解除；订单不能提前完成。
    const forging = await waitUntil('forge running without blocker',
      (u) => u.steps[6].current && u.detailProgress === '0 / 1' && u.status.includes('无阻塞'),
      { timeoutMs: 15000, keepPowered: true, gameStep: 0.25 });
    assert(producedOf(forging.state, 'shaft') - evidence.baseline.shaft === 0,
      'order must not complete before the real shaft is produced');
    logStep('10-FORGING', { progress: forging.ui.detailProgress, status: forging.ui.status, produced: forging.state.production.produced });
    await play.screenshot('16-forging-in-progress');

    // 真实锻压完成：produced shaft 增量至少 1，HUD 才允许 8/8。
    const done = await waitUntil('order complete',
      (u, st) => u.state === 'complete' && u.count === '8 / 8'
        && producedOf(st, 'shaft') - evidence.baseline.shaft >= 1,
      { timeoutMs: 60000, keepPowered: true, gameStep: 0.5 });
    assert(done.ui.completeBannerHidden === false, 'complete banner must be visible');
    assert(done.ui.completeBanner.includes('订单完成'), 'complete banner must say 订单完成, got ' + done.ui.completeBanner);
    assert(done.ui.currentLine === '订单完成', 'current line must say 订单完成, got ' + done.ui.currentLine);
    assert(done.ui.steps.every((step) => step.completed), 'all 8 steps must be completed');
    assert(done.ui.detailHidden === true, 'detail must hide when order completes');

    const shaftDelta = producedOf(done.state, 'shaft') - evidence.baseline.shaft;
    evidence.complete = {
      produced: done.state.production.produced,
      shaftDelta,
      crushedDelta: producedOf(done.state, 'crushed_ore') - evidence.baseline.crushedOre,
      ingotDelta: producedOf(done.state, 'iron_ingot') - evidence.baseline.ironIngot,
      ui: {
        state: done.ui.state, count: done.ui.count, currentLine: done.ui.currentLine,
        banner: done.ui.completeBanner, steps: done.ui.steps.map((step) => step.id + (step.completed ? '+' : '-')),
      },
    };
    logStep('10-COMPLETE', evidence.complete);
    await play.screenshot('17-order-complete');
  });

  // ------------------------------------------------------------------
  await play.step('11-final-cross-check-and-collect', async () => {
    const s = await state();
    const finalUi = await readUi();
    const shaftDelta = producedOf(s, 'shaft') - evidence.baseline.shaft;
    const crushedDelta = producedOf(s, 'crushed_ore') - evidence.baseline.crushedOre;
    const ingotDelta = producedOf(s, 'iron_ingot') - evidence.baseline.ironIngot;
    assert(finalUi.count === '8 / 8', 'final HUD must be 8 / 8, got ' + finalUi.count);
    assert(shaftDelta === 1, 'order completion must be backed by exactly 1 really produced shaft, got ' + shaftDelta);
    assert(crushedDelta === 2 && ingotDelta === 2,
      'real production deltas must be 2 crushed / 2 ingot, got ' + crushedDelta + '/' + ingotDelta);

    // 取走成品不会改变生产证据：HUD 与 produced 不受库存影响。
    await h.selectSlot(SHAFT);
    const forgeId = machineByRecipe(s, 'forge-shaft').partId;
    const forgePt = await h.hoverSpecificPart(cal, CELL.forge, forgeId);
    assert(forgePt !== null, 'must be able to aim at the forge for collection');
    const shaftsBefore = invOf(await state(), 'shaft');
    await play.mouse.move(forgePt);
    await play.wait(120);
    await h.rightClickAt(forgePt);
    await play.advance(0.4);
    const after = await state();
    const shaftsAfter = invOf(after, 'shaft');
    assert(shaftsAfter === shaftsBefore + 1,
      'collecting the forged shaft must add exactly 1 to the inventory (' + shaftsBefore + ' -> ' + shaftsAfter + ')');
    assert(JSON.stringify(after.production.produced) === JSON.stringify(s.production.produced),
      'taking the product must not change produced evidence');

    evidence.final = {
      produced: after.production.produced,
      baseline: evidence.baseline,
      deltas: { crushed: crushedDelta, ingot: ingotDelta, shaft: shaftDelta },
      inventoryShafts: shaftsAfter,
      hud: { state: finalUi.state, count: finalUi.count, currentLine: finalUi.currentLine, banner: finalUi.completeBanner },
      parts: after.parts.length,
    };
    logStep('11-FINAL', evidence.final);
    await play.screenshot('18-final-acceptance');
  });
}
