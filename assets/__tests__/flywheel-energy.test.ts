import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import { MECHANICAL_PART_DEFS, type MechanicalPart, type PartId } from '../mechanical/parts.ts';
import { buildConnections } from '../mechanical/ports.ts';
import { MechanicalRuntimeState } from '../mechanical/runtime-state.ts';

function part(id: number, defId: PartId, gx: number, gz = 0): MechanicalPart {
  return {
    id,
    def: MECHANICAL_PART_DEFS[defId],
    placement: createPlacement(gx, gz, 1, 1, 0, 0),
  };
}

const FLYWHEEL = part(1, 'flywheel_source', 0);
const FLYWHEEL_SPEC = MECHANICAL_PART_DEFS.flywheel_source.energy!;

/** 同步一套零件；返回可直接 step 的运行时。 */
function syncState(parts: readonly MechanicalPart[], revision = 1): MechanicalRuntimeState {
  const state = new MechanicalRuntimeState();
  state.sync(revision, parts, buildConnections(parts));
  return state;
}

function stepSeconds(state: MechanicalRuntimeState, seconds: number): void {
  // step() 会把单步截到 0.1s，因此按 0.1s 分帧。
  const steps = Math.round(seconds / 0.1);
  for (let index = 0; index < steps; index += 1) state.step(0.1);
}

describe('M1.8-B hand-crank flywheel energy pool', () => {
  it('starts with zero energy and disengaged after sync', () => {
    const state = syncState([FLYWHEEL]);
    const energy = state.energyOf(1);
    expect(energy).toBeDefined();
    expect(energy!.energy).toBe(0);
    expect(energy!.capacity).toBe(FLYWHEEL_SPEC.capacity);
    expect(energy!.clutch).toBe(false);
    expect(energy!.winding).toBe(false);
    expect(state.isEngaged(1)).toBe(false);
    expect(state.isSourceEnabled(1)).toBe(false);
    expect(state.omegaOf(1)).toBe(0);

    const snapshot = state.snapshot();
    expect(snapshot.sources).toHaveLength(1);
    expect(snapshot.sources[0]?.energy).toBe(0);
    expect(snapshot.sources[0]?.energyCapacity).toBe(FLYWHEEL_SPEC.capacity);
    expect(snapshot.sources[0]?.engaged).toBe(false);
  });

  it('winds stored energy at windRate per second', () => {
    const state = syncState([FLYWHEEL]);
    expect(state.setWinding(1, true)).toBe(true);
    expect(state.isWinding(1)).toBe(true);

    stepSeconds(state, 1);
    const gained = state.energyOf(1)!.energy;
    expect(gained).toBeGreaterThan(FLYWHEEL_SPEC.windRate * 0.95);
    expect(gained).toBeLessThan(FLYWHEEL_SPEC.windRate * 1.05);
  });

  it('engages with stored energy and stops automatically when the pool is empty', () => {
    const state = syncState([FLYWHEEL]);
    state.setWinding(1, true);
    stepSeconds(state, 1); // ≈45 能量
    state.setWinding(1, false);
    expect(state.energyOf(1)!.energy).toBeGreaterThan(0);

    expect(state.setSourceEnabled(1, true)).toBe(true);
    expect(state.isEngaged(1)).toBe(true);
    expect(Math.abs(state.omegaOf(1))).toBeGreaterThan(0);

    // 空载 drain 6/s：45 能量约 7.5s 耗尽，跑 20s 足够。
    stepSeconds(state, 20);
    expect(state.energyOf(1)!.energy).toBe(0);
    expect(state.isEngaged(1)).toBe(false);
    // 逻辑开关仍在挂合状态，但已无能量可输出。
    expect(state.isSourceEnabled(1)).toBe(true);
    expect(state.omegaOf(1)).toBe(0);
  });

  it('never stores more than capacity', () => {
    const state = syncState([FLYWHEEL]);
    state.setWinding(1, true);
    stepSeconds(state, 10); // 450 能量注入 >> 300 容量
    const energy = state.energyOf(1)!;
    expect(energy.energy).toBe(FLYWHEEL_SPEC.capacity);
    expect(energy.energy).toBeLessThanOrEqual(energy.capacity);

    stepSeconds(state, 5);
    expect(state.energyOf(1)!.energy).toBe(FLYWHEEL_SPEC.capacity);
  });

  it('drains faster under machine load than when unloaded', () => {
    const idle = syncState([FLYWHEEL]);
    const loaded = syncState([
      FLYWHEEL,
      part(2, 'shaft', 1),
      part(3, 'machine', 2),
    ]);
    // 两种拓扑都能看到真实解算：负载版回路里有一台冲压机。
    expect(idle.topology?.components[0]?.machineIds).toEqual([]);
    expect(loaded.topology?.components[0]?.machineIds).toEqual([3]);

    for (const state of [idle, loaded]) {
      state.setWinding(1, true);
      stepSeconds(state, 2); // ≈90 能量
      state.setWinding(1, false);
      expect(state.setSourceEnabled(1, true)).toBe(true);
      expect(state.isEngaged(1)).toBe(true);
      stepSeconds(state, 1); // 负载越大，这 1s 抽走的能量越多
    }

    // 空载 6/s → 84；带一台冲压机（需求 20 / 容量 140）→ 6 + 14×(20/140) = 8/s → 82。
    expect(idle.energyOf(1)!.energy).toBeCloseTo(84, 6);
    expect(loaded.energyOf(1)!.energy).toBeCloseTo(82, 6);
    expect(loaded.energyOf(1)!.energy).toBeLessThan(idle.energyOf(1)!.energy);
  });

  it('clears all runtime state and starts a fresh flywheel at zero after re-sync', () => {
    const state = syncState([FLYWHEEL]);
    state.setWinding(1, true);
    stepSeconds(state, 1);
    state.setWinding(1, false);
    state.setSourceEnabled(1, true);
    expect(state.energyOf(1)!.energy).toBeGreaterThan(0);

    state.clear();
    expect(state.topology).toBeNull();
    expect(state.currentRevision).toBe(-1);
    expect(state.topologyBuildCount).toBe(0);
    expect(state.snapshot()).toEqual({ revision: 0, sources: [], networks: [], parts: [], machines: [] });
    expect(state.energyOf(1)).toBeUndefined();
    expect(state.isEngaged(1)).toBe(false);
    expect(state.isSourceEnabled(1)).toBe(false);

    state.sync(1, [FLYWHEEL], buildConnections([FLYWHEEL]));
    expect(state.energyOf(1)!.energy).toBe(0);
    expect(state.energyOf(1)!.winding).toBe(false);
    expect(state.isEngaged(1)).toBe(false);
  });
});
