import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import { SpatialIndex } from '../spatial/occupancy.ts';
import { StructureRegistry } from '../spatial/structure.ts';
import { TraversalRegistry, type SupportRegistry } from '../spatial/support.ts';
import {
  MAIN_STAIRS,
  PLATFORM_AABB,
  PLATFORM_CELLS,
  PLATFORM_COLLIDER,
  PLATFORM_LEVEL,
  PLATFORM_SUPPORT,
  PLATFORM_WORLD_Y,
  STAIRS_COLLIDER,
  STAIRS_TRAVERSAL,
  stairStepCenter,
  stairStepTopY,
  stairsTraversal,
} from '../spatial/structures.ts';
import { addTestSupport, createTestWorld } from './support-fixtures.ts';

function registerPlatform(world: ReturnType<typeof createTestWorld>): StructureRegistry {
  world.supports.register(PLATFORM_SUPPORT);
  const structures = new StructureRegistry(world.spatial);
  structures.register(PLATFORM_COLLIDER);
  return structures;
}

describe('fixed platform data', () => {
  it('covers exactly 8x6 cells at level 1 and world Y 3', () => {
    expect(PLATFORM_CELLS).toHaveLength(48);
    expect(PLATFORM_LEVEL).toBe(1);
    expect(PLATFORM_WORLD_Y).toBe(3);
    expect(PLATFORM_CELLS[0]).toEqual({ gx: 0, gz: 2 });
    expect(PLATFORM_CELLS.at(-1)).toEqual({ gx: 7, gz: 7 });
    expect(PLATFORM_SUPPORT.kind).toBe('platform');
    expect(PLATFORM_SUPPORT.buildable).toBe(true);
    expect(PLATFORM_SUPPORT.walkable).toBe(true);
  });

  it('matches the locked platform AABB', () => {
    expect(PLATFORM_AABB).toEqual({
      min: [0, 2.7, 2],
      max: [8, 3, 8],
    });
    expect(PLATFORM_COLLIDER.blocksBuild).toBe(true);
    expect(PLATFORM_COLLIDER.blocksPlayer).toBe(false);
  });

  it('registers a platform support queryable at level 1 only', () => {
    const supports = createTestWorld().supports;
    supports.register(PLATFORM_SUPPORT);
    expect(supports.supportAt({ gx: 0, gz: 2 }, 1)?.id).toBe(PLATFORM_SUPPORT.id);
    expect(supports.supportAt({ gx: 8, gz: 8 }, 1)).toBeUndefined();
    expect(supports.supportAt({ gx: 0, gz: 2 }, 0)?.id).toBe('test:ground');
  });
});

describe('platform collision integration', () => {
  it('allows a 1m ground building under the platform', () => {
    const world = createTestWorld();
    registerPlatform(world);
    expect(world.validate(createPlacement(2, 3, 1, 1), 1).ok).toBe(true);
  });

  it('rejects a 2.8m ground building whose AABB overlaps the platform', () => {
    const world = createTestWorld();
    registerPlatform(world);
    expect(world.validate(createPlacement(2, 3, 1, 1), 2.8).reason).toBe('occupied');
  });

  it('allows a level 1 building on the platform top with support and surface touching', () => {
    const world = createTestWorld();
    registerPlatform(world);
    expect(world.validate(createPlacement(2, 3, 1, 1, 0, 1), 1).ok).toBe(true);
  });

  it('rejects a level 1 building outside the platform footprint', () => {
    const world = createTestWorld();
    registerPlatform(world);
    expect(world.validate(createPlacement(8, 8, 1, 1, 0, 1), 1).reason).toBe('unsupported');
  });

  it('platform support alone does not block: structure collider is required', () => {
    const world = createTestWorld();
    world.supports.register(PLATFORM_SUPPORT);
    expect(world.validate(createPlacement(2, 3, 1, 1), 2.8).ok).toBe(true);
  });
});

