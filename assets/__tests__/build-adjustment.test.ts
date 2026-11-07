import { describe, expect, it } from 'vitest';
import {
  beginAdjustment,
  copyPlacement,
  currentPlacement,
  moveAdjustmentTo,
  originalPlacement,
  rotateAdjustment,
  setAdjustmentValidity,
} from '../build/adjustment.ts';
import {
  cellsOf,
  createPlacement,
  placementCenter,
  worldExtent,
} from '../grid/grid.ts';
import { BUILDING_HEIGHT } from '../build/build.ts';
import { addTestSupport, createTestWorld } from './support-fixtures.ts';

const PLAYER_CELL = { gx: 0, gz: 0 };

describe('adjustment snapshot', () => {
  it('keeps an immutable original when moving and rotating', () => {
    const original = createPlacement(2, 3, 2, 3, 0);
    const begin = beginAdjustment(7, 2, original);
    expect(originalPlacement(begin)).toEqual(original);

    const moved = moveAdjustmentTo(begin, { gx: 5, gz: 6 });
    expect(currentPlacement(moved)).toEqual(createPlacement(5, 6, 2, 3, 0));
    expect(originalPlacement(moved)).toEqual(original);

    const rotated = rotateAdjustment(moved, 90);
    expect(currentPlacement(rotated)).toEqual(createPlacement(5, 6, 2, 3, 90));
    expect(originalPlacement(rotated)).toEqual(original);
    expect(rotated.placement).not.toBe(moved.placement);
    expect(rotated.original).toBe(begin.original);
  });

  it('moving preserves footprint, level and rotation; only anchor changes', () => {
    const begin = beginAdjustment(1, 1, createPlacement(1, 1, 2, 2, 180, 2));
    const moved = moveAdjustmentTo(begin, { gx: -3, gz: 4 });
    expect(moved.placement).toEqual(createPlacement(-3, 4, 2, 2, 180, 2));
    expect(moved.placement.level).toBe(2);
    expect(moved.hasPreview).toBe(true);
    expect(moved.valid).toBe(false);
  });

  it('four rotations return to the original direction and level', () => {
    let adj = beginAdjustment(1, 2, createPlacement(0, 0, 2, 3, 0, 1));
    for (let index = 0; index < 4; index += 1) adj = rotateAdjustment(adj, 90);
    expect(adj.placement.rotation).toBe(0);
    expect(adj.placement.level).toBe(1);
    expect(adj.placement).toEqual(createPlacement(0, 0, 2, 3, 0, 1));
  });

  it('tracks preview availability and validity separately', () => {
    const begin = beginAdjustment(1, 0, createPlacement(2, 2, 1, 1, 0));
    const invalid = setAdjustmentValidity(begin, true, false);
    expect(invalid.hasPreview).toBe(true);
    expect(invalid.valid).toBe(false);
    const hidden = setAdjustmentValidity(begin, false, false);
    expect(hidden.hasPreview).toBe(false);
  });
});

describe('rotation footprint under fixed anchor', () => {
  it('swaps 2x3 to 3x2 while keeping the anchor cell (accepted 0.5m center shift)', () => {
    const base = beginAdjustment(1, 2, createPlacement(1, 2, 2, 3, 0));
    const rotated = rotateAdjustment(base, 90);
    expect(worldExtent(rotated.placement)).toEqual({ w: 3, d: 2 });
    expect(rotated.placement.gx).toBe(1);
    expect(rotated.placement.gz).toBe(2);
    expect(cellsOf(rotated.placement)).toHaveLength(6);
    expect(placementCenter(base.placement)).toEqual([2, 0, 3.5]);
    expect(placementCenter(rotated.placement)).toEqual([2.5, 0, 3]);
  });

  it('keeps 1x1 and 2x2 centers stable under rotation', () => {
    for (const [w, d] of [[1, 1], [2, 2]]) {
      const base = beginAdjustment(1, 0, createPlacement(3, 4, w, d, 0));
      const rotated = rotateAdjustment(base, 90);
      expect(placementCenter(rotated.placement)).toEqual(placementCenter(base.placement));
    }
  });
});

