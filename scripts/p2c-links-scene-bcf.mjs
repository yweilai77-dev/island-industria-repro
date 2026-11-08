// P2-C 验收场景 B / C / F：双路合流 → 一路分流 → 三级串联生产线 + 制造演示。
import { LAYOUT_B, LAYOUT_C, LAYOUT_F } from './p2c-links-lib.mjs';

/** 按格查零件（脚本里所有引用都从真实读投影推导，不假设 partId 顺序）。 */
function partAt(state, gx, gz) {
  return state.parts.find((part) => part.placement.gx === gx && part.placement.gz === gz);
}

export async function runSceneB(play, h, C) {
  const {
    assert, points, state, producedOf, machineOf, machineById, portsOf, linksTo,
    heldInPorts, heldInMachines, placeLayout, onPart, enableAllSources, feedByC,
    waitFor, removeAllParts,
  } = C;

  await play.step('10-scene-b-merge-build', async () => {
    const placed = await placeLayout(LAYOUT_B);
    await enableAllSources(LAYOUT_B);
    const ready = await waitFor((now) => now.production.machines.length === 3
      && now.production.machines.every((machine) => machine.powered === true), 8, 'scene-b-power');
    const s = ready.state;
    console.log('SCENE-B-LINE=' + JSON.stringify({
      parts: placed.parts.length,
      machines: s.production.machines.map((m) => ({ id: m.partId, recipe: m.recipeId })),
    }));
    assert(placed.parts.length === LAYOUT_B.length, 'scene B must place ' + LAYOUT_B.length + ' parts');
    assert(s.production.machines.length === 3, 'two crushers + one smelter must be tracked');
    await play.screenshot('10-scene-b-built');
  });

  await play.step('11-scene-b-install-and-merge', async () => {
    let s = await state();
    const smelterId = machineOf(s, 'smelt-crushed-ore').partId;
    const c1Id = partAt(s, -4, 7).partId;
    const c2Id = partAt(s, -5, 7).partId;
    const sm = { gx: -4, gz: 8 };
    const c1 = { gx: -4, gz: 7 };
    const c2 = { gx: -5, gz: 7 };

    // 合流盒（L）装在下游输入位；两台上游各装一个输出接口盒（O）。
    await onPart(sm, smelterId, 'KeyL');
    await onPart(c1, c1Id, 'KeyO');
    await onPart(c2, c2Id, 'KeyO');
    s = await state();
    console.log('SCENE-B-PORTS=' + JSON.stringify(s.ports));
    assert(portsOf(s, smelterId).length === 1, 'the smelter must have the merger on its input slot');
    assert(portsOf(s, smelterId)[0].slotId === 'slot.smelter.in.nz', 'merger must sit on the input mount slot');
    assert(portsOf(s, c1Id).length === 1 && portsOf(s, c2Id).length === 1, 'both crushers need output boxes');

    // 两路合流：每个上游各一条连接，都指向同一台下游，但各自保留独立连接身份。
    await onPart(c1, c1Id, 'KeyJ');
    await onPart(sm, smelterId, 'KeyJ');
    await onPart(c2, c2Id, 'KeyJ');
    await onPart(sm, smelterId, 'KeyJ');
    s = await state();
    console.log('SCENE-B-LINKS=' + JSON.stringify(s.links));
    assert(s.links.length === 2, 'the merger must accept two independent links');
    assert(s.links.every((link) => link.to.entityId === smelterId), 'both links must enter the same smelter');
    assert(new Set(s.links.map((link) => link.from.entityId)).size === 2, 'each input keeps its own identity');

    await feedByC(points['B-crusher1'], 2);
    await feedByC(points['B-crusher2'], 2);
    const merged = await waitFor((now) => machineById(now, smelterId).producedTotal >= 4, 45, 'scene-b-merge');
    s = merged.state;
    console.log('SCENE-B-MERGED=' + JSON.stringify({
      produced: s.production.produced,
      links: s.links,
      smelter: machineById(s, smelterId),
    }));
    assert(merged.ok, 'both upstream streams must reach the downstream smelter');
    assert(producedOf(s, 'crushed_ore') >= 4, 'both crushers must produce');
    assert(producedOf(s, 'iron_ingot') >= 4, 'the merged material must be smelted');
    const moved = linksTo(s, smelterId).reduce((total, link) => total + link.moved, 0);
    assert(moved >= 4, 'the two links must each carry material (no overwrite, no loss)');
    await play.screenshot('11-scene-b-merged');
  });

  await play.step('12-scene-b-downstream-full', async () => {
    let s = await state();
    const smelterId = machineOf(s, 'smelt-crushed-ore').partId;
    const smSource = partAt(s, -6, 8);
    assert(smSource && smSource.kind === 'power-source', 'the smelter power source must exist');
    await C.setSource({ gx: -6, gz: 8 }, smSource.partId, false);
    s = await state();

    const ingotsBefore = machineById(s, smelterId).producedTotal;
    const crushedBefore = producedOf(s, 'crushed_ore');
    const movedBefore = linksTo(s, smelterId).reduce((total, link) => total + link.moved, 0);
    await feedByC(points['B-crusher1'], 4);
    await feedByC(points['B-crusher2'], 4);
    await play.advance(32);
    s = await state();

    const smelter = machineById(s, smelterId);
    const mergerBox = portsOf(s, smelterId)[0];
    console.log('SCENE-B-FULL=' + JSON.stringify({
      ingotsBefore,
      smelter: { input: smelter.inputCount, output: smelter.outputCount, produced: smelter.producedTotal },
      mergerBox,
      produced: s.production.produced,
      links: s.links,
      held: { ports: heldInPorts(s), machines: heldInMachines(s) },
    }));
    assert(smelter.producedTotal === ingotsBefore, 'an unpowered downstream must stop producing (no duplication)');
    assert(producedOf(s, 'crushed_ore') === crushedBefore + 8, 'both crushers must finish their 4-item batches');
    assert(smelter.inputCount === 4, 'the downstream input buffer must be full and stop transfer');
    assert(mergerBox.count > 0, 'material that cannot enter the machine must wait in the merger buffer');
    assert(linksTo(s, smelterId).reduce((total, link) => total + link.moved, 0) === movedBefore,
      'a blocked target must not accept more transfers, and nothing may be duplicated');
    assert(heldInPorts(s) + heldInMachines(s) >= 8, 'all blocked material must stay in buffers (nothing lost)');
    await play.screenshot('12-scene-b-full');
  });

  await play.step('13-scene-b-teardown', async () => {
    await removeAllParts();
    await play.screenshot('13-scene-b-teardown');
  });
}

