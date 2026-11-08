// M1.8-C/D 验收：正式加工机器 + 最小自动运输（铁矿石 → 碎铁矿 → 铁锭 → 入库）
//
// 整条产线建在地面（跨层部分由 m18a-crosslevel.mjs 单独验收），布局：
//   飞轮(-8,8) → 轴(-7,8) → 轴(-6,8) → 12T(-5,8) ┬→ 轴(-4,8) → 破碎机(-3,8)  产物出口 (-2,8)
//                                                └→ 24T(-5,9) → 轴(-4,9) → 轴(-3,9) → 熔炼炉(-2,9)
//   运输：破碎机 → 重力溜槽(-2,8) 朝南 → 熔炼炉(-2,9) 输入缓冲
// 断言：加工依赖动力；断轴时进度冻结；产物经溜槽真的进下一台机器；铁锭进库存；断轴/复电可恢复。
import { createHarness } from './m18-helpers.mjs';
import { runForgeStage } from './m18c-production-forge.mjs';

const SHAFT = 0;
const GEAR12 = 1;
const GEAR24 = 2;
const VERTICAL = 7;
const CHUTE = 6;
const FLYWHEEL = 8;
const CRUSHER = 9;
const SMELTER = 10;
const FORGE = 11;

const ORE_TARGET = 12;

const LAYOUT = [
  { cell: { gx: -8, gz: 8 }, slot: FLYWHEEL, rot: 0, label: 'flywheel' },
  { cell: { gx: -7, gz: 8 }, slot: SHAFT, rot: 0, label: 'shaft-a' },
  { cell: { gx: -6, gz: 8 }, slot: SHAFT, rot: 0, label: 'shaft-b' },
  { cell: { gx: -5, gz: 8 }, slot: GEAR12, rot: 0, label: 'gear12' },
  { cell: { gx: -4, gz: 8 }, slot: SHAFT, rot: 0, label: 'shaft-c' },
  { cell: { gx: -3, gz: 8 }, slot: CRUSHER, rot: 0, label: 'crusher' },
  { cell: { gx: -5, gz: 9 }, slot: GEAR24, rot: 0, label: 'gear24' },
  { cell: { gx: -4, gz: 9 }, slot: SHAFT, rot: 0, label: 'shaft-d' },
  { cell: { gx: -3, gz: 9 }, slot: SHAFT, rot: 0, label: 'shaft-e' },
  { cell: { gx: -2, gz: 9 }, slot: SMELTER, rot: 0, label: 'smelter' },
  { cell: { gx: -2, gz: 8 }, slot: CHUTE, rot: 270, label: 'chute' },
];

