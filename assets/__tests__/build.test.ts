import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import {
  BUILDING_HEIGHT,
  buildingAabb,
  rayAabbDistance,
} from '../build/build.ts';
import { addTestSupport, createTestWorld } from './support-fixtures.ts';

const PLAYER_CELL = { gx: -9, gz: -9 };

describe('placement validation', () => {
  it('accepts a valid 1x1 placement on ground support', () => {
    const world = createTestWorld(PLAYER_CELL);
    expect(world.validate(createPlacement(2, 3, 1, 1))).toEqual({ ok: true });
  });

  it('rejects placements outside the 32x32 build area', () => {
    const world = createTestWorld(PLAYER_CELL);
    // 旧 20×20 边界现在合法：地图若退回 20×20，这三条会失败（回滚哨兵）
    expect(world.validate(createPlacement(-11, 0, 1, 1)).ok).toBe(true);
    expect(world.validate(createPlacement(9, 9, 2, 2)).ok).toBe(true);
    expect(world.validate(createPlacement(9, 9, 1, 1)).ok).toBe(true);
    // 新边界：MIN-1 / MAX+1 越界
    expect(world.validate(createPlacement(-17, 0, 1, 1)).reason).toBe('out-of-bounds');
    expect(world.validate(createPlacement(16, 0, 1, 1)).reason).toBe('out-of-bounds');
    expect(world.validate(createPlacement(0, -17, 1, 1)).reason).toBe('out-of-bounds');
    expect(world.validate(createPlacement(0, 16, 1, 1)).reason).toBe('out-of-bounds');
    // 锚点在 MAX 处、footprint 越界
    expect(world.validate(createPlacement(15, 15, 2, 2)).reason).toBe('out-of-bounds');
    expect(world.validate(createPlacement(15, 15, 2, 3)).reason).toBe('out-of-bounds');
  });

  it('accepts the 32x32 center, corners and legacy anchors (rollback sentinels)', () => {
    const world = createTestWorld(PLAYER_CELL);
    expect(world.validate(createPlacement(0, 0, 1, 1)).ok).toBe(true);
    for (const [gx, gz] of [[15, 15], [-16, -16], [15, -16], [-16, 15]] as const) {
      expect(world.validate(createPlacement(gx, gz, 1, 1)).ok).toBe(true);
    }
    // 旧 20×20 内的锚点也必须合法（地图若退回 20×20，这两条会失败）
    expect(world.validate(createPlacement(10, 10, 1, 1)).ok).toBe(true);
    expect(world.validate(createPlacement(9, 9, 2, 2)).ok).toBe(true);
  });

  it('rejects placements without a support surface at the target level', () => {
    const world = createTestWorld(PLAYER_CELL);
    expect(world.validate(createPlacement(2, 3, 1, 1, 0, 1)).reason).toBe('unsupported');
  });

  it('accepts a Level 1 placement on a synthetic standard support', () => {
    const world = createTestWorld(PLAYER_CELL);
    addTestSupport(world.supports, 'test:l1', 1, [{ gx: 2, gz: 3 }]);
    expect(world.validate(createPlacement(2, 3, 1, 1, 0, 1)).ok).toBe(true);
  });

  it('rejects overlapping placements via 3D spatial index', () => {
    const world = createTestWorld(PLAYER_CELL);
    const first = createPlacement(0, 0, 2, 2);
    world.spatial.registerBuilding(1, first, BUILDING_HEIGHT);
    expect(world.validate(createPlacement(1, 1, 1, 1)).reason).toBe('occupied');
    expect(world.validate(createPlacement(2, 0, 1, 1)).ok).toBe(true);
  });

  it('rejects placements blocked by an extra predicate (resource cells)', () => {
    const world = createTestWorld(PLAYER_CELL);
    const blocked = (cell: { gx: number; gz: number }) => cell.gx === 1 && cell.gz === 1;
    expect(world.validate(createPlacement(1, 1, 1, 1), 1, { isCellBlocked: blocked }).reason)
      .toBe('resource-cell');
    expect(world.validate(createPlacement(2, 2, 1, 1), 1, { isCellBlocked: blocked }).ok).toBe(true);
  });

  it('blocks the player cell without registering it in the spatial index', () => {
    const world = createTestWorld(PLAYER_CELL);
    expect(world.validate(createPlacement(-9, -9, 1, 1)).reason).toBe('player-cell');
    expect(world.spatial.size).toBe(0);
  });

  it('does not block a Level 1 building whose AABB is above the player volume', () => {
    const world = createTestWorld({ gx: 2, gz: 3 });
    addTestSupport(world.supports, 'test:l1', 1, [{ gx: 2, gz: 3 }]);
    expect(world.validate(createPlacement(2, 3, 1, 1, 0, 1)).ok).toBe(true);
  });

  it('registers and unregisters through the spatial index', () => {
    const world = createTestWorld(PLAYER_CELL);
    const placement = createPlacement(4, 4, 2, 3);
    world.spatial.registerBuilding(7, placement, BUILDING_HEIGHT);
    expect(world.spatial.size).toBe(1);
    expect(world.spatial.overlapsPlacement(placement, BUILDING_HEIGHT).length).toBe(1);
    world.spatial.unregisterBuilding(7);
    expect(world.spatial.size).toBe(0);
    expect(world.spatial.overlapsPlacement(placement, BUILDING_HEIGHT)).toHaveLength(0);
  });

  it('rejects Level 1 collision when AABBs actually overlap across levels', () => {
    const world = createTestWorld(PLAYER_CELL);
    addTestSupport(world.supports, 'test:l1', 1, [{ gx: 2, gz: 3 }]);
    // 4m 高建筑从地面覆盖到 level1 的 slab，与 level1 建筑 AABB 在 y=3 上相交。
    world.spatial.registerBuilding(1, createPlacement(2, 3, 1, 1), 4);
    expect(world.validate(createPlacement(2, 3, 1, 1, 0, 1)).reason).toBe('occupied');
  });
});

