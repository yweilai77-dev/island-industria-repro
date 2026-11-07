import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import { createInventoryService, type InventoryService } from '../inventory/inventory.ts';
import { MECHANICAL_PART_DEFS, isProductionMachine, type MechanicalPart, type PartId } from '../mechanical/parts.ts';
import { buildConnections } from '../mechanical/ports.ts';
import { MechanicalRuntimeState } from '../mechanical/runtime-state.ts';
import { ProductionRuntime } from '../production/production-runtime.ts';
import {
  assembleGoalObservation,
  createGoalProgress,
  type GoalFrameSource,
  type GoalProgressReader,
} from '../mechanical/runtime.ts';
import type { GoalSnapshot } from '../goal/goal.ts';

// M2.0-P1-B 单元测试：真实机械运行时 → 只读 GoalObservation / 订单进度服务。
// 使用真实 MechanicalRuntimeState / ProductionRuntime / InventoryService，不伪造快照数据。

interface PartSpec {
  readonly id: number;
  readonly def: PartId;
  readonly gx: number;
  readonly gz: number;
}

/** 一源三机布局：飞轮 → 轴 → 12T ┬→ 破碎机；12T→24T → 熔炼炉；24T→24T → 锻压机。 */
const POWERED_LINE: readonly PartSpec[] = [
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

/** M1.7-C 验证过的过载布局：测试动力源容量 100，三台冲压机折算需求正好 100。 */
const OVERLOAD_LINE: readonly PartSpec[] = [
  { id: 1, def: 'power_source', gx: -6, gz: 7 },
  { id: 2, def: 'shaft', gx: -5, gz: 7 },
  { id: 3, def: 'shaft', gx: -4, gz: 7 },
  { id: 4, def: 'gear_24', gx: -3, gz: 7 },
  { id: 5, def: 'machine', gx: -2, gz: 7 },
  { id: 6, def: 'gear_12', gx: -3, gz: 8 },
  { id: 7, def: 'machine', gx: -2, gz: 8 },
  { id: 8, def: 'gear_12', gx: -3, gz: 6 },
  { id: 9, def: 'machine', gx: -2, gz: 6 },
];

const FLYWHEEL_ID = 1;
const CRUSHER_ID = 5;

function part(id: number, defId: PartId, gx: number, gz: number): MechanicalPart {
  return { id, def: MECHANICAL_PART_DEFS[defId], placement: createPlacement(gx, gz, 1, 1, 0, 0) };
}

function buildLine(specs: readonly PartSpec[]): MechanicalPart[] {
  return specs.map((spec) => part(spec.id, spec.def, spec.gx, spec.gz));
}

interface Rig {
  readonly parts: readonly MechanicalPart[];
  readonly connections: ReturnType<typeof buildConnections>;
  readonly revision: number;
  readonly mech: MechanicalRuntimeState;
  readonly production: ProductionRuntime;
  readonly inventory: InventoryService;
}

function createRig(specs: readonly PartSpec[]): Rig {
  const parts = buildLine(specs);
  const connections = buildConnections(parts);
  const inventory = createInventoryService();
  const production = new ProductionRuntime({
    partAt: (cell, level) =>
      parts.find((p) => p.placement.gx === cell.gx && p.placement.gz === cell.gz && p.placement.level === level),
    addItem: (itemId, count) => { inventory.add(itemId, count); },
  });
  const mech = new MechanicalRuntimeState();
  mech.sync(1, parts, connections);
  production.sync(parts);
  return { parts, connections, revision: 1, mech, production, inventory };
}

/** 摇 1.2 秒给飞轮储能，然后挂离合（与真实玩家操作路径一致）。 */
function engageFlywheel(rig: Rig): void {
  rig.mech.setWinding(FLYWHEEL_ID, true);
  for (let index = 0; index < 12; index += 1) rig.mech.step(0.1);
  rig.mech.setWinding(FLYWHEEL_ID, false);
  rig.mech.setSourceEnabled(FLYWHEEL_ID, true);
  rig.mech.step(0.1);
}

/** 推进一帧（与 mechanicalRuntime 的 Update 顺序一致），返回本帧目标观测来源。 */
function frame(rig: Rig, delta = 0.25): GoalFrameSource {
  rig.mech.sync(rig.revision, rig.parts, rig.connections);
  rig.production.sync(rig.parts);
  rig.mech.step(delta);
  for (const item of rig.parts) {
    if (item.def.kind !== 'machine' || !isProductionMachine(item.def)) continue;
    rig.production.setPowerReading(item.id, {
      powered: Math.abs(rig.mech.omegaOf(item.id)) > 1e-9,
      rate: rig.mech.rateOf(item.id),
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

function advance(rig: Rig, progress: GoalProgressReader, frames: number): GoalSnapshot {
  let snapshot = progress.snapshot();
  for (let index = 0; index < frames; index += 1) snapshot = progress.update(frame(rig));
  return snapshot;
}

function advanceUntil(
  rig: Rig,
  progress: GoalProgressReader,
  done: () => boolean,
  maxFrames = 400,
): GoalSnapshot {
  let snapshot = progress.snapshot();
  for (let index = 0; index < maxFrames; index += 1) {
    snapshot = progress.update(frame(rig));
    if (done()) return snapshot;
  }
  throw new Error('condition not reached in time');
}

function producedCount(rig: Rig, itemId: string): number {
  return rig.production.snapshot().produced.find((entry) => entry.itemId === itemId)?.count ?? 0;
}

describe('M2.0-P1-B 机械运行时只读进度服务', () => {
  it('maps inventory, parts, recipes, flywheel energy and networks from real snapshots', () => {
    const rig = createRig(POWERED_LINE);
    engageFlywheel(rig);
    rig.inventory.add('iron_ore', 3);
    const observation = assembleGoalObservation(frame(rig));

    expect(observation.ironOre).toBe(3);
    expect(observation.parts).toHaveLength(POWERED_LINE.length);
    expect(observation.parts.find((entry) => entry.partId === 1)?.partKind).toBe('flywheel_source');
    expect(observation.parts.find((entry) => entry.partId === 3)?.partKind).toBe('gear_12');
    expect(observation.parts.find((entry) => entry.partId === CRUSHER_ID)?.partKind).toBe('crusher');

    expect(observation.machines.map((machine) => machine.recipeId).sort()).toEqual([
      'crush-iron-ore',
      'forge-shaft',
      'smelt-crushed-ore',
    ]);
    // 已接合但还没投料：机器受电、等待原料。
    expect(observation.machines.every((machine) => machine.block === 'no-input')).toBe(true);

    expect(observation.sources).toHaveLength(1);
    expect(observation.sources[0]?.engaged).toBe(true);
    expect(observation.sources[0]?.energyCapacity).toBe(300);
    expect(observation.sources[0]?.energy ?? 0).toBeGreaterThan(0);

    expect(observation.networks).toHaveLength(1);
    expect(observation.networks[0]?.status).toBe('powered');
    expect(observation.networks[0]?.sourceIds).toEqual([FLYWHEEL_ID]);
    expect(observation.networks[0]?.machineIds).toEqual([5, 8, 11]);
    expect(observation.networks[0]?.speedFactor).toBeCloseTo(0.707, 3);
    expect(observation.produced).toEqual([]);
  });

  it('keeps powered flags consistent with the real power solution', () => {
    const rig = createRig(POWERED_LINE);
    engageFlywheel(rig);
    const powered = assembleGoalObservation(frame(rig));
    const poweredIds = powered.parts.filter((entry) => entry.powered).map((entry) => entry.partId);
    expect(poweredIds).toEqual(expect.arrayContaining([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    expect(rig.mech.snapshot().machines.every((machine) => machine.powered)).toBe(true);

    rig.mech.setSourceEnabled(FLYWHEEL_ID, false);
    const idle = assembleGoalObservation(frame(rig));
    expect(idle.parts.filter((entry) => entry.powered)).toEqual([]);
    expect(idle.machines.every((machine) => machine.block === 'no-power')).toBe(true);
  });

  it('maps a real source-overload network without altering it', () => {
    const rig = createRig(OVERLOAD_LINE);
    rig.mech.setSourceEnabled(1, true);
    const observation = assembleGoalObservation(frame(rig));

    expect(observation.networks[0]?.status).toBe('stalled');
    expect(observation.networks[0]?.reason).toBe('source-overload');
    expect(observation.networks[0]?.speedFactor).toBe(0);
    expect(observation.networks[0]?.stalledPartIds.length).toBeGreaterThan(0);
    expect(observation.sources[0]?.partId).toBe(1);
    expect(observation.sources[0]?.engaged).toBe(true);
    expect(observation.sources[0]?.energy).toBeNull();
    expect(observation.parts.every((entry) => entry.powered === false)).toBe(true);
  });

  it('drives the order from real runtime state: ore then a powered line', () => {
    const rig = createRig(POWERED_LINE);
    engageFlywheel(rig);
    const progress = createGoalProgress();

    expect(progress.update(frame(rig)).currentStep.id).toBe('gather-ore');
    rig.inventory.add('iron_ore', 2);
    const ready = progress.update(frame(rig));
    expect(ready.currentStep.id).toBe('crush-ore');
    expect(progress.state().completed).toEqual([
      'gather-ore',
      'build-machines',
      'connect-power',
      'start-power',
    ]);
    expect(ready.focusPartId).toBe(CRUSHER_ID);
  });

  it('records the production baseline at order start and only counts later output', () => {
    const rig = createRig(POWERED_LINE);
    engageFlywheel(rig);
    const progress = createGoalProgress();
    rig.inventory.add('iron_ore', 2);
    advance(rig, progress, 2);
    expect(progress.state().baseline).toEqual({ crushedOre: 0, ironIngot: 0, shaft: 0 });

    rig.production.insertInto(CRUSHER_ID, 'iron_ore', 2);
    const crushed = advanceUntil(rig, progress, () => producedCount(rig, 'crushed_ore') >= 2);
    expect(producedCount(rig, 'crushed_ore')).toBe(2);
    expect(crushed.currentStep.id).toBe('smelt-ingot');
    expect(progress.state().completed).toContain('crush-ore');

    // 同一台机器上「订单开始前已有产量」的新订单不把历史产量算进订单。
    const laterOrder = createGoalProgress();
    laterOrder.update(frame(rig));
    expect(laterOrder.state().baseline.crushedOre).toBe(2);
    expect(laterOrder.snapshot().currentStep.id).toBe('crush-ore');
    expect(laterOrder.snapshot().currentStep.progress).toEqual({ current: 0, required: 2 });
  });

  it('never treats the 24 prototype shafts in the inventory as order evidence', () => {
    const rig = createRig(POWERED_LINE);
    engageFlywheel(rig);
    rig.inventory.add('iron_ore', 2);
    rig.inventory.add('shaft', 24);
    const progress = createGoalProgress();
    const snapshot = advance(rig, progress, 3);

    expect(rig.inventory.count('shaft')).toBe(24);
    expect(snapshot.currentStep.id).toBe('crush-ore');
    expect(snapshot.steps.find((step) => step.id === 'forge-shaft')?.completed).toBe(false);
    expect(snapshot.steps.find((step) => step.id === 'forge-shaft')?.progress).toEqual({ current: 0, required: 1 });
    expect(snapshot.complete).toBe(false);
  });

  it('reflects a dismantled machine in the observation and the blocker', () => {
    const rig = createRig(POWERED_LINE);
    engageFlywheel(rig);
    rig.inventory.add('iron_ore', 2);
    const progress = createGoalProgress();
    advance(rig, progress, 2);
    expect(progress.snapshot().currentStep.id).toBe('crush-ore');

    const dismantled = createRig(POWERED_LINE.filter((spec) => spec.id !== CRUSHER_ID));
    dismantled.mech.setSourceEnabled(FLYWHEEL_ID, true);
    const observation = assembleGoalObservation(frame(dismantled));
    const snapshot = progress.update(frame(dismantled));

    expect(observation.parts.some((entry) => entry.partKind === 'crusher')).toBe(false);
    expect(observation.machines.some((machine) => machine.partId === CRUSHER_ID)).toBe(false);
    expect(snapshot.currentStep.id).toBe('crush-ore');
    expect(snapshot.blocker?.code).toBe('missing-machine');
    expect(snapshot.complete).toBe(false);
  });

  it('is read-only: assembling and updating never mutate runtime data', () => {
    const rig = createRig(POWERED_LINE);
    engageFlywheel(rig);
    rig.inventory.add('iron_ore', 2);
    rig.production.insertInto(CRUSHER_ID, 'iron_ore', 1);
    const source = frame(rig);
    const mechanicalBefore = JSON.stringify(source.mechanical);
    const productionBefore = JSON.stringify(source.production);
    const inventoryBefore = JSON.stringify(source.inventory.stacks());

    const observation = assembleGoalObservation(source);
    createGoalProgress().update(source);

    expect(JSON.stringify(source.mechanical)).toBe(mechanicalBefore);
    expect(JSON.stringify(source.production)).toBe(productionBefore);
    expect(JSON.stringify(source.inventory.stacks())).toBe(inventoryBefore);
    // 观测是独立数据：不与运行时快照共享数组引用。
    expect(observation.parts).not.toBe(source.parts);
    expect(observation.networks[0]?.partIds).not.toBe(source.mechanical.networks[0]?.partIds);
    expect(observation.produced).not.toBe(source.production.produced);
  });

  it('returns JSON-serializable snapshots and repeated reads never reset the baseline', () => {
    const rig = createRig(POWERED_LINE);
    engageFlywheel(rig);
    rig.inventory.add('iron_ore', 2);
    rig.production.insertInto(CRUSHER_ID, 'iron_ore', 1);
    const progress = createGoalProgress();
    advance(rig, progress, 10);

    const first = progress.snapshot();
    const second = progress.snapshot();
    expect(second).toEqual(first);
    expect(progress.observation()).toEqual(progress.observation());
    expect(progress.state()).toEqual(progress.state());

    const baseline = progress.state().baseline;
    const producedBefore = producedCount(rig, 'crushed_ore');
    advance(rig, progress, 3);
    expect(progress.state().baseline).toEqual(baseline);
    expect(producedCount(rig, 'crushed_ore')).toBe(producedBefore);

    expect(JSON.parse(JSON.stringify(progress.snapshot()))).toEqual(progress.snapshot());
    expect(JSON.parse(JSON.stringify(progress.observation()))).toEqual(progress.observation());
    expect(JSON.parse(JSON.stringify(progress.state()))).toEqual(progress.state());
  });
});