describe('spatial index release and restore', () => {
  it('releases exactly the original cells and can re-register them', () => {
    const world = createTestWorld(PLAYER_CELL);
    const original = createPlacement(2, 2, 2, 3, 0);
    world.spatial.registerBuilding(9, original, BUILDING_HEIGHT);
    const snapshot = copyPlacement(original);
    world.spatial.unregisterBuilding(9);
    expect(world.spatial.overlapsPlacement(original, BUILDING_HEIGHT)).toHaveLength(0);

    // 调整期间移动到别处：原位置应当变得可建（除玩家格/资源外）
    expect(world.validate(original).ok).toBe(true);

    // 取消：按快照完整恢复
    world.spatial.registerBuilding(9, snapshot, BUILDING_HEIGHT);
    const overlaps = world.spatial.overlapsPlacement(snapshot, BUILDING_HEIGHT);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.buildingId).toBe(9);
  });

  it('does not affect another building occupancy', () => {
    const world = createTestWorld(PLAYER_CELL);
    const moving = createPlacement(0, 0, 2, 2, 0);
    const other = createPlacement(2, 0, 1, 1, 0);
    world.spatial.registerBuilding(1, moving, BUILDING_HEIGHT);
    world.spatial.registerBuilding(2, other, BUILDING_HEIGHT);
    world.spatial.unregisterBuilding(1);
    expect(world.spatial.overlapsPlacement(other, BUILDING_HEIGHT)).toHaveLength(1);
    expect(world.spatial.overlapsPlacement(moving, BUILDING_HEIGHT)).toHaveLength(0);
  });

  it('detects a conflict if the original cells were taken over', () => {
    const world = createTestWorld(PLAYER_CELL);
    const original = createPlacement(0, 0, 1, 1, 0);
    world.spatial.registerBuilding(3, original, BUILDING_HEIGHT);
    expect(world.spatial.overlapsPlacement(original, BUILDING_HEIGHT, 1)).toHaveLength(1);
  });
});

describe('placement validation cases used by move mode', () => {
  it('rejects overlap with another building', () => {
    const world = createTestWorld(PLAYER_CELL);
    world.spatial.registerBuilding(5, createPlacement(3, 3, 2, 2, 0), BUILDING_HEIGHT);
    expect(world.validate(createPlacement(3, 3, 2, 2, 0)).reason).toBe('occupied');
  });

  it('rejects outside the build area after rotation', () => {
    const world = createTestWorld(PLAYER_CELL);
    expect(world.validate(createPlacement(8, 8, 2, 3, 90)).reason).toBe('out-of-bounds');
  });

  it('rejects the player cell', () => {
    const world = createTestWorld({ gx: 0, gz: 0 });
    expect(world.validate(createPlacement(0, 0, 1, 1, 0)).reason).toBe('player-cell');
  });

  it('rejects resource-blocked cells through the predicate', () => {
    const world = createTestWorld(PLAYER_CELL);
    const blocked = (cell: { gx: number; gz: number }) => cell.gx === 1 && cell.gz === 1;
    expect(world.validate(createPlacement(1, 1, 1, 1, 0), 1, { isCellBlocked: blocked }).reason)
      .toBe('resource-cell');
  });

  it('accepts self position after releasing self occupancy', () => {
    const world = createTestWorld(PLAYER_CELL);
    const moving = createPlacement(3, 3, 2, 2, 0);
    world.spatial.registerBuilding(5, moving, BUILDING_HEIGHT);
    world.spatial.unregisterBuilding(5);
    expect(world.validate(moving).ok).toBe(true);
  });

  it('accepts a Level 1 move when the target support exists', () => {
    const world = createTestWorld(PLAYER_CELL);
    addTestSupport(world.supports, 'test:l1', 1, [{ gx: 5, gz: 5 }]);
    expect(world.validate(createPlacement(5, 5, 1, 1, 0, 1)).ok).toBe(true);
  });
});
