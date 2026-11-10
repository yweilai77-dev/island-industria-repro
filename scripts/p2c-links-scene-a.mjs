// P2-C 验收场景 A / D / E：两核心直接对接 → 断链/重连 → 旋转与拆卸接口。
// 从 p2c-links.mjs 按功能拆出（单文件不超过工程 20 KB 提交上限）。
import { LAYOUT_A } from './p2c-links-lib.mjs';

export async function runSceneA(play, h, C) {
  const {
    assert, points, state, countOf, producedOf, machineOf, machineById, partOf, portsOf, linksTo,
    heldInPorts, heldInMachines, placeLayout, hoverPart, onPart, enableAllSources, feedByC,
    feedMachine, collectMachine, takeByRightClick, waitFor, removeAllParts, calibrate, shot, constants,
  } = C;
  const { SHAFT, ORE_TARGET_A, ORE_TARGET_B, ORE_NODE_A_VIEW, ORE_NODE_B_VIEW, BUILD_SPOT } = constants;

  await play.step('01-harvest-ore', async () => {
    await h.learnMovement();
    await calibrate('LEVEL0-ORE-A');
    // 中央有固定平台(-4..-1,3..4 楼梯 / 0..8,2..8 平台)，跨区移动必须绕开它。
    const VIA_SOUTH_WEST = [{ gx: -8, gz: 4 }, { gx: -8, gz: -4 }];
    const VIA_WEST = [{ gx: -8, gz: -4 }, { gx: -8, gz: 7 }];
    const walk = async (waypoints, finalCell) => {
      for (const waypoint of waypoints) {
        assert(await h.gotoCell(waypoint, 16000, true), 'must reach waypoint ' + JSON.stringify(waypoint));
      }
      assert(await h.gotoCell(finalCell, 20000, true), 'must reach ' + JSON.stringify(finalCell));
    };

    assert(await h.gotoCell(ORE_NODE_A_VIEW, 16000, true), 'must reach iron ore node A');
    const before = countOf(await state(), 'iron_ore');
    // P2-E3 兼容性：改为状态驱动（按目标库存补齐），对 CDP 输入偶发丢帧不敏感。
    let attemptsA = 0;
    while (countOf(await state(), 'iron_ore') - before < ORE_TARGET_A - 1 && attemptsA < ORE_TARGET_A * 2) {
      await play.keyboard.hold('KeyF', 60);
      await play.advance(0.2);
      await play.advance(3.0);
      await play.wait(60);
      attemptsA += 1;
    }
    const afterA = countOf(await state(), 'iron_ore');
    console.log('HARVEST-A=' + JSON.stringify({ before, afterA }));
    assert(afterA >= before + ORE_TARGET_A - 1, 'harvesting node A must add iron ore');

    // P2-E3 平衡兼容：单点储量 20 -> 60 后，矿点 A（-5,4 2x2）不会因为本场景的采集而枯竭，
    // 而场景 B 的 B-source-crusher1 需要 (-4,5)（仍在 A 占地内）。这里把 A 挖空腾出建造格。
    let stall = 0;
    for (let guard = 0; guard < 90 && stall < 3; guard += 1) {
      const n = countOf(await state(), 'iron_ore');
      await play.keyboard.hold('KeyF', 60);
      await play.advance(0.2);
      await play.advance(3.0);
      await play.wait(40);
      const m = countOf(await state(), 'iron_ore');
      stall = m > n ? 0 : stall + 1;
    }
    console.log('NODE-A-DEPLETED=' + JSON.stringify({ ore: countOf(await state(), 'iron_ore') }));

    await walk(VIA_SOUTH_WEST, ORE_NODE_B_VIEW);
    let attemptsB = 0;
    while (countOf(await state(), 'iron_ore') - afterA < ORE_TARGET_B - 1 && attemptsB < ORE_TARGET_B * 2) {
      await play.keyboard.hold('KeyF', 60);
      await play.advance(0.2);
      await play.advance(3.0);
      await play.wait(60);
      attemptsB += 1;
    }
    const ore = countOf(await state(), 'iron_ore');
    console.log('HARVEST-B=' + JSON.stringify({ afterA, ore }));
    assert(ore >= afterA + ORE_TARGET_B - 1, 'harvesting node B must add iron ore');

    await walk(VIA_WEST, BUILD_SPOT);
    await shot('01-harvested');
  });

  await play.step('02-scene-a-build-line', async () => {
    await calibrate('LEVEL0-WORK');
    let s = await placeLayout(LAYOUT_A);
    await enableAllSources(LAYOUT_A);
    const ready = await waitFor((now) => now.production.machines.length === 2
      && now.production.machines.every((machine) => machine.powered === true), 6, 'scene-a-power');
    s = ready.state;
    console.log('SCENE-A-LINE=' + JSON.stringify({
      parts: s.parts.length,
      machines: s.production.machines.map((m) => ({ id: m.partId, recipe: m.recipeId, powered: m.powered })),
      ports: s.ports,
      links: s.links,
    }));
    assert(s.parts.length === LAYOUT_A.length, 'scene A must place ' + LAYOUT_A.length + ' parts');
    assert(s.production.machines.length === 2, 'crusher + smelter must be tracked');
    await shot('02-line-built');
  });

  await play.step('03-scene-a-install-and-link', async () => {
    let s = await state();
    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    const smelterId = machineOf(s, 'smelt-crushed-ore').partId;
    const cr = { gx: -4, gz: 8 };
    const sm = { gx: -3, gz: 8 };

    // 输出接口盒（O）装在上游输出位；基础接口盒（T）装在下游输入位。
    await onPart(cr, crusherId, 'KeyO');
    await onPart(sm, smelterId, 'KeyT');
    s = await state();
    console.log('SCENE-A-PORTS=' + JSON.stringify(s.ports));
    assert(portsOf(s, crusherId).length === 1, 'crusher must have exactly one output interface box');
    assert(portsOf(s, crusherId)[0].slotId === 'slot.crusher.out.px', 'output box must sit on the output mount slot');
    assert(portsOf(s, smelterId).length === 1, 'smelter must have exactly one input interface box');
    assert(portsOf(s, smelterId)[0].slotId === 'slot.smelter.in.nz', 'input box must sit on the input mount slot');

    // 「相邻 ≠ 自动连接」：只装盒子、还没有建立连接时，产物不会自己过到下游。
    const oreBefore = countOf(s, 'iron_ore');
    await feedMachine({ gx: -4, gz: 8 }, crusherId, 2);
    s = await state();
    assert(countOf(s, 'iron_ore') === oreBefore - 2, 'pressing C twice must consume 2 ore');
    const crushed = await waitFor((now) => producedOf(now, 'crushed_ore') >= 1, 8, 'crushed-before-link');
    s = crushed.state;
    assert(s.links.length === 0, 'no material link may exist yet');
    assert(machineById(s, smelterId).producedTotal === 0, 'without a link the downstream must not receive material');
    console.log('SCENE-A-NOLINK=' + JSON.stringify({ ports: s.ports, links: s.links, smelter: machineById(s, smelterId) }));

    // 真实建链：J 选中上游输出接口，再 J 连到下游输入接口。
    await onPart(cr, crusherId, 'KeyJ');
    await onPart(sm, smelterId, 'KeyJ');
    s = await state();
    console.log('SCENE-A-LINK=' + JSON.stringify(s.links));
    assert(s.links.length === 1, 'exactly one material link must be created');
    assert(s.links[0].from.entityId === crusherId && s.links[0].to.entityId === smelterId,
      'link must go from crusher output to smelter input');
    assert(s.links[0].active === true && s.links[0].status === 'ok', 'link must be active right after creation');

    const delivered = await waitFor((now) => machineById(now, smelterId).producedTotal >= 2, 30, 'scene-a-deliver');
    s = delivered.state;
    console.log('SCENE-A-DELIVERED=' + JSON.stringify({
      produced: s.production.produced,
      smelter: machineById(s, smelterId),
      links: s.links,
    }));
    assert(delivered.ok, 'material must travel from the crusher into the smelter automatically');
    assert(producedOf(s, 'iron_ingot') >= 2, 'the smelter must smelt the delivered crushed ore');
    assert(linksTo(s, smelterId)[0].moved >= 2, 'the link read projection must count the transferred items');
    // 收走铁锭，给后续场景留出成品缓冲（产物缓冲只有 4 格，收走后才能继续产出）。
    await collectMachine({ gx: -3, gz: 8 }, smelterId, 1);
    await shot('03-scene-a-linked');
  });

  await play.step('04-scene-d-disconnect-reconnect', async () => {
    let s = await state();
    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    const smelterId = machineOf(s, 'smelt-crushed-ore').partId;
    const cr = { gx: -4, gz: 8 };
    const sm = { gx: -3, gz: 8 };
    const producedBefore = machineById(s, smelterId).producedTotal;

    // 断开连接：物料必须停在接口盒/缓冲里，不消失。
    await onPart(sm, smelterId, 'KeyH');
    s = await state();
    console.log('SCENE-D-UNLINK=' + JSON.stringify({ links: s.links, ports: s.ports }));
    assert(s.links.length === 0, 'H must remove the material link');

    await feedMachine({ gx: -4, gz: 8 }, crusherId, 2);
    const crushedBefore = producedOf(s, 'crushed_ore');
    const held = await waitFor((now) => producedOf(now, 'crushed_ore') >= crushedBefore + 2, 14, 'scene-d-held');
    s = held.state;
    console.log('SCENE-D-HELD=' + JSON.stringify({
      produced: s.production.produced,
      smelter: machineById(s, smelterId),
      ports: s.ports,
      inventory: s.inventory,
    }));
    assert(machineById(s, smelterId).producedTotal === producedBefore,
      'without a link the downstream must not produce more');
    assert(heldInPorts(s) + heldInMachines(s) >= 2, 'material must be preserved in buffers after the link is cut');
    await shot('04-scene-d-disconnected');

    // 重新连接：物料继续流动。
    await onPart(cr, crusherId, 'KeyJ');
    await onPart(sm, smelterId, 'KeyJ');
    const resumed = await waitFor((now) => machineById(now, smelterId).producedTotal >= producedBefore + 2, 30, 'scene-d-resume');
    s = resumed.state;
    console.log('SCENE-D-RESUMED=' + JSON.stringify({ produced: s.production.produced, links: s.links }));
    assert(resumed.ok, 'reconnecting the link must resume automatic transfer');
    await takeByRightClick(points['A-smelter'], 1);
    await shot('04-scene-d-reconnected');
  });

  await play.step('05-scene-e-rotate-and-remove-port', async () => {
    let s = await state();
    const smelterId = machineOf(s, 'smelt-crushed-ore').partId;
    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    const sm = { gx: -3, gz: 8 };
    const smelterPart = () => partOf(s, smelterId);

    // 旋转下游核心：端口位置/朝向与连接一起改变；连接失效但保留，物料不丢。
    await onPart(sm, smelterId, 'KeyU');
    s = await state();
    const rotated = partOf(s, smelterId);
    console.log('SCENE-E-ROTATE=' + JSON.stringify({
      placement: rotated.placement,
      links: s.links,
      smelter: machineById(s, smelterId),
    }));
    assert(rotated.placement.rotation === 180, 'U must rotate the processing core by 90 degrees');
    assert(s.links.length === 1 && s.links[0].active === false,
      'the link must become inactive once rotation breaks the docking geometry');
    assert(s.links[0].status === 'inactive-geometry', 'the link status must explain the broken geometry');
    const producedWhileRotated = machineById(s, smelterId).producedTotal;

    // 转回原朝向：连接自动恢复（不重建、不丢料）。
    for (let index = 0; index < 3; index += 1) await onPart(sm, smelterId, 'KeyU');
    s = await state();
    console.log('SCENE-E-ROTATE-BACK=' + JSON.stringify({ placement: partOf(s, smelterId).placement, links: s.links }));
    assert(partOf(s, smelterId).placement.rotation === 90, 'rotating three more times must return to 90 degrees');
    assert(s.links.length === 1 && s.links[0].active === true, 'the link must recover after rotating back');

    // 拆卸输入接口：连接解除、盒与盒内物料返还，自动传输停止。
    if (machineById(s, smelterId).producedTotal !== producedWhileRotated) {
      await waitFor((now) => now.production.machines.every((machine) => machine.block !== 'ok'), 6, 'settle');
      s = await state();
    }
    const boxBefore = countOf(s, 'interface_box');
    await onPart(sm, smelterId, 'KeyY');
    s = await state();
    console.log('SCENE-E-REMOVE-PORT=' + JSON.stringify({
      boxBefore,
      boxAfter: countOf(s, 'interface_box'),
      ports: s.ports,
      links: s.links,
    }));
    assert(portsOf(s, smelterId).length === 0, 'Y must remove the input interface box');
    assert(countOf(s, 'interface_box') === boxBefore + 1, 'removing the box must refund exactly one item');
    assert(s.links.length === 0, 'removing the endpoint must release its material link');

    // 没有输入接口：物料停在上游接口盒/缓冲，不丢。
    const crushedBefore = producedOf(s, 'crushed_ore');
    await feedMachine({ gx: -4, gz: 8 }, crusherId, 2);
    const parked = await waitFor((now) => producedOf(now, 'crushed_ore') >= crushedBefore + 2, 14, 'scene-e-parked');
    s = parked.state;
    assert(heldInPorts(s) + heldInMachines(s) >= 2, 'material must stay in buffers while the input port is missing');
    await shot('05-scene-e-port-removed');

    // 重新安装并重连：物流恢复。
    await onPart(sm, smelterId, 'KeyT');
    await onPart({ gx: -4, gz: 8 }, machineOf(s, 'crush-iron-ore').partId, 'KeyJ');
    await onPart(sm, smelterId, 'KeyJ');
    s = await state();
    assert(portsOf(s, smelterId).length === 1, 'reinstalling must restore the input interface box');
    assert(s.links.length === 1, 'relinking must restore the material link');
    const finalProduced = machineById(s, smelterId).producedTotal;
    const recovered = await waitFor((now) => machineById(now, smelterId).producedTotal > finalProduced, 30, 'scene-e-recover');
    s = recovered.state;
    console.log('SCENE-E-RECOVERED=' + JSON.stringify({ produced: s.production.produced, links: s.links }));
    assert(recovered.ok, 'after reinstalling the port and relinking, material must flow again');
    await takeByRightClick(points['A-smelter'], 1);
    await shot('05-scene-e-recovered');
  });

  await play.step('06-scene-a-teardown', async () => {
    await removeAllParts();
    const s = await state();
    console.log('SCENE-A-TEARDOWN=' + JSON.stringify({
      parts: s.parts.length,
      links: s.links.length,
      ports: s.ports.length,
      inventory: s.inventory.map((entry) => entry.itemId + ':' + entry.count),
    }));
    await shot('06-teardown');
  });
}