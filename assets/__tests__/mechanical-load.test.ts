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
import { readoutTargetOf } from '../mechanical/readout-status.ts';

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

function consistentLoop(): { parts: MechanicalPart[]; connections: Connection[] } {
  return {
    parts: [
      part(1, 'power_source'), part(2, 'shaft'), part(3, 'gear_12'), part(4, 'gear_24'), part(5, 'machine'),
    ],
    connections: [
      edge(1, 2, 1),
      edge(2, 3, 1),
      edge(3, 4, -0.5, 'gearMesh'),
      edge(4, 3, -2, 'gearMesh'),
      edge(3, 5, 1),
    ],
  };
}

function contradictoryLoop(): { parts: MechanicalPart[]; connections: Connection[] } {
  return {
    parts: [
      part(1, 'power_source'), part(2, 'shaft'),
      part(3, 'gear_12'), part(4, 'gear_24'), part(5, 'gear_12'), part(6, 'machine'),
    ],
    connections: [
      edge(1, 2, 1), edge(2, 3, 1),
      edge(3, 4, -0.5, 'gearMesh'),
      edge(4, 5, -2, 'gearMesh'),
      edge(5, 3, -1, 'gearMesh'),
      edge(3, 6, 1),
    ],
  };
}

describe('M1.7-C cyclic networks', () => {
  /** 源 + 轴 + 两个齿轮互啮两次（-0.5 与 -2 连乘 = 1，传动比自洽的闭环）+ 一台机器。 */
  it('rejects a closed loop even when its ratios are consistent', () => {
    const { parts, connections } = consistentLoop();
    const solution = solve(parts, connections);
    expect(solution.components[0]?.status).toBe('unsupported');
    expect(solution.components[0]?.reason).toBe('cyclic-network');
  });

  it('rejects a closed loop with contradictory ratios', () => {
    const { parts, connections } = contradictoryLoop();
    const solution = solve(parts, connections);
    expect(solution.components[0]?.status).toBe('unsupported');
    expect(solution.components[0]?.reason).toBe('cyclic-network');
  });

  it('keeps a cyclic component unsupported even when the source is off', () => {
    const { parts, connections } = consistentLoop();
    const topology = buildPowerTopology(parts, connections, 1);
    expect(topology.components[0]?.status).toBe('unsupported');
    expect(topology.components[0]?.reason).toBe('cyclic-network');
    const solution = solvePower(topology, parts, new Set());
    expect(solution.components[0]?.status).toBe('unsupported');
    expect(solution.components[0]?.reason).toBe('cyclic-network');
    expect(solution.omegaByPart.size).toBe(0);
  });

  it('gives the machines of a cyclic component no power and no torque split', () => {
    const { parts, connections } = consistentLoop();
    const solution = solve(parts, connections);
    expect(solution.poweredMachines.size).toBe(0);
    expect(solution.omegaByPart.size).toBe(0);
    expect(solution.torqueByPart.size).toBe(0);
    expect(solution.poweredMachines.has(5)).toBe(false);
    expect(solution.omegaByPart.has(5)).toBe(false);
  });

  it('keeps an independent tree component running next to a cyclic one', () => {
    const parts = [
      part(1, 'power_source'), part(2, 'shaft'), part(3, 'machine'),
      part(10, 'power_source'), part(11, 'gear_12'), part(12, 'gear_24'),
      part(13, 'gear_12'), part(14, 'machine'),
    ];
    const connections = [
      edge(1, 2, 1), edge(2, 3, 1),
      edge(10, 11, 1),
      edge(11, 12, -0.5, 'gearMesh'),
      edge(12, 13, -2, 'gearMesh'),
      edge(13, 11, -1, 'gearMesh'),
      edge(11, 14, 1),
    ];
    const topology = buildPowerTopology(parts, connections, 1);
    const solution = solvePower(topology, parts, new Set([1, 10]));
    const tree = solution.components.find((component) => component.partIds.includes(3));
    const loop = solution.components.find((component) => component.partIds.includes(11));
    expect(tree?.status).toBe('powered');
    expect(loop?.status).toBe('unsupported');
    expect(loop?.reason).toBe('cyclic-network');
    expect(solution.omegaByPart.get(3)).toBeGreaterThan(0);
    expect(solution.omegaByPart.has(11)).toBe(false);
    expect(solution.omegaByPart.has(14)).toBe(false);
  });

  it('keeps multiple sources unsupported', () => {
    const parts = [part(1, 'power_source'), part(2, 'shaft'), part(3, 'power_source')];
    const solution = solve(parts, [edge(1, 2, 1), edge(3, 2, -1)]);
    expect(solution.components[0]?.status).toBe('unsupported');
    expect(solution.components[0]?.reason).toBe('multiple-sources');
  });
});