export async function runSceneC(play, h, C) {
  const {
    assert, points, state, producedOf, machineOf, machineById, portsOf, linksTo, linksFrom,
    heldInPorts, heldInMachines, placeLayout, onPart, enableAllSources, feedByC,
    waitFor, removeAllParts,
  } = C;

  await play.step('20-scene-c-split-build', async () => {
    const placed = await placeLayout(LAYOUT_C);
    await enableAllSources(LAYOUT_C);
    const ready = await waitFor((now) => now.production.machines.length === 3
      && now.production.machines.every((machine) => machine.powered === true), 8, 'scene-c-power');
    console.log('SCENE-C-LINE=' + JSON.stringify({
      parts: placed.parts.length,
      machines: ready.state.production.machines.map((m) => ({ id: m.partId, recipe: m.recipeId })),
    }));
    assert(placed.parts.length === LAYOUT_C.length, 'scene C must place ' + LAYOUT_C.length + ' parts');
    await play.screenshot('20-scene-c-built');
  });

  await play.step('21-scene-c-install-and-split', async () => {
    let s = await state();
    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    const aId = partAt(s, -3, 8).partId;
    const bId = partAt(s, -2, 8).partId;
    const cr = { gx: -4, gz: 8 };
    const a = { gx: -3, gz: 8 };
    const b = { gx: -2, gz: 8 };

    // 分流盒（K）装在上游输出位；两台下游各装一个基础输入盒（T）。
    await onPart(cr, crusherId, 'KeyK');
    await onPart(a, aId, 'KeyT');
    await onPart(b, bId, 'KeyT');
    s = await state();
    assert(portsOf(s, crusherId).length === 1, 'the crusher must have the splitter installed');
    assert(portsOf(s, crusherId)[0].slotId === 'slot.crusher.out.px', 'splitter must sit on the output mount slot');

    await onPart(cr, crusherId, 'KeyJ');
    await onPart(a, aId, 'KeyJ');
    await onPart(cr, crusherId, 'KeyJ');
    await onPart(b, bId, 'KeyJ');
    s = await state();
    console.log('SCENE-C-LINKS=' + JSON.stringify(s.links));
    assert(s.links.length === 2, 'the splitter must fan out to two downstream links');
    assert(linksFrom(s, crusherId).length === 2, 'both links must start from the same splitter output');
    assert(new Set(s.links.map((link) => link.to.entityId)).size === 2, 'each link keeps its own identity');

    await feedByC(points['C-crusher'], 6);
    const split = await waitFor((now) => machineById(now, aId).producedTotal >= 3
      && machineById(now, bId).producedTotal >= 3, 45, 'scene-c-split');
    s = split.state;
    console.log('SCENE-C-SPLIT=' + JSON.stringify({
      produced: s.production.produced,
      links: s.links,
      smelters: [{ id: aId, produced: machineById(s, aId)?.producedTotal },
        { id: bId, produced: machineById(s, bId)?.producedTotal }],
    }));
    assert(split.ok, 'round-robin splitting must feed both downstream cores');
    assert(producedOf(s, 'crushed_ore') >= 6 && producedOf(s, 'iron_ingot') >= 6,
      'six ore must become six crushed ore and six ingots');
    const movedA = linksTo(s, aId)[0].moved;
    const movedB = linksTo(s, bId)[0].moved;
    assert(movedA === 3 && movedB === 3, 'round-robin must split 3 / 3, got ' + movedA + ' / ' + movedB);
    // 收走成品，避免产物缓冲满（4 格）阻塞下一段"目标不可用"测试。
    await C.takeByRightClick(points['C-smelter-a'], 1);
    await C.takeByRightClick(points['C-smelter-b'], 1);
    await play.screenshot('21-scene-c-split');
  });

  await play.step('22-scene-c-target-unavailable', async () => {
    let s = await state();
    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    const aId = partAt(s, -3, 8).partId;
    const bId = partAt(s, -2, 8).partId;
    const cr = { gx: -4, gz: 8 };
    const b = { gx: -2, gz: 8 };
    const aProduced = machineById(s, aId).producedTotal;
    const bProduced = machineById(s, bId).producedTotal;

    // 断开一台下游连接：分流目标只剩一个，物料必须全部走另一路。
    await onPart(b, bId, 'KeyH');
    s = await state();
    console.log('SCENE-C-UNLINK-B=' + JSON.stringify({ links: s.links }));
    assert(linksFrom(s, crusherId).length === 1, 'removing a link must leave only one splitter output connected');

    await feedByC(points['C-crusher'], 2);
    const remaining = await waitFor((now) => machineById(now, aId).producedTotal >= aProduced + 2, 35, 'scene-c-route-a');
    s = remaining.state;
    console.log('SCENE-C-ROUTE=' + JSON.stringify({
      a: machineById(s, aId), b: machineById(s, bId), links: s.links,
    }));
    assert(remaining.ok, 'with one target unavailable all material must go through the remaining link');
    assert(machineById(s, bId).producedTotal === bProduced, 'the disconnected downstream must not receive material');
    void producedOf;
    void heldInPorts;
    void heldInMachines;

    // 重新连接：分流恢复两路。
    await onPart(cr, crusherId, 'KeyJ');
    await onPart(b, bId, 'KeyJ');
    s = await state();
    assert(linksFrom(s, crusherId).length === 2, 'relinking must restore the second branch');
    await play.screenshot('22-scene-c-reconnected');
  });

  await play.step('23-scene-c-teardown', async () => {
    await removeAllParts();
    await play.screenshot('23-scene-c-teardown');
  });
}

