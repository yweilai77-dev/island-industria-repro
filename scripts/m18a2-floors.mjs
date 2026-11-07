// M1.8-A2 验收：玩家自建楼板 / 楼梯 / 开孔，并让机械结构合法穿层
//
// 布局（全部真实鼠标键盘操作，位置避开铁矿点 / 固定平台 / 固定楼梯）：
//   z=0 行地板带：支柱(-8,0) 楼板(-8,0) 楼板(-7,0) 楼板(-6,0) 开孔(-5,0) 楼板(-4,0)
//   楼梯：(-12,0) 朝东 4 格 → 出口落在楼板(-8,0) 上
//   跨层：L0 轴(-6,0) → 立式传动带(-5,0) 穿过开孔 → L1 轴(-4,0)
// 断言：
//  1) 玩家能爬上**自己建**的楼梯到 level 1；
//  2) 楼板可以行走，开孔格**走不进去**（空气墙，不掉下去）；
//  3) 立式传动带能在开孔上放置并与上下两层轴连成同一动力网络。
import { createHarness } from './m18-helpers.mjs';

const SHAFT = 0;
const VERTICAL = 7;

const FLOORS = [
  { kind: 'pillar', cell: { gx: -8, gz: 0 }, rot: 0, label: 'pillar' },
  { kind: 'deck', cell: { gx: -8, gz: 0 }, rot: 0, label: 'deck-8' },
  { kind: 'deck', cell: { gx: -7, gz: 0 }, rot: 0, label: 'deck-7' },
  { kind: 'deck', cell: { gx: -6, gz: 0 }, rot: 0, label: 'deck-6' },
  { kind: 'opening', cell: { gx: -5, gz: 0 }, rot: 0, label: 'opening-5' },
  { kind: 'deck', cell: { gx: -4, gz: 0 }, rot: 0, label: 'deck-4' },
  // 第二排楼板：让二楼有一块像样的可建造/可行走区域（也便于验收脚本标定镜头）。
  { kind: 'deck', cell: { gx: -8, gz: 1 }, rot: 0, label: 'deck-8-1' },
  { kind: 'deck', cell: { gx: -7, gz: 1 }, rot: 0, label: 'deck-7-1' },
  { kind: 'deck', cell: { gx: -6, gz: 1 }, rot: 0, label: 'deck-6-1' },
  { kind: 'deck', cell: { gx: -5, gz: 1 }, rot: 0, label: 'deck-5-1' },
  { kind: 'deck', cell: { gx: -4, gz: 1 }, rot: 0, label: 'deck-4-1' },
  { kind: 'stair', cell: { gx: -12, gz: 0 }, rot: 0, label: 'stair-12' },
];

export default async function playthrough(play) {
  const h = createHarness(play);
  const assert = h.assert;
  let cal;
  const points = {};

  await play.step('01-learn-calibrate-build-floor', async () => {
    await h.learnMovement();
    cal = await h.calibrate('LEVEL0');
    await h.setFloorMode(true);
    for (const item of FLOORS) {
      await h.placeFloor(cal, item.kind, item.cell, item.rot);
    }
    await h.setFloorMode(false);
    await h.clearHover();
    const s = await h.state();
    console.log('FLOORS=' + JSON.stringify({ player: s.player.cell, parts: s.parts.length, floorMode: s.ui?.floorMode }));
    assert(s.parts.length === 0, 'floor structures are not mechanical parts');
    await play.screenshot('01-floors-built');
  });

  await play.step('02-place-cross-level-drivetrain', async () => {
    // L0 轴 + 立式传动带（穿过开孔）放在地面上；L1 轴等上到二楼再放。
    const shaftPt = await h.pointForCell(cal, { gx: -6, gz: 0 });
    const drivePt = await h.pointForCell(cal, { gx: -5, gz: 0 });
    points['-6,0'] = shaftPt;
    points['-5,0'] = drivePt;
    await h.placePartAtPoint(shaftPt, SHAFT, 0, 'l0-shaft', { gx: -6, gz: 0 });
    await h.placePartAtPoint(drivePt, VERTICAL, 0, 'vertical-drive-through-opening', { gx: -5, gz: 0 });
    await h.clearHover();
    const s = await h.state();
    console.log('GROUND-PARTS=' + JSON.stringify({ parts: s.parts.length, networks: s.networks.length }));
    assert(s.parts.length === 2, 'expected 2 ground parts, got ' + s.parts.length);
    await play.screenshot('02-drivetrain-through-opening');
  });

  await play.step('03-climb-self-built-stairs', async () => {
    assert(await h.gotoCell({ gx: -13, gz: 0 }, 18000, true), 'must reach the foot of the built stairs');
    assert(await h.climbTo(1, 1, 0, 160), 'must climb the player-built stair to level 1');
    const onStairTop = await h.state();
    console.log('CLIMBED=' + JSON.stringify({ level: onStairTop.player.level, cell: onStairTop.player.cell, support: onStairTop.player.supportId }));
    assert(onStairTop.player.level === 1, 'self-built stair must lift the player to level 1');
    assert(onStairTop.player.cell.gx === -8 && onStairTop.player.cell.gz === 0,
      'stair must drop the player onto the deck at (-8,0), got ' + JSON.stringify(onStairTop.player.cell));
    await play.screenshot('03-on-self-built-floor');
  });

  await play.step('04-walk-decks-and-blocked-by-opening', async () => {
    assert(await h.gotoCell({ gx: -6, gz: 0 }, 14000, true), 'must walk east across the decks to (-6,0)');
    const s = await h.state();
    console.log('WALKED=' + JSON.stringify({ level: s.player.level, cell: s.player.cell }));
    assert(s.player.level === 1, 'walking on deck must stay on level 1');
    // 继续向东：(-5,0) 是开孔，应该走不进去（没有可行支撑 → 空气墙）。
    for (let i = 0; i < 10; i += 1) await h.holdToward(1, 0, 160);
    const after = await h.state();
    console.log('OPENING-BLOCK=' + JSON.stringify({ level: after.player.level, cell: after.player.cell }));
    assert(after.player.level === 1, 'player must not fall through the opening');
    assert(!(after.player.cell.gx === -5 && after.player.cell.gz === 0),
      'player must NOT be able to stand on the opening cell');
    await play.screenshot('04-blocked-by-opening');
  });

  await play.step('05-build-level-1-shaft-and-verify-cross-level-link', async () => {
    const cal1 = await h.calibrate('LEVEL1');
    // 玩家站在 (-6,0)（楼板) 上，看向 (-4,0)（另一块楼板）。
    const shaftPt = await h.pointForCell(cal1, { gx: -4, gz: 0 });
    await h.placePartAtPoint(shaftPt, SHAFT, 0, 'l1-shaft', { gx: -4, gz: 0 });
    await h.clearHover();
    const s = await h.state();
    const upper = s.parts.filter((p) => p.placement.level === 1);
    console.log('CROSS-LEVEL=' + JSON.stringify({
      parts: s.parts.length,
      upper: upper.length,
      networks: s.networks.map((n) => ({ status: n.status, partIds: n.partIds })),
    }));
    assert(s.parts.length === 3, 'expected 3 mechanical parts, got ' + s.parts.length);
    assert(upper.length === 1, 'one part must be on level 1');
    assert(s.networks.length === 1,
      'the vertical drive must connect the two levels into ONE network, got ' + s.networks.length);
    assert(s.networks[0].partIds.length === 3,
      'network must contain both shafts and the drive, got ' + s.networks[0].partIds.length);
    await play.screenshot('05-cross-level-through-built-floor');
  });
}