describe('stair data consistency', () => {
  it('uses the locked origin, direction and four cells', () => {
    expect(MAIN_STAIRS.originCell).toEqual({ gx: -4, gz: 3 });
    expect(MAIN_STAIRS.direction).toBe('east');
    expect(MAIN_STAIRS.cells).toEqual([
      { gx: -4, gz: 3 },
      { gx: -3, gz: 3 },
      { gx: -2, gz: 3 },
      { gx: -1, gz: 3 },
    ]);
    expect(MAIN_STAIRS.levelLow).toBe(0);
    expect(MAIN_STAIRS.levelHigh).toBe(1);
    expect(MAIN_STAIRS.worldYLow).toBe(0);
    expect(MAIN_STAIRS.worldYHigh).toBe(3);
  });

  it('shares stepCount/stepRun/stepRise between visual and traversal data', () => {
    expect(MAIN_STAIRS.stepCount).toBe(8);
    expect(MAIN_STAIRS.stepCount * MAIN_STAIRS.stepRun).toBe(MAIN_STAIRS.runLengthCells);
    expect(MAIN_STAIRS.stepCount * MAIN_STAIRS.stepRise).toBe(MAIN_STAIRS.worldYHigh - MAIN_STAIRS.worldYLow);
    expect(STAIRS_TRAVERSAL.stepCount).toBe(8);
    expect(STAIRS_TRAVERSAL.stepRun).toBe(0.5);
    expect(STAIRS_TRAVERSAL.stepRise).toBe(0.375);
    expect(stairStepTopY(0)).toBe(0.375);
    expect(stairStepTopY(7)).toBe(3);
    expect(stairStepCenter(0)).toEqual({ x: -3.75, z: 3.5, topY: 0.375 });
    expect(stairStepCenter(7)).toEqual({ x: -0.25, z: 3.5, topY: 3 });
    expect(stairsTraversal()).toEqual(STAIRS_TRAVERSAL);
  });

  it('rejects inconsistent traversal step metadata at registry entry', () => {
    const traversals = new TraversalRegistry();
    expect(() => traversals.register({ ...STAIRS_TRAVERSAL, stepCount: 7 })).toThrow(RangeError);
    expect(() => traversals.register({ ...STAIRS_TRAVERSAL, stepRise: 0.5 })).toThrow(RangeError);
  });

  it('registers the stair traversal and its conservative collider', () => {
    const world = createTestWorld();
    const traversals = new TraversalRegistry();
    traversals.register(STAIRS_TRAVERSAL);
    expect(traversals.atCell({ gx: -2, gz: 3 })).toHaveLength(1);
    const structures = new StructureRegistry(world.spatial);
    structures.register(STAIRS_COLLIDER);
    expect(STAIRS_COLLIDER.aabb).toEqual({ min: [-4, 0, 3], max: [0, 3, 4] });
    expect(STAIRS_COLLIDER.blocksBuild).toBe(true);
    expect(STAIRS_COLLIDER.blocksPlayer).toBe(false);
    expect(world.validate(createPlacement(-2, 3, 1, 1)).reason).toBe('occupied');
    expect(world.validate(createPlacement(-2, 2, 1, 1)).ok).toBe(true);
  });
});

describe('structure registry flags and cleanup', () => {
  it('only blocksBuild colliders enter the shared spatial index', () => {
    const index = new SpatialIndex();
    const structures = new StructureRegistry(index);
    structures.register({ id: 'solid', aabb: PLATFORM_AABB, blocksBuild: true, blocksPlayer: false });
    structures.register({
      id: 'future',
      aabb: { min: [20, 0, 20], max: [21, 1, 21] },
      blocksBuild: false,
      blocksPlayer: true,
    });
    expect(index.size).toBe(1);
    expect(structures.size).toBe(2);
    expect(structures.get('future')?.blocksPlayer).toBe(true);
    structures.unregister('solid');
    expect(index.size).toBe(0);
    expect(structures.size).toBe(1);
  });

  it('unregisters platform support/collider and traversal without residual state', () => {
    const world = createTestWorld();
    const structures = new StructureRegistry(world.spatial);
    const traversals = new TraversalRegistry();
    world.supports.register(PLATFORM_SUPPORT);
    structures.register(PLATFORM_COLLIDER);
    traversals.register(STAIRS_TRAVERSAL);

    structures.unregister(PLATFORM_COLLIDER.id);
    world.supports.unregister(PLATFORM_SUPPORT.id);
    traversals.unregister(STAIRS_TRAVERSAL.id);

    expect(world.spatial.size).toBe(0);
    expect(world.supports.supportAt({ gx: 2, gz: 2 }, 1)).toBeUndefined();
    expect(traversals.atCell({ gx: -2, gz: 3 })).toHaveLength(0);
    expect(structures.size).toBe(0);
  });
});