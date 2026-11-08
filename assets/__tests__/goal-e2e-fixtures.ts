import { expect } from 'vitest';
import { createPlacement, type Rotation } from '../grid/grid.ts';
import type { ItemId } from '../items/items.ts';
import { createInventoryService, type InventoryService } from '../inventory/inventory.ts';
import { MECHANICAL_PART_DEFS, type MechanicalPart, type PartId } from '../mechanical/parts.ts';
import { buildConnections, type Connection } from '../mechanical/ports.ts';
import { MechanicalRuntimeState } from '../mechanical/runtime-state.ts';
import { ProductionRuntime } from '../production/production-runtime.ts';
import { createGoalProgress, type GoalFrameSource, type GoalProgressReader } from '../mechanical/runtime.ts';
import { buildGoalView } from '../game-ui-bridge/goal-view.ts';
import type { GoalSnapshot } from '../goal/goal.ts';

/**
 * M2.0-P1-D 端到端订单测试共用 rig。
 *
 * 只做「真实运行时」的装配与推进：MechanicalRuntimeState（真实动力解算 + 飞轮储能）、
 * ProductionRuntime（真实投料/加工/缓冲/产出统计）、InventoryService（真实库存）。
 * 不向订单系统注入任何手写的 produced / 网络状态。
 */

export interface PartSpec {
  readonly id: number;
  readonly def: PartId;
  readonly gx: number;
  readonly gz: number;
  readonly rotation?: Rotation;
  readonly level?: number;
}

/** 一源三机布局（订单正常场景）：飞轮 → 轴 → 12T ┬ 破碎机；12T→24T → 熔炼炉；24T→24T → 锻压机。 */
export const POWERED_LINE: readonly PartSpec[] = [
  { id: 1, def: 'flywheel_source', gx: 0, gz: 0 },
  { id: 2, def: 'shaft', gx: 1, gz: 0 },
  { id: 3, def: 'gear_12', gx: 2, gz: 0 },
  { id: 4, def: 'shaft', gx: 3, gz: 0 },
  { id: 5, def: 'crusher', gx: 4, gz: 0 },
  { id: 6, def: 'gear_24', gx: 2, gz: 1 },
  { id: 7, def: 'shaft', gx: 3, gz: 1 },
  { id: 8, def: 'smelter', gx: 4, gz: 1 },
  { id: 9, def: 'gear_24', gx: 2, gz: 2 },
  { id: 10, def: 'shaft', gx: 3, gz: 2 },
  { id: 11, def: 'forge', gx: 4, gz: 2 },
];

/** 齿轮闭环布局：正常一源三机线 + 一条从 24T 齿轮绕回另一台 24T 齿轮的 12T/24T 闭合链。 */
export const CYCLIC_LOOP_LINE: readonly PartSpec[] = [
  ...POWERED_LINE,
  { id: 12, def: 'shaft', gx: 1, gz: 1 },
  { id: 13, def: 'gear_24', gx: 0, gz: 1 },
  { id: 14, def: 'gear_24', gx: 0, gz: 2 },
  { id: 15, def: 'shaft', gx: 1, gz: 2 },
];

/** 闭环布局里唯一的闭环桥：拆掉它即恢复为与 POWERED_LINE 等价的可供能树。 */
export const CYCLIC_BREAK_PART_ID = 12;

/** 过载布局：测试动力源 100，24T 拖动两条 12T 支路（破碎 18 + 熔炼 24×2 + 锻压 22×2 = 110 ≥ 100）。 */
export const OVERLOAD_ORDER_LINE: readonly PartSpec[] = [
  { id: 1, def: 'power_source', gx: 0, gz: 0 },
  { id: 2, def: 'shaft', gx: 1, gz: 0 },
  { id: 3, def: 'shaft', gx: 2, gz: 0 },
  { id: 4, def: 'gear_24', gx: 3, gz: 0 },
  { id: 5, def: 'crusher', gx: 4, gz: 0 },
  { id: 6, def: 'gear_12', gx: 3, gz: 1 },
  { id: 7, def: 'gear_12', gx: 3, gz: -1 },
  { id: 8, def: 'smelter', gx: 4, gz: 1 },
  { id: 11, def: 'forge', gx: 4, gz: -1 },
];

