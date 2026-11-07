import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import {
  MECHANICAL_PART_DEFS,
  PROTOTYPE_KIT,
  structureIdForPart,
  spatialRecordIdForPart,
  type MechanicalPart,
  type PartId,
} from '../mechanical/parts.ts';
import {
  buildConnections,
  matchAxial,
  matchGearMesh,
  portWorld,
} from '../mechanical/ports.ts';

function part(id: number, defId: PartId, gx: number, gz: number, rotation: 0 | 90 | 180 | 270 = 0): MechanicalPart {
  return {
    id,
    def: MECHANICAL_PART_DEFS[defId],
    placement: createPlacement(gx, gz, 1, 1, rotation, 0),
  };
}

describe('mechanical port geometry and signatures', () => {
  it('locks the 1m grid part/structure ids and kit counts', () => {
    expect(structureIdForPart(7)).toBe('mech:7');
    expect(spatialRecordIdForPart(7)).toBe('structure:mech:7');
    expect(PROTOTYPE_KIT.shaft).toBe(24);
    expect(PROTOTYPE_KIT.machine).toBe(5);
    expect(MECHANICAL_PART_DEFS.gear_12.teeth).toBe(12);
    expect(MECHANICAL_PART_DEFS.gear_24.teeth).toBe(24);
  });

  it('derives world anchors/normals/axes for four rotations', () => {
    const shaft = part(1, 'shaft', -2, 2);
    const base = portWorld(shaft, MECHANICAL_PART_DEFS.shaft.ports[0]!);
    expect(base.anchor).toEqual([-2, 0.5, 2.5]);
    expect(base.normal).toEqual([-1, 0, 0]);
    expect(base.axis).toEqual([1, 0, 0]);

    const rotated = part(2, 'shaft', -2, 2, 90);
    const port = portWorld(rotated, MECHANICAL_PART_DEFS.shaft.ports[0]!);
    expect(port.anchor[0]).toBeCloseTo(-1.5, 9);
    expect(port.anchor[2]).toBeCloseTo(3, 9);
    expect(port.normal[2]).toBeCloseTo(1, 9);
  });

  it('connects two coaxial shafts with signed axis ratio', () => {
    const a = part(1, 'shaft', -2, 2, 0);
    const b = part(2, 'shaft', -1, 2, 0);
    const aPort = portWorld(a, a.def.ports[1]!); // +X
    const bPort = portWorld(b, b.def.ports[0]!); // -X
    expect(matchAxial(aPort, bPort)).toBe(1);
    const connections = buildConnections([a, b]);
    expect(connections).toHaveLength(1);
    expect(connections[0]?.kind).toBe('axial');
    expect(connections[0]?.ratio).toBe(1);
  });

  it('reverses axial ratio when the second shaft is rotated 180 degrees', () => {
    const a = part(1, 'shaft', -2, 2, 0);
    const b = part(2, 'shaft', -1, 2, 180);
    const connections = buildConnections([a, b]);
    expect(connections).toHaveLength(1);
    expect(connections[0]?.ratio).toBe(-1);
  });

  it('does not connect an axial port with a gear mesh port', () => {
    const shaft = part(1, 'shaft', -2, 2, 0);
    const gear = part(2, 'gear_12', -2, 3, 0);
    const shaftAxial = portWorld(shaft, shaft.def.ports[1]!);
    const gearMesh = portWorld(gear, gear.def.ports.find((port) => port.role === 'mesh')!);
    expect(matchAxial(shaftAxial, gearMesh)).toBeUndefined();
    expect(matchGearMesh(shaftAxial, gearMesh)).toBeUndefined();
  });

  it('meshes 12T/24T gears with ratio -0.5 and reverses for opposite axis', () => {
    const small = part(1, 'gear_12', -2, 2, 0);
    const large = part(2, 'gear_24', -2, 3, 0);
    const connections = buildConnections([small, large]);
    expect(connections).toHaveLength(1);
    expect(connections[0]?.kind).toBe('gearMesh');
    expect(connections[0]?.ratio).toBeCloseTo(-0.5, 12);

    const largeReversed = part(3, 'gear_24', -2, 3, 180);
    const reversed = buildConnections([small, largeReversed]);
    expect(reversed).toHaveLength(1);
    expect(reversed[0]?.ratio).toBeCloseTo(0.5, 12);
  });

  it('does not connect by mere proximity or diagonal adjacency', () => {
    const a = part(1, 'shaft', -2, 2, 0);
    const diagonal = part(2, 'shaft', -1, 3, 0);
    expect(buildConnections([a, diagonal])).toHaveLength(0);
    const separated = part(3, 'shaft', 0, 2, 0);
    expect(buildConnections([a, separated])).toHaveLength(0);
  });
});