export async function runSceneF(play, h, C) {
  const {
    assert, points, state, countOf, producedOf, machineOf, machineById, portsOf, linksTo,
    placeLayout, onPart, enableAllSources, feedByC, cycleRecipe,
    waitFor, removeAllParts, takeByRightClick,
  } = C;

  await play.step('30-scene-f-line-build', async () => {
    const placed = await placeLayout(LAYOUT_F);
    await enableAllSources(LAYOUT_F);
    const ready = await waitFor((now) => now.production.machines.length === 3
      && now.production.machines.every((machine) => machine.powered === true), 10, 'scene-f-power');
    const s = ready.state;
    console.log('SCENE-F-LINE=' + JSON.stringify({
      parts: placed.parts.length,
      machines: s.production.machines.map((m) => ({ id: m.partId, recipe: m.recipeId })),
    }));
    assert(placed.parts.length === LAYOUT_F.length, 'scene F must place ' + LAYOUT_F.length + ' parts');
    await play.screenshot('30-scene-f-built');
  });

  await play.step('31-scene-f-three-stage-production', async () => {
    let s = await state();
    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    const smelterId = machineOf(s, 'smelt-crushed-ore').partId;
    const forgeId = machineOf(s, 'forge-shaft').partId;
    const cr = { gx: -4, gz: 8 };
    const sm = { gx: -3, gz: 8 };
    const fg = { gx: -3, gz: 7 };

    await onPart(cr, crusherId, 'KeyO');
    await onPart(sm, smelterId, 'KeyT');
    await onPart(sm, smelterId, 'KeyO');
    await onPart(fg, forgeId, 'KeyT');
    s = await state();
    console.log('SCENE-F-PORTS=' + JSON.stringify(s.ports));
    assert(portsOf(s, crusherId).length === 1 && portsOf(s, smelterId).length === 2 && portsOf(s, forgeId).length === 1,
      'each core must have the expected input/output interfaces');

    await onPart(cr, crusherId, 'KeyJ');
    await onPart(sm, smelterId, 'KeyJ');
    await onPart(sm, smelterId, 'KeyJ');
    await onPart(fg, forgeId, 'KeyJ');
    s = await state();
    console.log('SCENE-F-LINKS=' + JSON.stringify(s.links));
    assert(s.links.length === 2, 'the three-core line needs two material links');
    assert(s.links.every((link) => link.active === true), 'both links must be active');

    await feedByC(points['F-crusher'], 2);
    const chain = await waitFor((now) => machineById(now, forgeId).producedTotal >= 1, 60, 'scene-f-chain');
    s = chain.state;
    console.log('SCENE-F-CHAIN=' + JSON.stringify({
      produced: s.production.produced,
      links: s.links,
      forge: machineById(s, forgeId),
    }));
    assert(chain.ok, 'the three-core line must complete the full production loop');
    assert(producedOf(s, 'crushed_ore') >= 2 && producedOf(s, 'iron_ingot') >= 2,
      'crusher and smelter must both run');
    assert(producedOf(s, 'shaft') >= 1, 'the forge must consume ingots and produce a real machine part');
    assert(linksTo(s, smelterId)[0].moved >= 2, 'first link must carry crushed ore');
    assert(linksTo(s, forgeId)[0].moved >= 2, 'second link must carry ingots');
    await play.screenshot('31-scene-f-production');
  });

  await play.step('32-scene-f-craft-output-box', async () => {
    let s = await state();
    const forgeId = machineOf(s, 'forge-shaft').partId;
    const fg = { gx: -3, gz: 7 };
    const forgePoint = points['F-forge'];

    // 先取走已锻好的传动轴，避免产物缓冲混装。
    await C.hoverPart(fg, forgeId);
    await takeByRightClick(forgePoint, 1);
    s = await state();
    assert(countOf(s, 'shaft') >= 1, 'the forged shaft must be collectable');

    // 把锻压机配方切到「锻压输出接口盒」：从 forge-shaft 起按 4 次 R。
    for (let guard = 0; guard < 10; guard += 1) {
      s = await state();
      if (machineOf(s, 'forge-output-box')) break;
      await cycleRecipe(forgePoint);
    }
    s = await state();
    console.log('SCENE-F-RECIPE=' + JSON.stringify({ recipe: machineById(s, forgeId).recipeId }));
    assert(machineById(s, forgeId).recipeId === 'forge-output-box', 'R must cycle the forge to the output-box recipe');

    const boxBefore = countOf(s, 'output_interface_box');
    await feedByC(points['F-crusher'], 2);
    const forged = await waitFor((now) => producedOf(now, 'output_interface_box') >= 1, 60, 'scene-f-craft');
    s = forged.state;
    assert(forged.ok, 'the forge must produce a real output interface box');
    await C.hoverPart(fg, forgeId);
    await takeByRightClick(forgePoint, 1);
    s = await state();
    console.log('SCENE-F-CRAFT=' + JSON.stringify({
      boxBefore,
      boxAfter: countOf(s, 'output_interface_box'),
      produced: s.production.produced,
    }));
    assert(countOf(s, 'output_interface_box') === boxBefore + 1,
      'the crafted output interface box must become a real inventory item');
    await play.screenshot('32-scene-f-crafted-box');
  });

  await play.step('33-scene-f-teardown', async () => {
    await removeAllParts();
    const s = await state();
    console.log('SCENE-F-FINAL=' + JSON.stringify({
      parts: s.parts.length,
      links: s.links.length,
      ports: s.ports.length,
      inventory: s.inventory.map((entry) => entry.itemId + ':' + entry.count),
      produced: s.production.produced,
    }));
    await play.screenshot('33-scene-f-teardown');
  });
}