export const FLYWHEEL_ID = 1;
export const CRUSHER_ID = 5;
export const SMELTER_ID = 8;
export const FORGE_ID = 11;

export function partOfSpec(spec: PartSpec): MechanicalPart {
  return {
    id: spec.id,
    def: MECHANICAL_PART_DEFS[spec.def],
    placement: createPlacement(spec.gx, spec.gz, 1, 1, spec.rotation ?? 0, spec.level ?? 0),
  };
}

export function buildLine(specs: readonly PartSpec[]): MechanicalPart[] {
  return specs.map(partOfSpec);
}

/** 真实运行时 rig：三套系统都是真实现，零件集合可拆装重建（setParts）。 */
export class GoalRig {
  parts: MechanicalPart[];
  connections: readonly Connection[];
  revision: number;
  readonly mech = new MechanicalRuntimeState();
  readonly inventory: InventoryService = createInventoryService();
  readonly production: ProductionRuntime;

  constructor(specs: readonly PartSpec[], revision = 1) {
    this.parts = buildLine(specs);
    this.connections = buildConnections(this.parts);
    this.revision = revision;
    this.production = new ProductionRuntime({
      partAt: (cell, level) =>
        this.parts.find((part) => part.placement.gx === cell.gx && part.placement.gz === cell.gz && part.placement.level === level),
      addItem: (itemId, count) => { this.inventory.add(itemId, count); },
    });
    this.mech.sync(this.revision, this.parts, this.connections);
    this.production.sync(this.parts);
  }

  /** 拆机/重建：重建连接、递增 revision，再同步两个真实运行时。 */
  setParts(specs: readonly PartSpec[]): void {
    this.parts = buildLine(specs);
    this.connections = buildConnections(this.parts);
    this.revision += 1;
    this.mech.sync(this.revision, this.parts, this.connections);
    this.production.sync(this.parts);
  }
}

/** 摇动摇柄给飞轮储能（真实 windRate 结算，不直接写 energy 字段）。 */
export function windFlywheel(rig: GoalRig, partId = FLYWHEEL_ID, target = 260): void {
  rig.mech.setWinding(partId, true);
  for (let index = 0; index < 200; index += 1) {
    const energy = rig.mech.energyOf(partId)?.energy ?? 0;
    if (energy >= target) break;
    rig.mech.step(0.1);
  }
  rig.mech.setWinding(partId, false);
}

/** 摇 1.2 秒储能后挂离合（与真实玩家操作路径一致）。 */
export function engageFlywheel(rig: GoalRig, partId = FLYWHEEL_ID): void {
  windFlywheel(rig, partId);
  rig.mech.setSourceEnabled(partId, true);
  rig.mech.step(0.1);
}

function topUpFlywheel(rig: GoalRig): void {
  const energy = rig.mech.energyOf(FLYWHEEL_ID)?.energy;
  if (energy !== undefined && energy < 80) windFlywheel(rig);
}

/** 推进一帧（顺序与 mechanicalRuntime 的 Update 一致），返回本帧目标观测来源。 */
export function frame(rig: GoalRig, delta = 0.25): GoalFrameSource {
  rig.mech.sync(rig.revision, rig.parts, rig.connections);
  rig.production.sync(rig.parts);
  rig.mech.step(delta);
  for (const part of rig.parts) {
    if (part.def.kind !== 'machine') continue;
    rig.production.setPowerReading(part.id, {
      powered: Math.abs(rig.mech.omegaOf(part.id)) > 1e-9,
      rate: rig.mech.rateOf(part.id),
    });
  }
  rig.production.tick(delta);
  return {
    parts: rig.parts,
    mechanical: rig.mech.snapshot(),
    production: rig.production.snapshot(),
    inventory: rig.inventory,
  };
}

/** 推进一帧并让订单求值（飞轮能量低时先真实摇柄补能）。 */
export function tick(rig: GoalRig, progress: GoalProgressReader, delta = 0.25): GoalSnapshot {
  topUpFlywheel(rig);
  return progress.update(frame(rig, delta));
}

/** 只推进真实运行时（订单尚未开始或已锁存），不驱动订单求值。 */
export function runRuntimeUntil(rig: GoalRig, done: () => boolean, maxFrames = 600): void {
  for (let index = 0; index < maxFrames; index += 1) {
    topUpFlywheel(rig);
    frame(rig);
    if (done()) return;
  }
  throw new Error('runtime condition not reached in time');
}