export default async function playthrough(play) {
  const h = createHarness(play);
  const assert = h.assert;
  const points = {};
  let cal;

  await play.step('01-learn-harvest-ore', async () => {
    await h.learnMovement();
    cal = await h.calibrate('LEVEL0');
    assert(await h.gotoCell({ gx: -6, gz: 4 }, 16000, true), 'must reach ore node A');
    const before = (await h.state()).inventory.find((e) => e.itemId === 'iron_ore')?.count ?? 0;
    for (let i = 0; i < ORE_TARGET; i += 1) {
      await play.keyboard.press('KeyF');
      await play.advance(3.4);
      await play.wait(90);
    }
    const s = await h.state();
    const ore = s.inventory.find((e) => e.itemId === 'iron_ore')?.count ?? 0;
    console.log('HARVEST=' + JSON.stringify({ before, ore }));
    assert(ore >= before + ORE_TARGET - 1, 'harvesting must add iron ore to the inventory, got ' + ore + ' from ' + before);
    await play.screenshot('01-harvested');
  });

  await play.step('02-build-production-line', async () => {
    assert(await h.gotoCell({ gx: -7, gz: 7 }, 16000, true), 'must walk to the building spot');
    cal = await h.calibrate('LEVEL0-WORK');
    for (const item of LAYOUT) {
      const pt = await h.pointForCell(cal, item.cell, { avoidHover: true });
      points[item.label] = pt;
      await h.placePartAtPoint(pt, item.slot, item.rot, item.label, item.cell);
    }
    await h.clearHover();
    const s = await h.state();
    const main = s.networks.find((n) => n.partIds.length > 1) ?? s.networks[0];
    console.log('FACTORY=' + JSON.stringify({
      parts: s.parts.length,
      networks: s.networks.map((n) => n.status + ':' + n.partIds.length),
      machines: s.production.machines.map((m) => ({ id: m.partId, recipe: m.recipeLabel })),
      chutes: s.production.chutes.map((c) => ({ id: c.partId, item: c.itemId })),
    }));
    assert(s.parts.length === LAYOUT.length,
      'expected ' + LAYOUT.length + ' parts, got ' + s.parts.length);
    assert(main !== undefined && main.partIds.length === LAYOUT.length - 1,
      'all parts except the chute must share ONE power network, got ' + JSON.stringify(s.networks.map((n) => n.partIds.length)));
    assert(s.production.machines.length === 2, 'crusher + smelter must be tracked, got ' + s.production.machines.length);
    assert(s.production.chutes.length === 1, 'exactly one chute expected');
    assert(s.production.machines.every((m) => m.powered === false), 'machines must be unpowered before engaging');
    assert(s.production.machines.every((m) => m.block === 'no-power'), 'machines must report no-power before engaging');
    await play.screenshot('02-factory-built');
  });

  await play.step('02b-install-input-port', async () => {
    // P2-B（方案 P1）：溜槽不再能直接往机器里倒料，自动输入必须经过输入安装位上的接口盒。
    // 这条已验收产线因此多了一步：给熔炼炉装上接口盒（盒子来自开局原型套件，之后也能在锻压机造）。
    await h.selectSlot(SHAFT);
    const smelterId = (await h.state()).production.machines.find((m) => m.recipeId === 'smelt-crushed-ore').partId;
    const point = await h.hoverSpecificPart(cal, { gx: -2, gz: 9 }, smelterId);
    assert(point !== null, 'must be able to aim at the smelter to install the interface box');
    await play.mouse.move(point);
    await play.wait(150);
    const before = (await h.state()).inventory.find((e) => e.itemId === 'interface_box')?.count ?? 0;
    assert(before >= 1, 'the prototype kit must grant at least one interface box, got ' + before);
    await play.keyboard.press('KeyT');
    await play.advance(0.25);
    const s = await h.state();
    const afterBox = s.inventory.find((e) => e.itemId === 'interface_box')?.count ?? 0;
    console.log('PORT-INSTALL=' + JSON.stringify({ before, after: afterBox, ports: s.ports }));
    assert(afterBox === before - 1, 'installing must consume exactly one interface box (' + before + ' -> ' + afterBox + ')');
    assert(s.ports.length === 1, 'exactly one installed interface box expected, got ' + JSON.stringify(s.ports));
    assert(s.ports[0].partId === smelterId, 'the box must be installed on the smelter');
    assert(s.ports[0].slotId === 'slot.smelter.in.nz', 'the box must sit on the smelter input mount slot');
    await play.screenshot('02b-interface-box-installed');
    await h.clearHover();
  });

  await play.step('03-wind-and-engage', async () => {
    await h.holdKey('KeyC', 7200);
    cal = await h.calibrate('LEVEL0-POWER');
    await h.selectSlot(SHAFT);
    const sourcePart = (await h.state()).parts.find((p) => p.kind === 'power-source');
    assert(sourcePart !== undefined, 'the flywheel source must exist');
    const flywheelPoint = await h.hoverSpecificPart(cal, { gx: -8, gz: 8 }, sourcePart.partId);
    assert(flywheelPoint !== null, 'must be able to aim at the flywheel (not the neighbouring shaft)');
    points['flywheel'] = flywheelPoint;
    await h.clickAt(flywheelPoint);
    await h.rightClickAt(flywheelPoint);
    await play.advance(0.6);
    const s = await h.state();
    console.log('ENGAGED=' + JSON.stringify({
      engaged: s.sources[0].engaged,
      energy: Math.round(s.sources[0].energy),
      capacity: s.sources[0].energyCapacity,
      networks: s.networks.map((n) => n.status),
      machines: s.production.machines.map((m) => ({ id: m.partId, powered: m.powered, block: m.block })),
    }));
    assert(s.sources[0].engaged === true, 'clutch must engage');
    assert(s.production.machines.every((m) => m.powered === true), 'both machines must be powered');
    assert(s.production.machines.every((m) => m.block === 'no-input'), 'powered machines with no material must report no-input');
    await play.screenshot('03-engaged');
  });

  await play.step('04-feed-crusher', async () => {
    await h.selectSlot(SHAFT);
    const crusherId = (await h.state()).production.machines.find((m) => m.recipeId === 'crush-iron-ore').partId;
    const hoveredPoint = await h.hoverSpecificPart(cal, { gx: -3, gz: 8 }, crusherId);
    assert(hoveredPoint !== null, 'must be able to aim at the crusher');
    points['crusher'] = hoveredPoint;
    const hovered = { point: hoveredPoint, partId: crusherId };
    await play.mouse.move(hovered.point);
    await play.wait(150);
    const oreBefore = (await h.state()).inventory.find((e) => e.itemId === 'iron_ore')?.count ?? 0;
    for (let i = 0; i < 2; i += 1) {
      await play.keyboard.press('KeyC');
      await play.advance(0.06);
    }
    const s = await h.state();
    const crusher = s.production.machines.find((m) => m.partId === hovered.partId);
    const oreAfter = s.inventory.find((e) => e.itemId === 'iron_ore')?.count ?? 0;
    console.log('FED=' + JSON.stringify({ crusher, oreBefore, oreAfter }));
    assert(crusher !== undefined, 'crusher state must exist');
    assert(oreAfter === oreBefore - 2,
      'pressing C twice must take 2 ore from the inventory (' + oreBefore + ' -> ' + oreAfter + ')');
    assert(crusher.running === true, 'crusher must be running while powered');
    assert(crusher.progress > 0 || crusher.inputCount > 0, 'crusher must have started a cycle');
    await play.screenshot('04-fed');
  });

  await play.step('05-automatic-transport-and-smelting', async () => {
    let sawChute = false;
    let firstIngot = null;
    for (let i = 0; i < 60; i += 1) {
      await play.advance(1.0);
      const s = await h.state();
      const chute = s.production.chutes[0];
      if (chute && chute.itemId !== null) sawChute = true;
      const smelter = s.production.machines.find((m) => m.recipeId === 'smelt-crushed-ore');
      if (smelter && (smelter.outputCount > 0 || smelter.producedTotal > 0)) {
        firstIngot = smelter;
        break;
      }
      // 动力用尽就补摇（玩家就在飞轮旁边，按住 C 充电，真实输入）。
      if (s.sources[0].enabled !== true) {
        await h.holdKey('KeyC', 2000);
        const fw = points['flywheel'];
        await h.selectSlot(SHAFT);
        await h.clickAt(fw);
        await h.rightClickAt(fw);
        await play.advance(0.3);
      }
    }
    const s = await h.state();
    console.log('PIPELINE=' + JSON.stringify({
      sawChute,
      smelter: firstIngot && {
        produced: firstIngot.producedTotal,
        outputCount: firstIngot.outputCount,
        outputItem: firstIngot.outputItem,
        inputCount: firstIngot.inputCount,
        progress: firstIngot.progress,
        block: firstIngot.block,
      },
      produced: s.production.produced,
      energy: Math.round(s.sources[0].energy),
    }));
    assert(firstIngot !== null, 'the smelter must finish at least one iron ingot');
    assert(sawChute === true, 'the crusher product must be visible travelling on the chute');
    assert(firstIngot.outputItem === 'iron_ingot', 'smelter output must be iron_ingot, got ' + firstIngot.outputItem);
    await play.screenshot('05-smelted');
  });

  await play.step('06-collect-ingot-into-inventory', async () => {
    const before = (await h.state()).inventory.find((e) => e.itemId === 'iron_ingot')?.count ?? 0;
    await h.selectSlot(SHAFT);
    const smelterId = (await h.state()).production.machines.find((m) => m.recipeId === 'smelt-crushed-ore').partId;
    const hoveredPoint = await h.hoverSpecificPart(cal, { gx: -2, gz: 9 }, smelterId);
    assert(hoveredPoint !== null, 'must be able to aim at the smelter');
    await play.mouse.move(hoveredPoint);
    await play.wait(150);
    await h.rightClickAt(hoveredPoint);
    await play.advance(0.4);
    const after = (await h.state()).inventory.find((e) => e.itemId === 'iron_ingot')?.count ?? 0;
    console.log('COLLECT=' + JSON.stringify({ before, after }));
    assert(after > before, 'right-click must move the iron ingot into the inventory (' + before + ' -> ' + after + ')');
    await play.screenshot('06-ingot-collected');
  });

  await play.step('07-broken-shaft-freezes-processing', async () => {
    // 拆掉 12T 齿轮：整条动力链断开，两台机器都失去动力，但进度必须冻结而不是清零。
    await h.selectSlot(SHAFT);
    const gear = (await h.state()).parts.find((p) => p.placement.gx === -5 && p.placement.gz === 8);
    assert(gear !== undefined, 'the 12T gear must exist');
    const hoveredPoint = await h.hoverSpecificPart(cal, { gx: -5, gz: 8 }, gear.partId);
    assert(hoveredPoint !== null, 'must be able to aim at the gear');
    await h.clickAt(hoveredPoint);
    await play.keyboard.press('Delete');
    await play.advance(0.5);
    const s = await h.state();
    const machines = s.production.machines;
    console.log('CUT=' + JSON.stringify({
      parts: s.parts.length,
      networks: s.networks.map((n) => n.status + ':' + n.partIds.length),
      machines: machines.map((m) => ({ id: m.partId, powered: m.powered, block: m.block, progress: m.progress })),
    }));
    assert(s.parts.length === LAYOUT.length - 1, 'removing the gear must leave ' + (LAYOUT.length - 1) + ' parts');
    assert(machines.every((m) => m.powered === false), 'machines must lose power when the shaft train is broken');
    const frozen = machines.map((m) => m.progress);
    await play.advance(1.5);
    const later = (await h.state()).production.machines;
    for (let i = 0; i < later.length; i += 1) {
      assert(Math.abs(later[i].progress - frozen[i]) < 1e-6,
        'progress must freeze while unpowered (machine ' + later[i].partId + ': ' + frozen[i] + ' -> ' + later[i].progress + ')');
    }
    await play.screenshot('07-broken');
  });

  await play.step('08-rebuild-restores-power', async () => {
    const pt = await h.pointForCell(cal, { gx: -5, gz: 8 });
    await h.placePartAtPoint(pt, GEAR12, 0, 'gear12-rebuilt', { gx: -5, gz: 8 });
    await h.clearHover();
    // 补能量：飞轮耗尽后 engaged=false，但离合（enabled）仍挂着 —— 只要摇柄补能量就会自动恢复输出。
    const beforeHold = await h.state();
    await h.holdKey('KeyC', 4600);
    const afterHold = await h.state();
    console.log('REWIND=' + JSON.stringify({
      beforeEnergy: Math.round(beforeHold.sources[0].energy),
      afterEnergy: Math.round(afterHold.sources[0].energy),
      playerPos: afterHold.player.position.map((v) => Math.round(v * 100) / 100),
    }));
    let s = afterHold;
    if (s.sources[0].enabled !== true) {
      await h.selectSlot(SHAFT);
      await h.clickAt(points['flywheel']);
      await h.rightClickAt(points['flywheel']);
      await play.advance(0.5);
      s = await h.state();
    }
    console.log('REBUILT=' + JSON.stringify({
      parts: s.parts.length,
      player: s.player,
      sources: s.sources,
      engaged: s.sources[0].engaged,
      networks: s.networks.map((n) => ({ status: n.status, reason: n.reason, partIds: n.partIds, sourceIds: n.sourceIds })),
      topologyParts: s.parts.map((p) => ({ id: p.partId, kind: p.kind, gx: p.placement.gx, gz: p.placement.gz, comp: p.componentId })),
      machines: s.production.machines.map((m) => ({ powered: m.powered, block: m.block })),
    }));
    assert(s.parts.length === LAYOUT.length, 'rebuilding the gear must restore the part count');
    assert(s.production.machines.every((m) => m.powered === true), 'machines must be powered again after the rebuild');
    await play.screenshot('08-rebuilt');
  });

  await play.step('09-line-runs-repeatably', async () => {
    // 再投一次料，证明整条链路可以重复运行。
    await h.selectSlot(SHAFT);
    const crusherId2 = (await h.state()).production.machines.find((m) => m.recipeId === 'crush-iron-ore').partId;
    const hoveredPoint2 = await h.hoverSpecificPart(cal, { gx: -3, gz: 8 }, crusherId2);
    assert(hoveredPoint2 !== null, 'must be able to aim at the crusher again');
    await play.mouse.move(hoveredPoint2);
    await play.wait(140);
    await play.keyboard.press('KeyC');
    await play.advance(0.06);
    const before = (await h.state()).production.produced;
    let increased = false;
    for (let i = 0; i < 60; i += 1) {
      await play.advance(1.0);
      const s = await h.state();
      const now = s.production.produced;
      const crushedNow = now.find((p) => p.itemId === 'crushed_ore')?.count ?? 0;
      const crushedBefore = before.find((p) => p.itemId === 'crushed_ore')?.count ?? 0;
      if (crushedNow > crushedBefore) {
        increased = true;
        break;
      }
      if (s.sources[0].enabled !== true) {
        await h.holdKey('KeyC', 2000);
        await h.selectSlot(SHAFT);
        await h.clickAt(points['flywheel']);
        await h.rightClickAt(points['flywheel']);
        await play.advance(0.3);
      }
    }
    const s = await h.state();
    console.log('REPEAT=' + JSON.stringify({ increased, produced: s.production.produced }));
    assert(increased, 'feeding again must produce more crushed ore (the line must run repeatedly)');
    await play.screenshot('09-repeat');
  });

  await play.step('10-forge-ingots-into-a-part', async () => {
    await runForgeStage(play, h, { points, cal, assert, LAYOUT, SHAFT, GEAR24, FORGE });
  });
}
