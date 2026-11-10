// M2.0-P2-D 真实游戏验收共享上下文：结构框架放置、组合查看、布局与断言助手。
//
// 复用 P2-C 的上下文（真实键鼠、只读唯一 GameRead `mechanical`、放置/供能/物流助手），
// 在其上补 P2-D 专用操作：
// - `P` 进入/退出结构放置模式（build/mechanical/ports 让出输入），左键在悬停格放置结构框架；
// - 选中成员核心/结构框架后读取 `ui.selectedAssemblyId` 与 `assemblies` 快照；
// - 场景布局（A 两核心、B 三核心、C 生产线 + 动力 + 组合）。
import { createCtx } from './p2c-links-lib.mjs';

const POWER = 3;
const SHAFT = 0;
const CRUSHER = 9;
const SMELTER = 10;
const FORGE = 11;

/** 场景 A：两台核心对角摆开，一个结构框架同时正交相邻于两者。 */
export const LAYOUT_A = [
  { cell: { gx: -4, gz: 8 }, slot: CRUSHER, rot: 0, label: 'A-crusher' },
  { cell: { gx: -3, gz: 9 }, slot: SMELTER, rot: 90, label: 'A-smelter' },
];
export const FRAMES_A = [{ gx: -4, gz: 9 }];

/** 场景 B：三台核心对角链 + 两个结构框架。 */
export const LAYOUT_B = [
  { cell: { gx: -4, gz: 8 }, slot: CRUSHER, rot: 270, label: 'B-crusher' },
  { cell: { gx: -4, gz: 9 }, slot: SMELTER, rot: 0, label: 'B-smelter' },
  { cell: { gx: -4, gz: 10 }, slot: FORGE, rot: 0, label: 'B-forge' },
];
// 每台核心旁的东侧框架；框架之间也互相正交相邻，组成一条结构链。
export const FRAMES_B = [{ gx: -3, gz: 8 }, { gx: -3, gz: 9 }, { gx: -3, gz: 10 }];

/**
 * 场景 C/D/E/F/G：真实生产线 + 动力 + 组合。
 * 破碎机(-4,8) rot270 输出 px → +Z，正对熔炼炉(-4,9) rot0 输入 nz；两者由两个结构框架组织。
 * 动力：破碎机「源(-4,6) 270 → 轴(-4,7) 270」；熔炼炉「源(-6,9) 0 → 轴(-5,9) 0」。
 * 框架 (-3,8)/(-3,9) 在东侧，不会占用动力链与玩家站位 (-6,7)。
 */
export const LAYOUT_C = [
  { cell: { gx: -4, gz: 6 }, slot: POWER, rot: 270, label: 'C-source-crusher' },
  { cell: { gx: -4, gz: 7 }, slot: SHAFT, rot: 270, label: 'C-shaft-crusher' },
  { cell: { gx: -6, gz: 9 }, slot: POWER, rot: 0, label: 'C-source-smelter' },
  { cell: { gx: -5, gz: 9 }, slot: SHAFT, rot: 0, label: 'C-shaft-smelter' },
  { cell: { gx: -4, gz: 8 }, slot: CRUSHER, rot: 270, label: 'C-crusher' },
  { cell: { gx: -4, gz: 9 }, slot: SMELTER, rot: 0, label: 'C-smelter' },
];
export const FRAMES_C = [{ gx: -3, gz: 8 }, { gx: -3, gz: 9 }];