/** 推进订单直到条件成立；返回成立那一帧的订单快照。 */
export function runUntil(
  rig: GoalRig,
  progress: GoalProgressReader,
  done: () => boolean,
  maxFrames = 600,
): GoalSnapshot {
  let snapshot = progress.snapshot();
  for (let index = 0; index < maxFrames; index += 1) {
    snapshot = tick(rig, progress);
    if (done()) return snapshot;
  }
  throw new Error('goal condition not reached in time');
}

export function producedCount(rig: GoalRig, itemId: ItemId): number {
  return rig.production.snapshot().produced.find((entry) => entry.itemId === itemId)?.count ?? 0;
}

export function producedSummary(rig: GoalRig): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const entry of rig.production.snapshot().produced) summary[entry.itemId] = entry.count;
  return summary;
}

const inventoryIo = (rig: GoalRig) => ({
  has: (itemId: ItemId, count: number): boolean => rig.inventory.has(itemId, count),
  remove: (itemId: ItemId, count: number): boolean => rig.inventory.remove(itemId, count),
});

/** 从库存投料（等价于悬停按 C），返回实际投入件数。 */
export function feedFromInventory(rig: GoalRig, partId: number, count: number): number {
  let inserted = 0;
  for (let index = 0; index < count; index += 1) inserted += rig.production.loadFromInventory(partId, inventoryIo(rig));
  return inserted;
}

/** 取出机器成品并放进库存（等价于悬停右键取货）。 */
export function takeIntoInventory(rig: GoalRig, partId: number): { readonly itemId: ItemId; readonly count: number } | undefined {
  const taken = rig.production.takeFrom(partId);
  if (taken) rig.inventory.add(taken.itemId, taken.count);
  return taken;
}

/** 把订单推进到 forge-shaft：真实破碎 2 + 真实熔炼 2，铁锭留在库存。 */
export function reachForgeStage(rig: GoalRig, progress: GoalProgressReader): void {
  feedFromInventory(rig, CRUSHER_ID, 2);
  runUntil(rig, progress, () => producedCount(rig, 'crushed_ore') >= 2);
  takeIntoInventory(rig, CRUSHER_ID);
  feedFromInventory(rig, SMELTER_ID, 2);
  runUntil(rig, progress, () => producedCount(rig, 'iron_ingot') >= 2);
  takeIntoInventory(rig, SMELTER_ID);
}

/** 断言 HUD 视图（buildGoalView）与订单快照逐字段一致：数量/当前步/进度/阻塞/完成。 */
export function expectGoalViewMatches(snapshot: GoalSnapshot): void {
  const view = buildGoalView(snapshot);
  expect(view).not.toBeNull();
  if (view === null) return;
  expect(view.complete).toBe(snapshot.complete);
  expect(view.totalCount).toBe(snapshot.steps.length);
  expect(view.completedCount).toBe(snapshot.steps.filter((step) => step.completed).length);
  expect(view.currentStepId).toBe(snapshot.complete ? null : snapshot.currentStep.id);
  expect(view.currentStep?.id ?? null).toBe(snapshot.complete ? null : snapshot.currentStep.id);
  for (const step of snapshot.steps) {
    const uiStep = view.steps.find((candidate) => candidate.id === step.id);
    expect(uiStep).toBeDefined();
    expect(uiStep?.completed).toBe(step.completed);
    expect(uiStep?.current).toBe(!snapshot.complete && step.id === snapshot.currentStep.id);
    expect(uiStep?.progress).toEqual(step.progress === null
      ? null
      : { current: step.progress.current, required: step.progress.required });
  }
  expect(view.blocker).toEqual(snapshot.blocker === null
    ? null
    : { code: snapshot.blocker.code, message: snapshot.blocker.message });
}

/** 开始订单：返回首帧快照（内部会自动记录 produced 基线）。 */
export function startOrder(rig: GoalRig): { progress: GoalProgressReader; snapshot: GoalSnapshot } {
  const progress = createGoalProgress();
  const snapshot = tick(rig, progress);
  return { progress, snapshot };
}
