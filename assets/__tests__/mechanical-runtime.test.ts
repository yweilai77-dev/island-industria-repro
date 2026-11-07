import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import { MECHANICAL_PART_DEFS, type MechanicalPart, type PartId } from '../mechanical/parts.ts';
import { buildConnections } from '../mechanical/ports.ts';
import { MechanicalRuntimeState, sourceToggleTarget } from '../mechanical/runtime-state.ts';

function part(id: number, defId: PartId, gx: number, gz = 7): MechanicalPart {
  return {
    id,
    def: MECHANICAL_PART_DEFS[defId],
    placement: createPlacement(gx, gz, 1, 1, 0, 0),
  };
}

function chain(): { parts: MechanicalPart[]; connections: ReturnType<typeof buildConnections> } {
  const parts = [part(1, 'power_source', -6), part(2, 'shaft', -5), part(3, 'machine', -4)];
  return { parts, connections: buildConnections(parts) };
}

describe('M1.7-B runtime state', () => {
  it('starts with sources off and no machine power', () => {
    const { parts, connections } = chain();
    const state = new MechanicalRuntimeState();
    state.sync(1, parts, connections);
    state.step(0.5);
    const snap = state.snapshot();
    // M1.8：source 读数新增 engaged / label / energy / winding（测试动力源无储能 → energy=null）。
    expect(snap.sources).toEqual([{
      partId: 1,
      enabled: false,
      engaged: false,
      ratedRpm: 60,
      label: '测试动力源',
      energy: null,
      energyCapacity: null,
      winding: false,
    }]);
    expect(snap.networks[0]?.status).toBe('idle');
    expect(snap.machines[0]?.powered).toBe(false);
    expect(snap.machines[0]?.angle).toBe(0);
    expect(snap.machines[0]?.ramY).toBeCloseTo(0.9, 12);
  });

  it('runs, freezes and resumes from the frozen angle', () => {
    const { parts, connections } = chain();
    const state = new MechanicalRuntimeState();
    state.sync(1, parts, connections);
    expect(state.toggleSource(1)).toBe(true);
    state.step(0.5);
    const running = state.snapshot();
    expect(running.networks[0]?.status).toBe('powered');
    expect(running.machines[0]?.powered).toBe(true);
    // 冲压机负载 20 把 60 RPM 压到 48 RPM（2π × 0.8）。
    expect(running.parts.find((p) => p.partId === 2)?.omega).toBeCloseTo(Math.PI * 1.6, 12);
    const runningAngle = running.machines[0]!.angle;
    const runningRam = running.machines[0]!.ramY;

    expect(state.toggleSource(1)).toBe(true);
    state.step(0.5);
    const stopped = state.snapshot();
    expect(stopped.machines[0]?.powered).toBe(false);
    expect(stopped.machines[0]?.angle).toBeCloseTo(runningAngle, 12);
    expect(stopped.machines[0]?.ramY).toBeCloseTo(runningRam, 12);

    expect(state.toggleSource(1)).toBe(true);
    state.step(0.25);
    const resumed = state.snapshot();
    expect(resumed.machines[0]?.angle).toBeGreaterThan(runningAngle);
  });

  it('resolves right-click target: hovered source first, selected source fallback', () => {
    const { parts } = chain();
    expect(sourceToggleTarget(parts, 1, undefined)).toBe(1);
    expect(sourceToggleTarget(parts, 2, 1)).toBe(1);
    expect(sourceToggleTarget(parts, undefined, 1)).toBe(1);
    expect(sourceToggleTarget(parts, 2, 2)).toBeUndefined();
    expect(sourceToggleTarget(parts, undefined, undefined)).toBeUndefined();
  });

  it('rebuilds topology only on revision changes, not source toggles', () => {
    const { parts, connections } = chain();
    const state = new MechanicalRuntimeState();
    state.sync(1, parts, connections);
    expect(state.topologyBuildCount).toBe(1);
    const first = state.topology;
    state.sync(1, parts, connections);
    expect(state.topologyBuildCount).toBe(1);
    expect(state.topology).toBe(first);
    state.toggleSource(1);
    expect(state.topologyBuildCount).toBe(1);
    state.sync(2, parts, connections);
    expect(state.topologyBuildCount).toBe(2);
  });

  it('freezes and filters state when the middle shaft is removed', () => {
    const { parts, connections } = chain();
    const state = new MechanicalRuntimeState();
    state.sync(1, parts, connections);
    state.toggleSource(1);
    state.step(0.4);
    const angle = state.angleOf(3);
    const remaining = parts.filter((p) => p.id !== 2);
    state.sync(2, remaining, []);
    state.step(0.4);
    expect(state.angleOf(3)).toBeCloseTo(angle, 12);
    expect(state.snapshot().machines[0]?.powered).toBe(false);
  });

  it('filters removed sources and keeps new sources off', () => {
    const { parts, connections } = chain();
    const state = new MechanicalRuntimeState();
    state.sync(1, parts, connections);
    state.toggleSource(1);
    state.sync(2, [parts[1]!, parts[2]!], []);
    expect(state.snapshot().sources).toHaveLength(0);
    state.sync(3, [parts[1]!, parts[2]!, parts[0]!], connections);
    // M1.8：source 读数新增 engaged / label / energy / winding 字段（测试动力源无储能）。
    expect(state.snapshot().sources[0]).toMatchObject({
      partId: 1,
      enabled: false,
      engaged: false,
      ratedRpm: 60,
      energy: null,
      energyCapacity: null,
      winding: false,
    });
  });

  it('produces a JSON snapshot without entity handles', () => {
    const { parts, connections } = chain();
    const state = new MechanicalRuntimeState();
    state.sync(1, parts, connections);
    state.step(0.2);
    const json = JSON.stringify(state.snapshot());
    expect(json).not.toContain('Entity');
    expect(json).toContain('"revision":1');
    expect(json).toContain('"ramY"');
  });
});