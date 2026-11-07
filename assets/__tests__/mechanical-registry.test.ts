import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import { MECHANICAL_PART_DEFS, type MechanicalPart } from '../mechanical/parts.ts';
import { MechanicalRegistry } from '../mechanical/registry.ts';

function shaft(id: number, gx: number): MechanicalPart {
  return { id, def: MECHANICAL_PART_DEFS.shaft, placement: createPlacement(gx, 2, 1, 1, 0, 0) };
}

describe('MechanicalRegistry ownership and transaction revision', () => {
  it('add/remove/update do not bump revision until commitTopology', () => {
    const registry = new MechanicalRegistry();
    expect(registry.add(shaft(1, -2))).toBe(true);
    expect(registry.revision).toBe(0);
    expect(registry.rebuildConnections()).toHaveLength(0);
    expect(registry.commitTopology()).toBe(1);
    expect(registry.revision).toBe(1);

    expect(registry.updatePlacement(1, createPlacement(-2, 3, 1, 1, 0, 0))).toBe(true);
    expect(registry.revision).toBe(1);
    registry.commitTopology();
    expect(registry.revision).toBe(2);

    const removed = registry.remove(1);
    expect(removed?.id).toBe(1);
    expect(registry.revision).toBe(2);
    registry.commitTopology();
    expect(registry.revision).toBe(3);
    expect(registry.get(1)).toBeUndefined();
  });

  it('keeps parts/connections as the only logical data; no cell lookup is stored', () => {
    const registry = new MechanicalRegistry();
    registry.add(shaft(1, -2));
    registry.add(shaft(2, -1));
    expect(registry.rebuildConnections()).toHaveLength(1);
    const connection = registry.connections()[0]!;
    expect(connection.ratio).toBe(1);
    registry.remove(2);
    expect(registry.rebuildConnections()).toHaveLength(0);
    expect(registry.all()).toHaveLength(1);
    expect((registry as unknown as { partAt?: unknown }).partAt).toBeUndefined();
  });
});
