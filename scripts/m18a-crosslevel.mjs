// M1.8-A 验收：跨层机械传动
// 一楼动力源 → 水平轴 → 立式传动带（穿层）→ 二楼水平轴 → 二楼破碎机
// 断言：连通时二楼机器有动力；离合断开后停转；拆掉/重建立式传动带后网络与空间注册仍正确。
//
// 布局（全部靠真实鼠标键盘操作）：
//   L0 飞轮(-4,6) → 轴(-3,6) → 轴(-2,6) → 立式传动带(-1,6)
//   立式传动带顶端口 = (-1+1, 3.5, 6.5) = (0, 3.5, 6.5)
//   L1（固定平台上）轴(0,6) → 破碎机(1,6)
// 注意：相机跟随玩家且初始 yaw 是 45°，所以每次移动玩家之后都要重新标定；
//       移动方向由 m18-helpers 的 learnMovement() 实测四个方向键的世界向量后组合。
import { createHarness } from './m18-helpers.mjs';

const FLYWHEEL = 8;
const SHAFT = 0;
const VERTICAL = 7;
const CRUSHER = 9;

export default async function playthrough(play) {
  const h = createHarness(play);
  const assert = h.assert;

  const points = {};
  let cal0;

  await play.step('01-learn-movement-and-calibrate', async () => {
    const s = await h.state();
    assert(s.player.level === 0, 'player must start on level 0');
    await h.learnMovement();
    cal0 = await h.calibrate('LEVEL0');
    console.log('PLAYER=' + JSON.stringify((await h.state()).player));
  });

  await play.step('02-build-ground-drivetrain', async () => {
    // 先算好屏幕点：放下零件后该格被占用，探针就定位不到了。
    for (const cell of [{ gx: -4, gz: 6 }, { gx: -3, gz: 6 }, { gx: -2, gz: 6 }, { gx: -1, gz: 6 }]) {
      points[cell.gx + ',' + cell.gz] = await h.pointForCell(cal0, cell);
    }
    await h.placePartAtPoint(points['-4,6'], FLYWHEEL, 0, 'flywheel', { gx: -4, gz: 6 });
    await h.placePartAtPoint(points['-3,6'], SHAFT, 0, 'shaft-a', { gx: -3, gz: 6 });
    await h.placePartAtPoint(points['-2,6'], SHAFT, 0, 'shaft-b', { gx: -2, gz: 6 });
    await h.placePartAtPoint(points['-1,6'], VERTICAL, 0, 'vertical-drive', { gx: -1, gz: 6 });
    await h.clearHover();
    const s = await h.state();
    console.log('GROUND=' + JSON.stringify({
      parts: s.parts.length,
      kinds: s.parts.map((p) => p.kind),
      levels: s.parts.map((p) => p.placement.level),
      networks: s.networks.length,
      networkParts: s.networks[0] ? s.networks[0].partIds.length : 0,
      source: s.sources[0],
    }));
    assert(s.parts.length === 4, 'expected 4 ground parts, got ' + s.parts.length);
    assert(s.networks.length === 1, 'ground chain must form one network, got ' + s.networks.length);
    assert(s.networks[0].partIds.length === 4, 'network must contain all 4 ground parts');
    assert(s.sources.length === 1, 'exactly one power source expected');
    assert(s.sources[0].energy !== null, 'the official power source must expose an energy pool');
    assert(s.sources[0].energyCapacity >= 300, 'flywheel capacity must be >= 300');
    await play.screenshot('02-ground-drivetrain');
  });

  await play.step('03-climb-fixed-stairs', async () => {
    // 固定楼梯 x[-4,0) z[3,4)：先绕到西侧 x<-4 的 z=3 行，再向东爬上平台。
    assert(await h.gotoCell({ gx: -6, gz: 2 }, 16000, true), 'must reach (-6,2)');
    assert(await h.gotoCell({ gx: -6, gz: 3 }, 8000, true), 'must reach the stair foot (-6,3)');
    assert(await h.climbTo(1, 1, 0, 140), 'must climb the fixed stairs to level 1');
    // 站远一点：玩家 AABB 半宽 0.35m，贴着目标格会挡住相邻格的机器放置。
    assert(await h.gotoCell({ gx: 4, gz: 6 }, 16000, true), 'must walk onto the platform to (4,6)');
    const s = await h.state();
    console.log('CLIMBED=' + JSON.stringify({ level: s.player.level, cell: s.player.cell, support: s.player.supportId }));
    assert(s.player.level === 1, 'player must be on level 1, got ' + s.player.level);
    await play.screenshot('03-on-level-1');
  });

  let cal1;
  await play.step('04-build-upper-machine', async () => {
    cal1 = await h.calibrate('LEVEL1');
    points['0,6'] = await h.pointForCell(cal1, { gx: 0, gz: 6 }, { avoidHover: true });
    points['1,6'] = await h.pointForCell(cal1, { gx: 1, gz: 6 }, { avoidHover: true });
    await h.placePartAtPoint(points['0,6'], SHAFT, 0, 'upper-shaft', { gx: 0, gz: 6 });
    await h.placePartAtPoint(points['1,6'], CRUSHER, 0, 'upper-crusher', { gx: 1, gz: 6 });
    await h.clearHover();
    const s = await h.state();
    const upper = s.parts.filter((p) => p.placement.level === 1);
    console.log('UPPER=' + JSON.stringify({
      total: s.parts.length,
      upper: upper.length,
      networks: s.networks.map((n) => n.status + ':' + n.partIds.length),
    }));
    assert(s.parts.length === 6, 'expected 6 parts after building the upper machine, got ' + s.parts.length);
    assert(upper.length === 2, 'two parts must be on level 1, got ' + upper.length);
    assert(s.networks.length === 1,
      'cross-level chain must collapse into ONE network, got ' + s.networks.length
      + ' — the vertical drive is not connecting the floors');
    assert(s.networks[0].partIds.length === 6,
      'all 6 parts must be in the same network across levels, got ' + s.networks[0].partIds.length);
    assert(s.production.machines.length === 1, 'the crusher must be tracked as a production machine');
    await play.screenshot('04-upper-machine-built');
  });

  await play.step('05-descend-and-wind', async () => {
    // 必须先走到楼梯顶端那一格（z=3 行、x=0）才能下楼梯；在平台中部往西走会被"没有支撑"挡住。
    assert(await h.gotoCell({ gx: 0, gz: 3 }, 18000, true), 'must walk to the top of the fixed stairs (0,3)');
    assert(await h.climbTo(0, -1, 0, 140), 'must descend to level 0');
    assert(await h.gotoCell({ gx: -5, gz: 6 }, 16000, true), 'must walk next to the flywheel');
    await h.holdKey('KeyC', 3200);
    const s = await h.state();
    console.log('WOUND=' + JSON.stringify(s.sources[0]));
    assert(s.sources[0].energy > 0, 'holding F next to the flywheel must store energy, got ' + s.sources[0].energy);
    await play.screenshot('05-wound');
  });

  await play.step('06-engage-and-verify', async () => {
    cal0 = await h.calibrate('LEVEL0-WORK');
    const flywheelPoint = await h.pointForCell(cal0, { gx: -4, gz: 6 });
    await h.selectSlot(SHAFT);
    await h.clickAt(flywheelPoint);
    await h.rightClickAt(flywheelPoint);
    await play.advance(0.5);
    const s = await h.state();
    console.log('ENGAGED=' + JSON.stringify({
      engaged: s.sources[0].engaged,
      energy: Math.round(s.sources[0].energy),
      networkStatus: s.networks.map((n) => n.status),
      machines: s.machines.map((m) => ({ powered: m.powered, rpm: Math.round(m.rpm) })),
      production: s.production.machines.map((m) => ({ powered: m.powered, running: m.running, block: m.block })),
    }));
    assert(s.sources[0].engaged === true, 'right-click must engage the flywheel clutch');
    assert(s.networks[0].status === 'powered', 'network must be powered, got ' + s.networks[0].status);
    assert(s.machines.length === 1 && s.machines[0].powered === true,
      'the level-1 machine must be driven through the vertical drive');
    assert(Math.abs(s.machines[0].rpm) > 5, 'level-1 machine must actually rotate, rpm=' + s.machines[0].rpm);
    assert(s.production.machines.length === 1 && s.production.machines[0].powered === true,
      'the production machine must report powered (same solve result)');
    points['-4,6'] = flywheelPoint;
    await play.screenshot('06-cross-level-powered');
  });

  await play.step('07-disengage-stops-upper-machine', async () => {
    await h.rightClickAt(points['-4,6']);
    await play.advance(0.4);
    const s = await h.state();
    console.log('DISENGAGED=' + JSON.stringify({
      engaged: s.sources[0].engaged,
      machines: s.machines.map((m) => ({ powered: m.powered, rpm: Math.round(m.rpm) })),
      production: s.production.machines.map((m) => ({ powered: m.powered, block: m.block })),
    }));
    assert(s.sources[0].engaged === false, 'right-click must disengage the clutch');
    assert(s.machines[0].powered === false, 'upper machine must stop when the source is disengaged');
    await play.screenshot('07-disengaged');
    await h.rightClickAt(points['-4,6']);
    await play.advance(0.4);
    const again = await h.state();
    assert(again.machines[0].powered === true, 'machine must resume after re-engaging');
  });

  await play.step('08-remove-vertical-drive-breaks-link', async () => {
    await h.parkOnEmptySlot();
    const pt = await h.pointForCell(cal0, { gx: -1, gz: 6 });
    await h.selectSlot(VERTICAL);
    await h.clickAt(pt);
    await play.keyboard.press('Delete');
    await play.advance(0.4);
    const s = await h.state();
    console.log('CUT=' + JSON.stringify({
      parts: s.parts.length,
      networks: s.networks.map((n) => n.status + ':' + n.partIds.length),
      machines: s.machines.map((m) => m.powered),
    }));
    assert(s.parts.length === 5, 'removing the vertical drive must leave 5 parts, got ' + s.parts.length);
    assert(s.networks.length === 2,
      'cutting the vertical drive must split the network in two, got ' + s.networks.length);
    assert(s.machines[0].powered === false,
      'the upper machine must lose power when the vertical drive is removed');
    await play.screenshot('08-cut-cross-level');
  });

  await play.step('09-rebuild-vertical-drive', async () => {
    const pt = await h.pointForCell(cal0, { gx: -1, gz: 6 });
    await h.placePartAtPoint(pt, VERTICAL, 0, 'vertical-drive-rebuilt', { gx: -1, gz: 6 });
    await h.clearHover();
    let s = await h.state();
    console.log('REBUILT=' + JSON.stringify({
      parts: s.parts.length,
      networks: s.networks.map((n) => n.partIds.length),
    }));
    assert(s.parts.length === 6, 'rebuilt vertical drive must bring parts back to 6, got ' + s.parts.length);
    assert(s.networks.length === 1, 'rebuilding must rejoin the network into one component');
    assert(s.networks[0].partIds.length === 6, 'all six parts must be connected again');
    await play.screenshot('09-rebuilt');

    // 再摇一次补能量，确认二楼机器重新转起来。
    assert(await h.gotoCell({ gx: -5, gz: 6 }, 16000, true), 'must stand next to the flywheel again');
    await h.holdKey('KeyC', 3200);
    cal0 = await h.calibrate('LEVEL0-FINAL');
    const flywheelPoint = await h.pointForCell(cal0, { gx: -4, gz: 6 });
    await h.selectSlot(SHAFT);
    let now = await h.state();
    if (now.sources[0].engaged !== true) {
      await h.clickAt(flywheelPoint);
      await h.rightClickAt(flywheelPoint);
      await play.advance(0.4);
    }
    now = await h.state();
    console.log('FINAL=' + JSON.stringify({
      engaged: now.sources[0].engaged,
      energy: Math.round(now.sources[0].energy),
      networks: now.networks.map((n) => n.status),
      machines: now.machines.map((m) => ({ powered: m.powered, rpm: Math.round(m.rpm) })),
    }));
    assert(now.machines[0].powered === true, 'upper machine must run again after rebuild + rewind');
    await play.screenshot('10-final-running');
  });
}
