import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import { SpatialIndex } from '../spatial/occupancy.ts';
import { levelsForSpan } from '../spatial/space.ts';

const HEIGHT = 1;

describe('SpatialIndex buildings', () => {
  it('finds same XZ + same level occupancy', () => {
    const index = new SpatialIndex();
    index.registerBuilding(1, createPlacement(0, 0, 2, 2), HEIGHT);
    expect(index.overlapsPlacement(createPlacement(1, 1, 1, 1), HEIGHT)).toHaveLength(1);
    expect(index.idsAt({ gx: 0, gz: 0 }, 0)).toContain('building:1');
  });

  it('allows same XZ at different levels when AABBs do not overlap', () => {
    const index = new SpatialIndex();
    index.registerBuilding(1, createPlacement(0, 0, 1, 1, 0, 0), HEIGHT);
    expect(index.overlapsPlacement(createPlacement(0, 0, 1, 1, 0, 1), HEIGHT)).toHaveLength(0);
  });

  it('detects cross-level collision when a tall building AABB overlaps', () => {
    const index = new SpatialIndex();
    index.registerBuilding(1, createPlacement(0, 0, 1, 1, 0, 0), 4);
    const overlaps = index.overlapsPlacement(createPlacement(0, 0, 1, 1, 0, 1), HEIGHT);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.buildingId).toBe(1);
  });

  it('treats exact surface touching as non-collision', () => {
    const index = new SpatialIndex();
    index.registerBuilding(1, createPlacement(0, 0, 1, 1, 0, 0), 3);
    expect(index.overlapsPlacement(createPlacement(0, 0, 1, 1, 0, 1), HEIGHT)).toHaveLength(0);
  });

  it('excludes the moving building itself', () => {
    const index = new SpatialIndex();
    const placement = createPlacement(2, 2, 2, 2);
    index.registerBuilding(5, placement, HEIGHT);
    expect(index.overlapsPlacement(placement, HEIGHT, 5)).toHaveLength(0);
    expect(index.overlapsPlacement(placement, HEIGHT)).toHaveLength(1);
  });

  it('removes all keys on unregister and leaves other buildings intact', () => {
    const index = new SpatialIndex();
    index.registerBuilding(1, createPlacement(0, 0, 2, 2), HEIGHT);
    index.registerBuilding(2, createPlacement(2, 0, 1, 1), HEIGHT);
    index.unregisterBuilding(1);
    expect(index.idsAt({ gx: 0, gz: 0 }, 0)).toHaveLength(0);
    expect(index.overlapsPlacement(createPlacement(2, 0, 1, 1), HEIGHT)).toHaveLength(1);
    expect(index.size).toBe(1);
  });

  it('rejects duplicate registration instead of leaving stale state', () => {
    const index = new SpatialIndex();
    index.registerBuilding(1, createPlacement(0, 0, 1, 1), HEIGHT);
    expect(() => index.registerBuilding(1, createPlacement(0, 0, 1, 1), HEIGHT)).toThrow();
    expect(index.size).toBe(1);
  });

  it('indexes tall buildings into every overlapped level slab', () => {
    expect(levelsForSpan(0, 4)).toEqual([0, 1]);
    const index = new SpatialIndex();
    index.registerBuilding(1, createPlacement(0, 0, 1, 1), 4);
    expect(index.idsAt({ gx: 0, gz: 0 }, 0)).toContain('building:1');
    expect(index.idsAt({ gx: 0, gz: 0 }, 1)).toContain('building:1');
  });
});

describe('SpatialIndex negative coordinates', () => {
  it('indexes and queries negative board coordinates', () => {
    const index = new SpatialIndex();
    index.registerBuilding(1, createPlacement(-5, -4, 2, 2), HEIGHT);
    expect(index.idsAt({ gx: -5, gz: -4 }, 0)).toContain('building:1');
    expect(index.overlapsPlacement(createPlacement(-4, -3, 1, 1), HEIGHT)).toHaveLength(1);
    expect(index.overlapsPlacement(createPlacement(-6, -4, 1, 1), HEIGHT)).toHaveLength(0);
  });

  it('handles AABB queries that cross the origin', () => {
    const index = new SpatialIndex();
    index.registerStructure('origin', { min: [-1, 2.7, -1] as const, max: [1, 3, 1] as const });
    expect(index.overlapsAabb({ min: [-0.5, 2.8, -0.5] as const, max: [0.5, 2.9, 0.5] as const })).toHaveLength(1);
    expect(index.overlapsAabb({ min: [1, 2.8, 1] as const, max: [2, 2.9, 2] as const })).toHaveLength(0);
  });
});

describe('SpatialIndex structures', () => {
  const platformAabb = { min: [0, 2.7, 0] as const, max: [8, 3.0, 8] as const };

  it('finds structures through the same AABB query', () => {
    const index = new SpatialIndex();
    index.registerStructure('platform', platformAabb);
    expect(index.overlapsAabb({ min: [2, 2.8, 2], max: [3, 2.9, 3] })).toHaveLength(1);
    expect(index.overlapsAabb({ min: [2, 0, 2], max: [3, 1, 3] })).toHaveLength(0);
  });

  it('allows a 1m ground building under the platform but rejects a 2.8m one', () => {
    const index = new SpatialIndex();
    index.registerStructure('platform', platformAabb);
    expect(index.overlapsPlacement(createPlacement(2, 2, 1, 1), 1)).toHaveLength(0);
    expect(index.overlapsPlacement(createPlacement(2, 2, 1, 1), 2.8)).toHaveLength(1);
  });

  it('allows a level 1 building on the platform top (surface touching)', () => {
    const index = new SpatialIndex();
    index.registerStructure('platform', platformAabb);
    expect(index.overlapsPlacement(createPlacement(2, 2, 1, 1, 0, 1), 1)).toHaveLength(0);
  });

  it('does not confuse a level with a collision', () => {
    const index = new SpatialIndex();
    index.registerStructure('platform', platformAabb);
    const hits = index.overlapsPlacement(createPlacement(2, 2, 1, 1, 0, 0), 4);
    expect(hits.some((hit) => hit.kind === 'structure')).toBe(true);
  });

  it('can unregister a structure without residual records', () => {
    const index = new SpatialIndex();
    index.registerStructure('platform', platformAabb);
    index.unregisterStructure('platform');
    expect(index.size).toBe(0);
    expect(index.overlapsAabb(platformAabb)).toHaveLength(0);
  });
});