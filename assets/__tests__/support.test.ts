import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import { levelBaseY } from '../spatial/space.ts';
import { SupportRegistry, TraversalRegistry, type TraversalSurface } from '../spatial/support.ts';

describe('SupportRegistry', () => {
  it('registers ground support and queries it by cell and level', () => {
    const supports = new SupportRegistry();
    supports.register({
      id: 'ground',
      level: 0,
      worldY: 0,
      cells: [{ gx: 0, gz: 0 }, { gx: 1, gz: 0 }],
      kind: 'ground',
      buildable: true,
      walkable: true,
      active: true,
    });
    expect(supports.supportAt({ gx: 0, gz: 0 }, 0)?.id).toBe('ground');
    expect(supports.supportAt({ gx: 1, gz: 0 }, 1)).toBeUndefined();
    expect(supports.supportAt({ gx: 5, gz: 5 }, 0)).toBeUndefined();
    expect(supports.hasBuildableSupport(createPlacement(0, 0, 2, 1))).toBe(true);
    expect(supports.hasBuildableSupport(createPlacement(5, 5, 1, 1))).toBe(false);
  });

  it('accepts a legacy placement without level as level 0 for support checks', () => {
    const supports = new SupportRegistry();
    supports.register({
      id: 'ground',
      level: 0,
      worldY: 0,
      cells: [{ gx: 0, gz: 0 }],
      kind: 'ground',
      buildable: true,
      walkable: true,
      active: true,
    });
    expect(supports.hasBuildableSupport({ gx: 0, gz: 0, w: 1, d: 1, rotation: 0 } as never)).toBe(true);
  });

  it('requires standard level height in M1.5', () => {
    const supports = new SupportRegistry();
    expect(() => supports.register({
      id: 'bad',
      level: 1,
      worldY: 2.5,
      cells: [{ gx: 0, gz: 0 }],
      kind: 'platform',
      buildable: true,
      walkable: true,
      active: true,
    })).toThrow(RangeError);
    expect(() => supports.register({
      id: 'good',
      level: 2,
      worldY: levelBaseY(2),
      cells: [{ gx: 0, gz: 0 }],
      kind: 'platform',
      buildable: true,
      walkable: true,
      active: true,
    })).not.toThrow();
  });

  it('supports multiple registered levels without a 0/1 hardcode', () => {
    const supports = new SupportRegistry();
    for (const level of [0, 1, 2, 3, 7]) {
      supports.register({
        id: `support:${level}`,
        level,
        worldY: levelBaseY(level),
        cells: [{ gx: 0, gz: 0 }],
        kind: level === 0 ? 'ground' : 'platform',
        buildable: true,
        walkable: true,
        active: true,
      });
    }
    for (const level of [0, 1, 2, 3, 7]) {
      expect(supports.supportAt({ gx: 0, gz: 0 }, level)?.id).toBe(`support:${level}`);
    }
  });

  it('filters non-buildable supports for placement', () => {
    const supports = new SupportRegistry();
    supports.register({
      id: 'walk-only',
      level: 0,
      worldY: 0,
      cells: [{ gx: 0, gz: 0 }],
      kind: 'ground',
      buildable: false,
      walkable: true,
      active: true,
    });
    expect(supports.buildableSupportAt({ gx: 0, gz: 0 }, 0, 0)).toBeUndefined();
    expect(supports.hasBuildableSupport(createPlacement(0, 0, 1, 1))).toBe(false);
  });

  it('rejects traversal dimensions beyond the epsilon tolerance', () => {
    const traversals = new TraversalRegistry();
    const base: TraversalSurface = {
      id: 'bad-run',
      levelLow: 0,
      levelHigh: 1,
      worldYLow: 0,
      worldYHigh: 3,
      originCell: { gx: 0, gz: 0 },
      direction: 'east',
      runLengthCells: 4,
      widthCells: 1,
      stepCount: 8,
      stepRun: 0.5001,
      stepRise: 0.375,
      cells: [{ gx: 0, gz: 0 }],
      walkable: true,
    };
    expect(() => traversals.register(base)).toThrow(RangeError);
    expect(() => traversals.register({ ...base, stepRun: 0.5, stepRise: 0.376 })).toThrow(RangeError);
    expect(() => traversals.register({ ...base, stepRun: 0.5, stepRise: 0.375 })).not.toThrow();
  });

  it('unregisters without leaving stale cell entries', () => {
    const supports = new SupportRegistry();
    supports.register({
      id: 'ground',
      level: 0,
      worldY: 0,
      cells: [{ gx: 0, gz: 0 }],
      kind: 'ground',
      buildable: true,
      walkable: true,
      active: true,
    });
    supports.unregister('ground');
    expect(supports.supportAt({ gx: 0, gz: 0 }, 0)).toBeUndefined();
    expect(supports.size).toBe(0);
  });

  it('rejects invalid levels at registration', () => {
    const supports = new SupportRegistry();
    for (const level of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => supports.register({
        id: `bad:${String(level)}`,
        level,
        worldY: 0,
        cells: [{ gx: 0, gz: 0 }],
        kind: 'platform',
        buildable: true,
        walkable: true,
        active: true,
      })).toThrow(RangeError);
    }
  });
});

describe('TraversalRegistry (data only)', () => {
  it('registers traversal data without implementing height or movement', () => {
    const traversals = new TraversalRegistry();
    const stair: TraversalSurface = {
      id: 'stairs:test',
      levelLow: 0,
      levelHigh: 1,
      worldYLow: 0,
      worldYHigh: levelBaseY(1),
      originCell: { gx: 0, gz: 0 },
      direction: 'east',
      runLengthCells: 4,
      widthCells: 1,
      stepCount: 8,
      stepRun: 0.5,
      stepRise: 0.375,
      cells: [{ gx: 0, gz: 0 }, { gx: 1, gz: 0 }],
      walkable: true,
    };
    traversals.register(stair);
    expect(traversals.atCell({ gx: 0, gz: 0 })).toHaveLength(1);
    expect(traversals.all()).toHaveLength(1);
    expect(traversals.get(stair.id)).toEqual(stair);
    traversals.unregister(stair.id);
    expect(traversals.atCell({ gx: 0, gz: 0 })).toHaveLength(0);
  });
});