describe('rectangle rotation footprint', () => {
  it('swaps 2x3 into 3x2 when rotated 90 degrees', () => {
    const placement = createPlacement(0, 0, 2, 3, 0);
    expect(buildingAabb(placement, 1).min).toEqual([0, 0, 0]);
    expect(buildingAabb(placement, 1).max).toEqual([2, 1, 3]);
    const rotated = createPlacement(0, 0, 2, 3, 90);
    expect(buildingAabb(rotated, 1).max).toEqual([3, 1, 2]);
  });
});

describe('building AABB and ray selection', () => {
  it('builds a grounded AABB from the placement footprint', () => {
    const aabb = buildingAabb(createPlacement(2, 3, 2, 2));
    expect(aabb.min).toEqual([2, 0, 3]);
    expect(aabb.max).toEqual([4, BUILDING_HEIGHT, 5]);
  });

  it('builds a Level 1 AABB at world Y = 3', () => {
    const aabb = buildingAabb(createPlacement(2, 3, 1, 1, 0, 1));
    expect(aabb.min).toEqual([2, 3, 3]);
    expect(aabb.max).toEqual([3, 4, 4]);
  });

  it('hits the nearest box and misses elsewhere', () => {
    const ray: number[] = [2.5, 5, 3.5, 0, -1, 0]; // 从上方垂直向下
    const t = rayAabbDistance(ray, [2, 0, 3], [4, 1, 5]);
    expect(t).toBeCloseTo(4, 9);
    expect(rayAabbDistance([0, 5, 0, 0, -1, 0], [2, 0, 3], [4, 1, 5])).toBeUndefined();
    expect(rayAabbDistance([2.5, -1, 3.5, 0, -1, 0], [2, 0, 3], [4, 1, 5])).toBeUndefined();
  });

  it('handles rays starting inside the box', () => {
    expect(rayAabbDistance([3, 0.5, 4, 0, -1, 0], [2, 0, 3], [4, 1, 5])).toBe(0);
  });
});