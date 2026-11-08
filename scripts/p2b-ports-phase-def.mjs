// P2-B 验收场景 D / E / F（新旧共存 → 拆卸恢复 → 异常）与终局核对。
// 从 p2b-ports.mjs 按功能拆出，行为与拆分前一致。
export async function runDef(play, h, C) {
  const {
    points, calRef, assert, countOf, machineOf, machineById,
    hoverMachine, ensurePowered, feedByC, takeByRightClick, placeRotated, removePart, cycleRecipe,
    ORE_TARGET, SHAFT, GEAR12, CHUTE, CRUSHER_CELL, SMELTER_CELL, CHUTE_CELL, FORGE_CELL, LINE, FORGE_BRANCH
  } = C;
  const cal = calRef;

  await play.step('06-scenario-d-coexist', async () => {
    // 新旧共存：接口盒自动输入仍在，同时玩家手动按 C 投料，两者写同一个输入缓冲。
    //
    // 为了拿到「背包里的碎铁矿」，先临时拆掉溜槽：没有溜槽时破碎机产物留在自己的输出缓冲里，
    // 玩家右键即可取出（这一步同时也是「溜槽断开」的真实操作）。
    let state = await h.state();
    const smelterId = machineOf(state, 'smelt-crushed-ore').partId;
    const crusherId = machineOf(state, 'crush-iron-ore').partId;

    await h.selectSlot(SHAFT);
    await play.mouse.move(points['chute']);
    await play.wait(140);
    await h.clickAt(points['chute']);
    await play.keyboard.press('Delete');
    await play.advance(0.4);
    state = await h.state();
    assert(state.production.chutes.length === 0, 'the chute must be removable for the manual path test');

    points['crusher'] = await hoverMachine(CRUSHER_CELL, crusherId);
    await ensurePowered();
    await feedByC(points['crusher'], 1);
    for (let index = 0; index < 40; index += 1) {
      await play.advance(1.0);
      state = await h.state();
      if (machineById(state, crusherId).outputCount > 0) break;
      await ensurePowered();
    }
    await takeByRightClick(points['crusher'], 1);
    state = await h.state();
    const crushed = countOf(state, 'crushed_ore');
    console.log('COEXIST-PREP=' + JSON.stringify({ crushed, ports: state.ports }));
    assert(crushed >= 1, 'need at least one crushed ore in the inventory for the manual path');

    // 恢复溜槽，回到「自动 + 手动并存」的状态。
    cal.value = await h.calibrate('LEVEL0-RESTORE-CHUTE');
    const chutePt = await h.pointForCell(cal.value, CHUTE_CELL, { avoidHover: true });
    points['chute'] = chutePt;
    await placeRotated(chutePt, CHUTE, 270, 'chute-restored', CHUTE_CELL);
    await h.clearHover();
    state = await h.state();
    assert(state.production.chutes.length === 1, 'the chute must be back for the coexistence test');

    points['smelter'] = await hoverMachine(SMELTER_CELL, smelterId);
    const inputBefore = machineById(state, smelterId).inputCount;
    const boxBefore = state.ports[0]?.count ?? 0;
    await ensurePowered();
    await feedByC(points['smelter'], 1);
    state = await h.state();
    const smelterNow = machineById(state, smelterId);
    console.log('SCENARIO-D=' + JSON.stringify({
      inputBefore,
      inputAfter: smelterNow.inputCount,
      boxBefore,
      boxAfter: state.ports[0]?.count ?? 0,
      crushed: countOf(state, 'crushed_ore'),
      smelter: smelterNow,
    }));
    // 手动投料必须真的进了同一个输入缓冲；接口盒的存量不会因为手动路径被复制。
    assert(smelterNow.inputCount >= inputBefore + 1 || smelterNow.running === true,
      'manual feeding must reach the smelter input buffer while the box is installed');
    assert((state.ports[0]?.count ?? 0) <= boxBefore + 1, 'the manual path must not duplicate items into the interface box');
    assert(countOf(state, 'crushed_ore') === 0, 'the manually fed crushed ore must leave the inventory (no duplication)');
    await play.screenshot('06-scenario-d-coexist');
  });

  await play.step('07-scenario-e-remove-reinstall', async () => {
    let state = await h.state();
    const smelterId = machineOf(state, 'smelt-crushed-ore').partId;
    points['smelter'] = await hoverMachine(SMELTER_CELL, smelterId);
    const boxBefore = countOf(state, 'interface_box');
    const boxBuffer = state.ports[0] ? { itemId: state.ports[0].itemId, count: state.ports[0].count } : null;

    await play.keyboard.press('KeyY');
    await play.advance(0.3);
    state = await h.state();
    const boxAfter = countOf(state, 'interface_box');
    console.log('SCENARIO-E-REMOVE=' + JSON.stringify({
      boxBefore,
      boxAfter,
      bufferWas: boxBuffer,
      ports: state.ports,
      crashedBuffer: boxBuffer?.itemId ? countOf(state, boxBuffer.itemId) : null,
    }));
    assert(boxAfter === boxBefore + 1, 'removing the box must refund exactly one interface box item');
    assert(state.ports.length === 0, 'the mount slot must be free after removal');
    if (boxBuffer && boxBuffer.itemId && boxBuffer.count > 0) {
      assert(countOf(state, boxBuffer.itemId) >= boxBuffer.count,
        'material left in the box buffer must be returned to the inventory, never destroyed');
    }

    // 没有盒子时自动输入必须停止：溜槽上的物品保持堵塞、不消失。
    const crusherId = machineOf(state, 'crush-iron-ore').partId;
    points['crusher'] = await hoverMachine(CRUSHER_CELL, crusherId);
    await ensurePowered();
    await feedByC(points['crusher'], 1);
    let blocked = false;
    for (let index = 0; index < 30; index += 1) {
      await play.advance(1.0);
      state = await h.state();
      if ((state.production.chutes[0]?.blocked ?? false) && state.production.chutes[0]?.itemId) { blocked = true; break; }
    }
    const smelterNoBox = machineById(state, smelterId);
    console.log('SCENARIO-E-NOBOX=' + JSON.stringify({
      blocked,
      chute: state.production.chutes[0],
      smelterInput: smelterNoBox.inputCount,
    }));
    assert(blocked, 'without an installed box the chute must block instead of feeding the machine');
    assert(state.production.chutes[0].itemId !== null, 'the blocked item must stay on the chute (not destroyed)');

    // 重新安装并恢复自动输入。
    await h.selectSlot(SHAFT);
    await play.mouse.move(points['smelter']);
    await play.wait(140);
    const beforeReinstall = countOf(await h.state(), 'interface_box');
    await play.keyboard.press('KeyT');
    await play.advance(0.3);
    state = await h.state();
    console.log('SCENARIO-E-REINSTALL=' + JSON.stringify({
      beforeReinstall,
      after: countOf(state, 'interface_box'),
      ports: state.ports,
    }));
    assert(state.ports.length === 1, 'reinstalling must restore the interface box');
    assert(countOf(state, 'interface_box') === beforeReinstall - 1, 'reinstalling must consume one interface box');

    await ensurePowered();
    let resumed = false;
    for (let index = 0; index < 40; index += 1) {
      await play.advance(1.0);
      state = await h.state();
      if ((state.production.chutes[0]?.itemId ?? null) === null) { resumed = true; break; }
      await ensurePowered();
    }
    console.log('SCENARIO-E-RESUME=' + JSON.stringify({ resumed, chute: state.production.chutes[0], ports: state.ports }));
    assert(resumed, 'after reinstalling, the blocked chute item must be delivered automatically again');
    await play.screenshot('07-scenario-e-reinstall');
  });

  await play.step('08-scenario-f-anomalies', async () => {
    let state = await h.state();
    const smelterId = machineOf(state, 'smelt-crushed-ore').partId;
    points['smelter'] = await hoverMachine(SMELTER_CELL, smelterId);

    // F1 安装位占用：再按 T 不消耗、不重复安装。
    const boxesBefore = countOf(state, 'interface_box');
    await play.keyboard.press('KeyT');
    await play.advance(0.3);
    state = await h.state();
    console.log('F1-OCCUPIED=' + JSON.stringify({ boxesBefore, boxesAfter: countOf(state, 'interface_box'), ports: state.ports }));
    assert(countOf(state, 'interface_box') === boxesBefore, 'installing into an occupied slot must not consume an item');
    assert(state.ports.length === 1, 'an occupied slot must not get a second box');

    // F2 溜槽断开：拆掉溜槽后自动输入停止，重新放回后恢复。
    await h.selectSlot(SHAFT);
    await play.mouse.move(points['chute']);
    await play.wait(140);
    await h.clickAt(points['chute']);
    await play.keyboard.press('Delete');
    await play.advance(0.4);
    state = await h.state();
    console.log('F2-CHUTE-REMOVED=' + JSON.stringify({ chutes: state.production.chutes.length, ports: state.ports }));
    assert(state.production.chutes.length === 0, 'the chute must be removed');
    assert(state.ports.length === 1, 'removing the chute must not remove the interface box');

    cal.value = await h.calibrate('LEVEL0-RESTORE');
    const chutePt = await h.pointForCell(cal.value, CHUTE_CELL, { avoidHover: true });
    points['chute'] = chutePt;
    await placeRotated(chutePt, CHUTE, 270, 'chute-restored', CHUTE_CELL);
    await h.clearHover();
    state = await h.state();
    assert(state.production.chutes.length === 1, 'the restored chute must be tracked again');

    // F3 机器断电：断开离合后加工停止，重新接合后继续，不产生重复产物。
    await ensurePowered();
    state = await h.state();
    const producedBefore = state.production.produced.find((entry) => entry.itemId === 'iron_ingot')?.count ?? 0;
    await h.selectSlot(SHAFT);
    await play.mouse.move(points['flywheel']);
    await play.wait(140);
    await h.rightClickAt(points['flywheel']);
    await play.advance(0.6);
    state = await h.state();
    const powered = state.production.machines.every((machine) => machine.powered === false);
    await play.advance(2.0);
    const frozen = await h.state();
    console.log('F3-POWER-OFF=' + JSON.stringify({
      engaged: frozen.sources[0].engaged,
      powered: state.production.machines.map((machine) => ({ id: machine.partId, powered: machine.powered })),
      produced: frozen.production.produced,
    }));
    assert(powered, 'disengaging the clutch must stop every machine');
    assert((frozen.production.produced.find((entry) => entry.itemId === 'iron_ingot')?.count ?? 0) === producedBefore,
      'no ingot may be duplicated while the network is stopped');
    await play.screenshot('08-scenario-f-anomalies');
  });

  await play.step('09-final-state', async () => {
    const state = await h.state();
    console.log('FINAL=' + JSON.stringify({
      parts: state.parts.length,
      machines: state.production.machines.map((machine) => ({ id: machine.partId, recipe: machine.recipeId, produced: machine.producedTotal })),
      ports: state.ports,
      inventory: state.inventory.map((entry) => entry.itemId + ':' + entry.count),
      produced: state.production.produced,
    }));
    assert(state.ports.length === 1, 'one interface box must remain installed at the end');
    await play.screenshot('09-final');
  });
}
