import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import {
  MACHINE_LOAD,
  MECHANICAL_PART_DEFS,
  TORQUE_GEAR,
  TORQUE_SOURCE,
  type MechanicalPart,
  type PartId,
} from '../mechanical/parts.ts';
import type { Connection } from '../mechanical/ports.ts';
import { buildPowerTopology, solvePower } from '../mechanical/power.ts';
import { MechanicalRuntimeState } from '../mechanical/runtime-state.ts';

/**
 * M1.7-C 齿轮传动 + 负载/过载模型纯逻辑测试。
 * 用手写拓扑（不依赖网格摆放）覆盖比值、扭矩折算、减速、支路停转与恢复。
 */

function part(id: number, defId: PartId): MechanicalPart {
  return {
    id,
    def: MECHANICAL_PART_DEFS[defId],
    placement: createPlacement(id, 0, 1, 1, 0, 0),
  };
}

function edge(a: number, b: number, ratio: number, kind: Connection['kind'] = 'axial'): Connection {
  return { id: `${a}-${b}`, aPartId: a, bPartId: b, aPortId: 'p', bPortId: 'p', kind, ratio };
}

function solve(parts: readonly MechanicalPart[], connections: readonly Connection[]) {
  const topology = buildPowerTopology(parts, connections, 1);
  return solvePower(topology, parts, new Set([1]));
}

/** 源 + 主干轴 + n 条支路，每条支路一台机器（负载 20）。 */
function branches(count: number): { parts: MechanicalPart[]; connections: Connection[] } {
  const parts: MechanicalPart[] = [part(1, 'power_source'), part(2, 'shaft')];
  const connections: Connection[] = [edge(1, 2, 1)];
  for (let index = 0; index < count; index += 1) {
    const shaftId = 10 + index * 2;
    const machineId = shaftId + 1;
    parts.push(part(shaftId, 'shaft'), part(machineId, 'machine'));
    connections.push(edge(2, shaftId, 1), edge(shaftId, machineId, 1));
  }
  return { parts, connections };
}