describe('M1.7-C readout status mapping', () => {
  function componentOf(
    parts: readonly MechanicalPart[],
    connections: readonly Connection[],
    enabled: readonly number[],
    partId: number,
  ): { component: ReturnType<typeof solve>['components'][number] | undefined; solution: ReturnType<typeof solve> } {
    const topology = buildPowerTopology(parts, connections, 1);
    const solution = solvePower(topology, parts, new Set(enabled));
    const index = topology.componentByPart.get(partId);
    return { component: index === undefined ? undefined : solution.components[index], solution };
  }

  it('reports POWERED for a normal tree and carries solver rpm/torque unchanged', () => {
    const { parts, connections } = branches(1);
    const { component, solution } = componentOf(parts, connections, [1], 2);
    const target = readoutTargetOf({
      component,
      stalled: solution.stalledParts.has(2),
      omega: solution.omegaByPart.get(2) ?? 0,
      torque: solution.torqueByPart.get(2) ?? 0,
      capacity: MECHANICAL_PART_DEFS.shaft.maxTorque,
      speedFactor: solution.speedFactorByComponent.get(component!.id) ?? 0,
    });
    expect(target.status).toBe('powered');
    expect(target.rpm).toBeCloseTo(48, 6);
    expect(target.torque).toBeCloseTo(20, 12);
    expect(target.capacity).toBe(MECHANICAL_PART_DEFS.shaft.maxTorque);
  });

  it('reports LOADED when load drops the network speed', () => {
    const { parts, connections } = branches(3);
    const { component, solution } = componentOf(parts, connections, [1], 2);
    const target = readoutTargetOf({
      component,
      stalled: solution.stalledParts.has(2),
      omega: solution.omegaByPart.get(2) ?? 0,
      torque: solution.torqueByPart.get(2) ?? 0,
      capacity: 150,
      speedFactor: solution.speedFactorByComponent.get(component!.id) ?? 0,
    });
    expect(target.status).toBe('loaded');
  });

  it('reports SOURCE OVERLOAD and BRANCH OVERLOAD for the two stall cases', () => {
    const overload = branches(TORQUE_SOURCE / MACHINE_LOAD);
    const sourceSolution = solve(overload.parts, overload.connections);
    const sourceTopology = buildPowerTopology(overload.parts, overload.connections, 1);
    const sourceComponent = sourceSolution.components[sourceTopology.componentByPart.get(2)!];
    const sourceTarget = readoutTargetOf({
      component: sourceComponent,
      stalled: sourceSolution.stalledParts.has(2),
      omega: 0,
      torque: sourceSolution.torqueByPart.get(2) ?? 0,
      capacity: TORQUE_SOURCE,
      speedFactor: 0,
    });
    expect(sourceTarget.status).toBe('source-overload');

    const branchParts = [
      part(1, 'power_source'), part(2, 'shaft'), part(3, 'gear_12'),
      part(31, 'machine'), part(32, 'machine'), part(33, 'machine'),
      part(20, 'shaft'), part(21, 'machine'),
    ];
    const branchConnections = [
      edge(1, 2, 1), edge(2, 3, 1),
      edge(3, 31, 1), edge(3, 32, 1), edge(3, 33, 1),
      edge(2, 20, 1), edge(20, 21, 1),
    ];
    const branchSolution = solve(branchParts, branchConnections);
    const branchTopology = buildPowerTopology(branchParts, branchConnections, 1);
    const stalledComponent = branchSolution.components[branchTopology.componentByPart.get(3)!];
    const stalledTarget = readoutTargetOf({
      component: stalledComponent,
      stalled: branchSolution.stalledParts.has(3),
      omega: branchSolution.omegaByPart.get(3) ?? 0,
      torque: branchSolution.torqueByPart.get(3) ?? 0,
      capacity: TORQUE_GEAR,
      speedFactor: branchSolution.speedFactorByComponent.get(stalledComponent.id) ?? 0,
    });
    expect(stalledTarget.status).toBe('branch-overload');
    expect(stalledTarget.torque).toBeCloseTo(3 * MACHINE_LOAD, 12);
  });

  it('reports DISABLED / IDLE / CYCLIC / UNSUPPORTED with no fabricated numbers', () => {
    const disabled = branches(1);
    const disabledTopology = buildPowerTopology(disabled.parts, disabled.connections, 1);
    const disabledSolution = solvePower(disabledTopology, disabled.parts, new Set());
    const disabledComponent = disabledSolution.components[disabledTopology.componentByPart.get(2)!];
    const disabledTarget = readoutTargetOf({
      component: disabledComponent,
      stalled: false,
      omega: 0,
      torque: 0,
      capacity: 150,
      speedFactor: 0,
    });
    expect(disabledTarget.status).toBe('disabled');
    expect(disabledTarget.rpm).toBe(0);

    const noSource = [part(1, 'shaft'), part(2, 'machine')];
    const idleSolution = solve(noSource, [edge(1, 2, 1)]);
    const idleTopology = buildPowerTopology(noSource, [edge(1, 2, 1)], 1);
    const idleComponent = idleSolution.components[idleTopology.componentByPart.get(1)!];
    expect(readoutTargetOf({
      component: idleComponent,
      stalled: false,
      omega: 0,
      torque: 0,
      capacity: 150,
      speedFactor: 0,
    }).status).toBe('idle');

    const loop = consistentLoop();
    const loopSolution = solve(loop.parts, loop.connections);
    const loopTopology = buildPowerTopology(loop.parts, loop.connections, 1);
    const loopComponent = loopSolution.components[loopTopology.componentByPart.get(3)!];
    const loopTarget = readoutTargetOf({
      component: loopComponent,
      stalled: false,
      omega: 0,
      torque: 0,
      capacity: TORQUE_GEAR,
      speedFactor: 0,
    });
    expect(loopTarget.status).toBe('cyclic');
    expect(loopTarget.rpm).toBeNull();
    expect(loopTarget.torque).toBeNull();

    const multi = [part(1, 'power_source'), part(2, 'shaft'), part(3, 'power_source')];
    const multiSolution = solve(multi, [edge(1, 2, 1), edge(3, 2, -1)]);
    const multiTopology = buildPowerTopology(multi, [edge(1, 2, 1), edge(3, 2, -1)], 1);
    const multiComponent = multiSolution.components[multiTopology.componentByPart.get(2)!];
    expect(readoutTargetOf({
      component: multiComponent,
      stalled: false,
      omega: 0,
      torque: 0,
      capacity: 150,
      speedFactor: 0,
    }).status).toBe('unsupported');
  });
});
