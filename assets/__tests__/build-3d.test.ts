import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import { beginAdjustment, moveAdjustmentTo, rotateAdjustment } from '../build/adjustment.ts';
import { buildingAabb } from '../build/build.ts';
import { StructureRegistry } from '../spatial/structure.ts';
import { PLATFORM_AABB, PLATFORM_COLLIDER, PLATFORM_SUPPORT } from '../spatial/structures.ts';
import { placementBaseY } from '../spatial/space.ts';
import { createTestWorld } from './support-fixtures.ts';

function platformWorld() {
  const world = createTestWorld();
  world.supports.register(PLATFORM_SUPPORT);
  const structures = new StructureRegistry(world.spatial);
  structures.register(PLATFORM_COLLIDER);
  return { world, structures };
}

describe('level-aware building validation', () => {
  it('places a level 1 building on the platform', () => {
    const { world } = platformWorld();
    expect(world.validate(createPlacement(2, 3, 1, 1, 0, 1), 1).ok).toBe(true);
  });

  it('rejects a level 1 building outside the platform footprint', () => {
    const { world } = platformWorld();
    expect(world.validate(createPlacement(8, 8, 1, 1, 0, 1), 1).reason).toBe('unsupported');
  });

  it('keeps the platform AABB and level AABB consistent', () => {
    const placement = createPlacement(2, 3, 1, 1, 0, 1);
    expect(placementBaseY(placement)).toBe(3);
    expect(buildingAabb(placement, 1)).toEqual({
      min: [2, 3, 3],
      max: [3, 4, 4],
    });
    expect(PLATFORM_AABB).toEqual({ min: [0, 2.7, 2], max: [8, 3, 8] });
  });

  it('allows 1m under the platform and rejects 2.8m', () => {
    const { world } = platformWorld();
    expect(world.validate(createPlacement(2, 2, 1, 1), 1).ok).toBe(true);
    expect(world.validate(createPlacement(2, 2, 1, 1), 2.8).reason).toBe('occupied');
  });

  it('rejects a level 1 building overlapping another level 1 building', () => {
    const { world } = platformWorld();
    world.spatial.registerBuilding(1, createPlacement(2, 3, 1, 1, 0, 1), 1);
    expect(world.validate(createPlacement(2, 3, 1, 1, 0, 1), 1).reason).toBe('occupied');
  });
});

describe('adjustment preserves level', () => {
  it('moves and rotates a platform building without changing its level', () => {
    const platform = createPlacement(2, 3, 1, 1, 0, 1);
    const begin = beginAdjustment(1, 0, platform);
    const moved = moveAdjustmentTo(begin, { gx: 4, gz: 5 });
    expect(moved.placement.level).toBe(1);
    const rotated = rotateAdjustment(moved, 90);
    expect(rotated.placement.level).toBe(1);
    expect(rotated.placement.gx).toBe(4);
    expect(rotated.placement.gz).toBe(5);
  });
});
