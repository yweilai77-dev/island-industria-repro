// P2-B 验收场景 A / B / C（旧式人工生产 → 制造并安装接口盒 → 自动输入）。
// 从 p2b-ports.mjs 按功能拆出，行为与拆分前一致。
export async function runAbc(play, h, C) {
  const {
    points, calRef, assert, countOf, machineOf, machineById,
    hoverMachine, ensurePowered, feedByC, takeByRightClick, placeRotated, removePart, cycleRecipe,
    ORE_TARGET, SHAFT, GEAR12, CHUTE, CRUSHER_CELL, SMELTER_CELL, CHUTE_CELL, FORGE_CELL, LINE, FORGE_BRANCH
  } = C;
  const cal = calRef;

  await play.step('01-harvest-ore', async () => {
    await h.learnMovement();
    cal.value = await h.calibrate('LEVEL0');
    assert(await h.gotoCell({ gx: -6, gz: 4 }, 16000, true), 'must reach ore node A');
    const before = countOf(await h.state(), 'iron_ore');
    for (let index = 0; index < ORE_TARGET; index += 1) {
      await play.keyboard.press('KeyF');
      await play.advance(3.4);
      await play.wait(90);
    }
    const ore = countOf(await h.state(), 'iron_ore');
    console.log('HARVEST=' + JSON.stringify({ before, ore }));
    assert(ore >= before + ORE_TARGET - 1, 'harvesting must add ore, got ' + ore + ' from ' + before);
    await play.screenshot('01-harvested');
  });

  await play.step('02-build-line', async () => {
    assert(await h.gotoCell({ gx: -7, gz: 7 }, 16000, true), 'must walk to the building spot');
    cal.value = await h.calibrate('LEVEL0-WORK');
    for (const item of LINE) {
      const pt = await h.pointForCell(cal.value, item.cell, { avoidHover: true });
      points[item.label] = pt;
      await placeRotated(pt, item.slot, item.rot, item.label, item.cell);
    }
    await h.clearHover();
    const state = await h.state();
    console.log('LINE=' + JSON.stringify({
      parts: state.parts.length,
      networks: state.networks.map((network) => network.status + ':' + network.partIds.length),
      machines: state.production.machines.map((machine) => ({ id: machine.partId, recipe: machine.recipeId })),
      ports: state.ports,
    }));
    assert(state.parts.length === LINE.length, 'expected ' + LINE.length + ' parts, got ' + state.parts.length);
    assert(state.production.machines.length === 2, 'crusher + smelter must be tracked');
    assert(state.ports.length === 0, 'no interface box may be installed yet');
    await play.screenshot('02-line-built');
  });

  await play.step('03-scenario-a-manual-production', async () => {
    // 场景 A：没有接口盒、没有溜槽，全靠玩家手动投料与取货。
    await h.holdKey('KeyC', 7200);
    cal.value = await h.calibrate('LEVEL0-POWER');
    await h.selectSlot(SHAFT);
    const source = (await h.state()).parts.find((part) => part.kind === 'power-source');
    points['flywheel'] = await h.hoverSpecificPart(cal.value, { gx: -8, gz: 8 }, source.partId);
    assert(points['flywheel'] !== null, 'must be able to aim at the flywheel');
    await h.clickAt(points['flywheel']);
    await h.rightClickAt(points['flywheel']);
    await play.advance(0.6);
    let state = await h.state();
    assert(state.sources[0].engaged === true, 'clutch must engage');
    assert(state.production.machines.every((machine) => machine.powered === true), 'both machines must be powered');

    // 手动投 4 个铁矿石进破碎机。
    const crusherId = machineOf(state, 'crush-iron-ore').partId;
    points['crusher'] = await hoverMachine(CRUSHER_CELL, crusherId);
    const oreBefore = countOf(state, 'iron_ore');
    await feedByC(points['crusher'], 4);
    state = await h.state();
    console.log('MANUAL-FEED-CRUSHER=' + JSON.stringify({
      oreBefore,
      oreAfter: countOf(state, 'iron_ore'),
      crusher: machineById(state, crusherId),
    }));
    assert(countOf(state, 'iron_ore') === oreBefore - 4, '4 presses of C must consume 4 ore from the inventory');

    // 等破碎完成，手动右键取出碎铁矿。
    for (let index = 0; index < 40; index += 1) {
      await play.advance(1.0);
      state = await h.state();
      if (machineById(state, crusherId).outputCount >= 4) break;
      await ensurePowered();
    }
    await takeByRightClick(points['crusher'], 2);
    state = await h.state();
    console.log('MANUAL-COLLECT=' + JSON.stringify({
      crushed: countOf(state, 'crushed_ore'),
      crusher: machineById(state, crusherId),
    }));
    assert(countOf(state, 'crushed_ore') >= 4, 'right-clicking the crusher must move crushed ore into the inventory');

    // 手动投入熔炼炉。
    const smelterId = machineOf(state, 'smelt-crushed-ore').partId;
    points['smelter'] = await hoverMachine(SMELTER_CELL, smelterId);
    await feedByC(points['smelter'], 4);
    state = await h.state();
    console.log('MANUAL-FEED-SMELTER=' + JSON.stringify({
      crushed: countOf(state, 'crushed_ore'),
      smelter: machineById(state, smelterId),
    }));
    assert(countOf(state, 'crushed_ore') === 0, 'manual feeding must consume the crushed ore from the inventory');

    // 等 4 个铁锭产出（熔炼 6s/个，额定速度；补能量以维持加工）。
    let ingots = 0;
    for (let index = 0; index < 60; index += 1) {
      await play.advance(1.0);
      state = await h.state();
      const smelterNow = machineById(state, smelterId);
      ingots = smelterNow.producedTotal;
      if (ingots >= 4) break;
      await ensurePowered();
    }
    state = await h.state();
    console.log('SCENARIO-A=' + JSON.stringify({
      produced: state.production.produced,
      smelter: machineById(state, smelterId),
      ports: state.ports,
    }));
    assert((machineById(state, smelterId).producedTotal ?? 0) >= 4, 'manual production must smelt at least 4 ingots');
    assert(state.ports.length === 0, 'scenario A must run without any interface box');
    await takeByRightClick(points['smelter'], 2);
    state = await h.state();
    assert(countOf(state, 'iron_ingot') >= 4, 'the smelted ingots must be collectable into the inventory');
    await play.screenshot('03-scenario-a-manual');
  });

  await play.step('04-scenario-b-craft-and-install', async () => {
    // 建锻压机支路，用真实配方锻出接口盒。
    cal.value = await h.calibrate('LEVEL0-FORGE');
    for (const item of FORGE_BRANCH) {
      const pt = await h.pointForCell(cal.value, item.cell, { avoidHover: true });
      points[item.label] = pt;
      await placeRotated(pt, item.slot, item.rot, item.label, item.cell);
    }
    await h.clearHover();
    await ensurePowered();
    let state = await h.state();
    const forge = machineOf(state, 'forge-shaft');
    assert(forge !== undefined && forge.powered === true, 'the forge must be powered by the same network');
    const forgeId = forge.partId;
    points['forge'] = await hoverMachine(FORGE_CELL, forgeId);

    // R 键循环到「锻压基础接口盒」。注意：R 同时会转动放置幽灵，必须走 cycleRecipe() 记账。
    for (let guard = 0; guard < 8; guard += 1) {
      state = await h.state();
      const current = machineById(state, forgeId);
      if (current.recipeId === 'forge-interface-box') break;
      await play.mouse.move(points['forge']);
      await play.wait(120);
      await cycleRecipe();
    }
    state = await h.state();
    console.log('FORGE-RECIPE=' + JSON.stringify({ recipe: machineById(state, forgeId).recipeId }));
    assert(machineById(state, forgeId).recipeId === 'forge-interface-box', 'R must cycle the forge to the interface box recipe');

    const boxBefore = countOf(state, 'interface_box');
    const ingotsBefore = countOf(state, 'iron_ingot');
    await ensurePowered();
    await feedByC(points['forge'], 2);
    state = await h.state();
    assert(countOf(state, 'iron_ingot') === ingotsBefore - 2, 'forging an interface box must consume 2 ingots');

    // 等产出并取走。
    let forged = false;
    for (let index = 0; index < 40; index += 1) {
      await play.advance(1.0);
      state = await h.state();
      if (machineById(state, forgeId).outputCount > 0) { forged = true; break; }
      await ensurePowered();
    }
    assert(forged, 'the forge must finish at least one interface box');
    await takeByRightClick(points['forge'], 1);
    state = await h.state();
    console.log('CRAFT-BOX=' + JSON.stringify({
      boxBefore,
      boxAfter: countOf(state, 'interface_box'),
      produced: state.production.produced,
    }));
    assert(countOf(state, 'interface_box') === boxBefore + 1, 'the crafted interface box must be a real inventory item');

    // 安装到熔炼炉输入安装位。
    const smelterId = machineOf(state, 'smelt-crushed-ore').partId;
    points['smelter'] = await hoverMachine(SMELTER_CELL, smelterId);
    const beforeInstall = countOf(await h.state(), 'interface_box');
    await play.keyboard.press('KeyT');
    await play.advance(0.3);
    state = await h.state();
    console.log('SCENARIO-B=' + JSON.stringify({ beforeInstall, after: countOf(state, 'interface_box'), ports: state.ports }));
    assert(countOf(state, 'interface_box') === beforeInstall - 1, 'installing must consume exactly one interface box');
    assert(state.ports.length === 1, 'exactly one interface box must be installed');
    assert(state.ports[0].partId === smelterId, 'the box must be installed on the smelter');
    assert(state.ports[0].slotId === 'slot.smelter.in.nz', 'the box must occupy the smelter input mount slot');
    await play.screenshot('04-scenario-b-installed');
  });

  await play.step('05-scenario-c-automatic-input', async () => {
    // 放溜槽：只能在熔炼炉 -Z 侧朝 +Z 推料才接得上输入安装位。
    cal.value = await h.calibrate('LEVEL0-CHUTE');
    const pt = await h.pointForCell(cal.value, CHUTE_CELL, { avoidHover: true });
    points['chute'] = pt;
    await placeRotated(pt, CHUTE, 270, 'chute', CHUTE_CELL);
    await h.clearHover();
    let state = await h.state();
    assert(state.production.chutes.length === 1, 'the chute must be tracked');

    await ensurePowered();
    const crusherId = machineOf(state, 'crush-iron-ore').partId;
    const smelterId = machineOf(state, 'smelt-crushed-ore').partId;
    points['crusher'] = await hoverMachine(CRUSHER_CELL, crusherId);
    const before = state.production.produced;
    const beforeIngots = before.find((entry) => entry.itemId === 'iron_ingot')?.count ?? 0;
    await feedByC(points['crusher'], 2);

    let sawBoxItem = false;
    let delivered = false;
    for (let index = 0; index < 60; index += 1) {
      await play.advance(1.0);
      state = await h.state();
      const box = state.ports[0];
      if (box && box.count > 0) sawBoxItem = true;
      const ingots = state.production.produced.find((entry) => entry.itemId === 'iron_ingot')?.count ?? 0;
      if (ingots > beforeIngots) { delivered = true; break; }
      await ensurePowered();
    }
    console.log('SCENARIO-C=' + JSON.stringify({
      sawBoxItem,
      delivered,
      ports: state.ports,
      produced: state.production.produced,
      smelter: machineById(state, machineOf(state, 'smelt-crushed-ore').partId),
    }));
    assert(delivered, 'the chute must deliver material through the interface box into the smelter');
    await play.screenshot('05-scenario-c-auto');
  });
}