describe('M1.7-C gear transmission', () => {
  it('runs with no load at rated speed', () => {
    const parts = [part(1, 'power_source'), part(2, 'shaft')];
    const solution = solve(parts, [edge(1, 2, 1)]);
    expect(solution.components[0]?.status).toBe('powered');
    expect(solution.speedFactorByComponent.get(0)).toBeCloseTo(1, 12);
    expect(solution.omegaByPart.get(2)).toBeCloseTo(Math.PI * 2, 12);
  });

  it('12T -> 24T halves output speed and doubles output torque', () => {
    const parts = [
      part(1, 'power_source'), part(2, 'gear_12'), part(3, 'gear_24'), part(4, 'machine'),
    ];
    const solution = solve(parts, [edge(1, 2, 1), edge(2, 3, -0.5, 'gearMesh'), edge(3, 4, 1)]);
    // 负载 20 经 24T 的 1:2 减速折算到源侧只有 10 → 速度因子 0.9。
    expect(solution.demandByComponent.get(0)).toBeCloseTo(10, 12);
    expect(solution.speedFactorByComponent.get(0)).toBeCloseTo(0.9, 12);
    expect(solution.omegaByPart.get(2)).toBeCloseTo(Math.PI * 1.8, 12);
    expect(solution.omegaByPart.get(3)).toBeCloseTo(-Math.PI * 0.9, 12);
    expect(solution.omegaByPart.get(4)).toBeCloseTo(-Math.PI * 0.9, 12);
    // 扭矩：12T 侧 10，24T 侧 20（输出扭矩翻倍）。
    expect(solution.torqueByPart.get(2)).toBeCloseTo(10, 12);
    expect(solution.torqueByPart.get(3)).toBeCloseTo(20, 12);
    // 外啮合两轮物理转向相反。
    expect((solution.omegaByPart.get(2) ?? 0) * (solution.omegaByPart.get(3) ?? 0)).toBeLessThan(0);
  });

  it('24T -> 12T doubles output speed and halves output torque', () => {
    const parts = [
      part(1, 'power_source'), part(2, 'gear_24'), part(3, 'gear_12'), part(4, 'machine'),
    ];
    const solution = solve(parts, [edge(1, 2, 1), edge(2, 3, -2, 'gearMesh'), edge(3, 4, 1)]);
    expect(solution.demandByComponent.get(0)).toBeCloseTo(40, 12);
    expect(solution.speedFactorByComponent.get(0)).toBeCloseTo(0.6, 12);
    expect(solution.omegaByPart.get(2)).toBeCloseTo(Math.PI * 1.2, 12);
    expect(solution.omegaByPart.get(3)).toBeCloseTo(-Math.PI * 2.4, 12);
    expect(solution.torqueByPart.get(2)).toBeCloseTo(40, 12);
    expect(solution.torqueByPart.get(3)).toBeCloseTo(20, 12);
  });

  it('compounds a two stage gear train to 1/4 speed', () => {
    const parts = [
      part(1, 'power_source'), part(2, 'gear_12'), part(3, 'gear_24'),
      part(4, 'gear_12'), part(5, 'gear_24'), part(6, 'machine'),
    ];
    const solution = solve(parts, [
      edge(1, 2, 1),
      edge(2, 3, -0.5, 'gearMesh'),
      edge(3, 4, 1),
      edge(4, 5, -0.5, 'gearMesh'),
      edge(5, 6, 1),
    ]);
    expect(solution.demandByComponent.get(0)).toBeCloseTo(5, 12);
    expect(solution.speedFactorByComponent.get(0)).toBeCloseTo(0.95, 12);
    const sourceOmega = solution.omegaByPart.get(1) ?? 0;
    const machineOmega = solution.omegaByPart.get(6) ?? 0;
    expect(machineOmega / sourceOmega).toBeCloseTo(0.25, 12);
    expect(solution.torqueByPart.get(6)).toBeCloseTo(20, 12);
  });
});