export function createP2dCtx(play, h) {
  const C = createCtx(play, h);
  const { assert, state, countOf, aim, calibrate, shot } = C;

  const frameCount = (s) => countOf(s, 'structure_frame');
  const frameAt = (s, cell) => s.parts.find((part) => part.kind === 'structure'
    && part.placement.gx === cell.gx && part.placement.gz === cell.gz);
  const assemblyOfPart = (s, partId) => s.assemblies.find((assembly) => assembly.memberIds.includes(partId)
    || assembly.moduleIds.includes(partId));

  const walk = async (waypoints, finalCell) => {
    for (const waypoint of waypoints) {
      assert(await h.gotoCell(waypoint, 16000, true), 'must reach waypoint ' + JSON.stringify(waypoint));
    }
    assert(await h.gotoCell(finalCell, 20000, true), 'must reach ' + JSON.stringify(finalCell));
  };

  /** 到铁矿石节点 A 采一批矿，再绕开中央平台走回建造点。 */
  const harvestOre = async (count, nodeView, buildSpot) => {
    assert(await h.gotoCell(nodeView, 16000, true), 'must reach iron ore node A');
    const before = countOf(await state(), 'iron_ore');
    for (let index = 0; index < count; index += 1) {
      await play.keyboard.press('KeyF');
      await play.advance(3.4);
      await play.wait(80);
    }
    const after = countOf(await state(), 'iron_ore');
    assert(after >= before + count - 1, 'harvesting node A must add iron ore, got ' + (after - before));
    await walk([{ gx: -8, gz: 4 }, { gx: -8, gz: -4 }, { gx: -8, gz: 7 }], buildSpot);
    return after;
  };

  const enterStructureMode = async () => {
    let s = await state();
    assert(frameCount(s) > 0, 'structure mode needs at least one structure frame in inventory');
    if (!s.ui.structureMode) {
      await play.keyboard.press('KeyP');
      await play.advance(0.4);
      s = await state();
    }
    assert(s.ui.structureMode === true, 'P must enter structure placement mode');
    return s;
  };

  const exitStructureMode = async () => {
    const s = await state();
    if (!s.ui.structureMode) return;
    await play.keyboard.press('KeyP');
    await play.advance(0.3);
    assert((await state()).ui.structureMode === false, 'P must exit structure placement mode');
  };

  /** 悬停目标格 → 校验结构目标（含相邻原因）→ 左键放置结构框架。 */
  const placeFrameAt = async (cell, label = 'frame') => {
    // 屏幕坐标反解依赖普通建造的目标读数（buildTarget）；结构模式下 build 让出输入、
    // 不再发布目标，所以先在非结构模式解出屏幕点，再进入结构模式用同一个点。
    await exitStructureMode();
    const point = await aim(cell);
    const beforeCount = frameCount(await state());
    await enterStructureMode();
    await play.mouse.move(point);
    await play.wait(220);
    const aimed = await state();
    const target = aimed.ui.structureTarget;
    assert(target && target.active && target.cell && target.cell.gx === cell.gx && target.cell.gz === cell.gz,
      label + ': structure target must be ' + JSON.stringify(cell) + ', got ' + JSON.stringify(target));
    assert(target.valid === true, label + ': frame placement must be valid, reason=' + String(target.reason));
    await h.clickAt(point);
    await play.advance(0.5);
    const s = await state();
    assert(frameCount(s) === beforeCount - 1, label + ': placing a frame must consume exactly one item');
    const placed = frameAt(s, cell);
    assert(placed, label + ': frame part must exist at ' + JSON.stringify(cell));
    console.log('FRAME-PLACED ' + JSON.stringify({ label, cell, partId: placed.partId, frameCount: frameCount(s) }));
    return placed.partId;
  };

  /** 选中任意机械零件（成员核心或结构框架），读 ui.selectedPartId。 */
  const selectPart = async (cell, partId, label = 'part') => {
    await h.selectSlot(SHAFT);
    const point = await h.hoverSpecificPart(C.calRef.value, cell, partId);
    assert(point !== null, label + ': must be able to aim at part ' + partId);
    await play.mouse.move(point);
    await play.wait(160);
    await h.clickAt(point);
    await play.advance(0.35);
    const s = await state();
    assert(s.ui.selectedPartId === partId, label + ': selected part must be ' + partId
      + ', got ' + String(s.ui.selectedPartId));
    return s;
  };

  /** 带着选中高亮截图：先把鼠标移到天空去掉悬停高亮，只保留“被选中的那一个零件”+组合边界。 */
  const shotSelected = async (name) => {
    await play.mouse.move([0.02, 0.02]);
    await play.wait(160);
    await play.screenshot(name);
    await play.keyboard.press('Escape');
    await h.clearHover();
    await play.advance(0.2);
  };

  const assemblySummary = (assembly) => ({
    id: assembly.id,
    memberIds: assembly.memberIds,
    moduleIds: assembly.moduleIds,
    links: assembly.links.map((edge) => `${edge.aPartId}-${edge.bPartId}:${edge.kind}`),
    bounds: assembly.bounds,
    powerDemandTorque: assembly.powerDemandTorque,
    members: assembly.members.map((member) => ({
      partId: member.partId, coreId: member.coreId, placement: member.placement, relative: member.relative,
    })),
    modules: assembly.modules.map((module) => ({ partId: module.partId, relative: module.relative })),
  });

  return {
    ...C,
    constants: { ...C.constants, CRUSHER, SMELTER, FORGE, POWER, SHAFT },
    walk,
    harvestOre,
    frameCount,
    frameAt,
    assemblyOfPart,
    enterStructureMode,
    exitStructureMode,
    placeFrameAt,
    selectPart,
    shotSelected,
    assemblySummary,
  };
}
