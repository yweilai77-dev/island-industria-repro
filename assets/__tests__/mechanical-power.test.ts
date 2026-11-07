import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import { MECHANICAL_PART_DEFS, type MechanicalPart, type PartId } from '../mechanical/parts.ts';
import { buildConnections, type Connection } from '../mechanical/ports.ts';
import { buildPowerTopology, solvePower } from '../mechanical/power.ts';

function part(id: number, defId: PartId, gx: number, gz = 7, rotation: 0 | 90 | 180 | 270 = 0): MechanicalPart {
  return {
    id,
    def: MECHANICAL_PART_DEFS[defId],
    placement: createPlacement(gx, gz, 1, 1, rotation, 0),
  };
}

function chain(): { parts: MechanicalPart[]; connections: readonly Connection[] } {
  const parts = [part(1, 'power_source', -6), part(2, 'shaft', -5), part(3, 'machine', -4)];
  return { parts, connections: buildConnections(parts) };
}

describe('M1.7-B power topology', () => {
  it('powers source -> shaft -> machine at 60 RPM', () => {
    const { parts, connections } = chain();
    expect(connections).toHaveLength(2);
    const topology = buildPowerTopology(parts, connections, 1);
    expect(topology.components).toHaveLength(1);
    expect(topology.components[0]?.status).toBe('powered');
    const solution = solvePower(topology, parts, new Set([1]));
    expect(solution.components[0]?.status).toBe('powered');
    expect(solution.omegaByPart.get(1)).toBeCloseTo(Math.PI * 2, 12);
    expect(solution.omegaByPart.get(2)).toBeCloseTo(Math.PI * 2, 12);
    expect(solution.omegaByPart.get(3)).toBeCloseTo(Math.PI * 2, 12);
    expect(solution.poweredMachines.has(3)).toBe(true);
  });

  it('stops the whole component when the source is disabled', () => {
    const { parts, connections } = chain();
    const topology = buildPowerTopology(parts, connections, 1);
    const solution = solvePower(topology, parts, new Set());
    expect(solution.components[0]?.status).toBe('idle');
    expect(solution.omegaByPart.size).toBe(0);
    expect(solution.poweredMachines.size).toBe(0);
  });

  it('marks components containing gears unsupported', () => {
    const parts = [part(1, 'power_source', -6), part(2, 'gear_12', -5), part(3, 'machine', -4)];
    const connections = buildConnections(parts);
    const topology = buildPowerTopology(parts, connections, 1);
    expect(topology.components[0]?.status).toBe('unsupported');
    expect(topology.components[0]?.reason).toBe('gear-requires-c');
    const solution = solvePower(topology, parts, new Set([1]));
    expect(solution.omegaByPart.size).toBe(0);
    expect(solution.poweredMachines.size).toBe(0);
  });

  it('marks multiple installed sources unsupported regardless of enabled state', () => {
    const parts = [part(1, 'power_source', 0), part(2, 'shaft', 1), part(3, 'power_source', 2)];
    const connections: Connection[] = [
      { id: 'a', aPartId: 1, bPartId: 2, aPortId: 'out', bPortId: 'a', kind: 'axial', ratio: 1 },
      { id: 'b', aPartId: 3, bPartId: 2, aPortId: 'out', bPortId: 'b', kind: 'axial', ratio: -1 },
    ];
    const topology = buildPowerTopology(parts, connections, 1);
    expect(topology.components[0]?.sourceIds).toEqual([1, 3]);
    expect(topology.components[0]?.status).toBe('unsupported');
    expect(topology.components[0]?.reason).toBe('multiple-sources');
    expect(solvePower(topology, parts, new Set([1])).omegaByPart.size).toBe(0);
  });

  it('keeps an unconnected machine idle', () => {
    const parts = [part(1, 'power_source', -6), part(2, 'shaft', -5), part(3, 'machine', 4)];
    const topology = buildPowerTopology(parts, buildConnections(parts), 1);
    const solution = solvePower(topology, parts, new Set([1]));
    expect(solution.omegaByPart.has(3)).toBe(false);
    expect(solution.poweredMachines.has(3)).toBe(false);
    expect(solution.components.find((c) => c.machineIds.includes(3))?.status).toBe('idle');
  });

  it('splits components when the middle shaft is removed', () => {
    const { parts, connections } = chain();
    const topology = buildPowerTopology(parts, connections, 1);
    expect(topology.components).toHaveLength(1);
    const withoutShaft = parts.filter((p) => p.id !== 2);
    const split = buildPowerTopology(withoutShaft, [], 2);
    expect(split.components).toHaveLength(2);
    const solution = solvePower(split, withoutShaft, new Set([1]));
    expect(solution.omegaByPart.has(3)).toBe(false);
    expect(solution.components.find((c) => c.machineIds.includes(3))?.status).toBe('idle');
  });

  it('does not propagate through a machine terminal', () => {
    const parts = [part(1, 'power_source', 0), part(2, 'machine', 1), part(3, 'machine', 2)];
    const connections: Connection[] = [
      { id: 'a', aPartId: 1, bPartId: 2, aPortId: 'out', bPortId: 'in', kind: 'axial', ratio: 1 },
      { id: 'b', aPartId: 2, bPartId: 3, aPortId: 'in', bPortId: 'in', kind: 'axial', ratio: 1 },
    ];
    const topology = buildPowerTopology(parts, connections, 1);
    const solution = solvePower(topology, parts, new Set([1]));
    expect(solution.poweredMachines.has(2)).toBe(true);
    expect(solution.omegaByPart.has(3)).toBe(false);
    expect(solution.poweredMachines.has(3)).toBe(false);
  });

  it('uses signed axis ratio for reverse axial connection', () => {
    const parts = [part(1, 'power_source', -6), part(2, 'shaft', -5, 7, 180), part(3, 'machine', -4)];
    const connections = buildConnections(parts);
    const topology = buildPowerTopology(parts, connections, 1);
    const solution = solvePower(topology, parts, new Set([1]));
    // 源→轴 ratio=-1，轴→机器 ratio=-1；机器标量绕自身 +X 轴恢复为正向。
    expect(solution.omegaByPart.get(2)).toBeCloseTo(-Math.PI * 2, 12);
    expect(solution.omegaByPart.get(3)).toBeCloseTo(Math.PI * 2, 12);
  });
});