describe('M1.7-C load and overload', () => {
  it('slows the whole network as branches add load', () => {
    for (const [count, factor] of [[1, 0.8], [2, 0.6], [3, 0.4], [4, 0.2]] as const) {
      const { parts, connections } = branches(count);
      const solution = solve(parts, connections);
      expect(solution.demandByComponent.get(0)).toBeCloseTo(MACHINE_LOAD * count, 12);
      expect(solution.speedFactorByComponent.get(0)).toBeCloseTo(factor, 12);
      expect(solution.components[0]?.status).toBe('powered');
      // 同一网络里的所有零件一起减速，不脱离。
      expect(solution.omegaByPart.get(2)).toBeCloseTo(Math.PI * 2 * factor, 12);
      expect(solution.omegaByPart.get(11)).toBeCloseTo(Math.PI * 2 * factor, 12);
    }
  });

  it('stops the whole network when total load reaches source capacity', () => {
    const { parts, connections } = branches(TORQUE_SOURCE / MACHINE_LOAD);
    const solution = solve(parts, connections);
    expect(solution.components[0]?.status).toBe('stalled');
    expect(solution.components[0]?.reason).toBe('source-overload');
    expect(solution.omegaByPart.size).toBe(0);
    expect(solution.poweredMachines.size).toBe(0);
    expect(solution.torqueByPart.get(2)).toBeCloseTo(TORQUE_SOURCE, 12);
  });

  it('stops only the overloaded branch and keeps siblings running', () => {
    // 主干 2，支路 A = 齿轮 3 挂 3 台机器（60 > 齿轮承载 50），支路 B = 轴 20 + 机器 30。
    const parts = [
      part(1, 'power_source'), part(2, 'shaft'), part(3, 'gear_12'),
      part(31, 'machine'), part(32, 'machine'), part(33, 'machine'),
      part(20, 'shaft'), part(21, 'machine'),
    ];
    const connections = [
      edge(1, 2, 1), edge(2, 3, 1),
      edge(3, 31, 1), edge(3, 32, 1), edge(3, 33, 1),
      edge(2, 20, 1), edge(20, 21, 1),
    ];
    const solution = solve(parts, connections);
    expect(solution.components[0]?.status).toBe('powered');
    // 支路 A：齿轮与三台机器全部停转，扭矩保留在齿轮上。
    expect(solution.stalledParts.has(3)).toBe(true);
    for (const id of [31, 32, 33]) expect(solution.stalledParts.has(id)).toBe(true);
    expect(solution.omegaByPart.has(3)).toBe(false);
    expect(solution.omegaByPart.has(31)).toBe(false);
    expect(solution.torqueByPart.get(3)).toBeCloseTo(3 * MACHINE_LOAD, 12);
    expect((solution.torqueByPart.get(3) ?? 0) > TORQUE_GEAR).toBe(true);
    // 支路 B：继续运行，源侧只剩 20 的负载。
    expect(solution.poweredMachines.has(21)).toBe(true);
    expect(solution.omegaByPart.get(21)).toBeCloseTo(Math.PI * 1.6, 12);
    expect(solution.demandByComponent.get(0)).toBeCloseTo(MACHINE_LOAD, 12);
    expect(solution.speedFactorByComponent.get(0)).toBeCloseTo(0.8, 12);
  });

  it('recovers after the load on the stalled branch drops', () => {
    const state = new MechanicalRuntimeState();
    const parts = [
      part(1, 'power_source'), part(2, 'shaft'), part(3, 'gear_12'),
      part(31, 'machine'), part(32, 'machine'), part(33, 'machine'),
      part(20, 'shaft'), part(21, 'machine'),
    ];
    const connections = [
      edge(1, 2, 1), edge(2, 3, 1),
      edge(3, 31, 1), edge(3, 32, 1), edge(3, 33, 1),
      edge(2, 20, 1), edge(20, 21, 1),
    ];
    state.sync(1, parts, connections);
    state.toggleSource(1);
    state.step(0.2);
    expect(state.isStalled(3)).toBe(true);
    expect(state.torqueOf(3)).toBeCloseTo(3 * MACHINE_LOAD, 12);

    // 拆掉一台机器 → 支路 A 负载 40 ≤ 50，重新计算后恢复。
    const reduced = parts.filter((candidate) => candidate.id !== 33);
    const reducedConnections = connections.filter((connection) => connection.bPartId !== 33 && connection.aPartId !== 33);
    state.sync(2, reduced, reducedConnections);
    state.step(0.2);
    expect(state.isStalled(3)).toBe(false);
    expect(state.omegaOf(3)).toBeGreaterThan(0);
    expect(state.snapshot().machines.filter((machine) => machine.powered).length).toBe(3);
    expect(state.snapshot().networks[0]?.status).toBe('powered');
  });
});

describe('M1.7-C kinematic conflicts', () => {
  it('marks a contradictory gear loop unsupported', () => {
    const parts = [
      part(1, 'power_source'), part(2, 'shaft'),
      part(3, 'gear_12'), part(4, 'gear_24'), part(5, 'gear_12'),
    ];
    const connections = [
      edge(1, 2, 1), edge(2, 3, 1),
      edge(3, 4, -0.5, 'gearMesh'),
      edge(4, 5, -2, 'gearMesh'),
      edge(5, 3, -1, 'gearMesh'),
    ];
    const solution = solve(parts, connections);
    expect(solution.components[0]?.status).toBe('unsupported');
    expect(solution.components[0]?.reason).toBe('kinematic-conflict');
    expect(solution.omegaByPart.size).toBe(0);
  });

  it('keeps multiple sources unsupported', () => {
    const parts = [part(1, 'power_source'), part(2, 'shaft'), part(3, 'power_source')];
    const solution = solve(parts, [edge(1, 2, 1), edge(3, 2, -1)]);
    expect(solution.components[0]?.status).toBe('unsupported');
    expect(solution.components[0]?.reason).toBe('multiple-sources');
  });
});
