import { describe, expect, it } from 'vitest';
import { BUILD_AREA_MAX_CELL, BUILD_AREA_MIN_CELL } from '../grid/grid-overlay.ts';
import { CELL_SIZE, type Cell } from '../grid/grid.ts';
import {
  GROUND_SUPPORT_ID,
  SupportRegistry,
  TraversalRegistry,
  type SupportSurface,
} from '../spatial/support.ts';
import {
  PLATFORM_SUPPORT,
  STAIRS_TRAVERSAL,
  stairStepIndexAt,
  stairStepCenter,
  stairSurfaceStepTopY,
} from '../spatial/structures.ts';
import {
  FLAT_SWITCH_TOLERANCE,
  STAIR_CONTINUOUS_TOLERANCE,
  STAIR_ENTRY_TOLERANCE,
  resolveMove,
  resolveWithSliding,
  selectFlatSupport,
  type VerticalState,
  type VerticalWorld,
} from '../player/vertical.ts';

function createWorld(): VerticalWorld {
  const supports = new SupportRegistry();
  const cells: Cell[] = [];
  for (let gz = BUILD_AREA_MIN_CELL; gz <= BUILD_AREA_MAX_CELL; gz += 1) {
    for (let gx = BUILD_AREA_MIN_CELL; gx <= BUILD_AREA_MAX_CELL; gx += 1) {
      cells.push({ gx, gz });
    }
  }
  supports.register({
    id: GROUND_SUPPORT_ID,
    level: 0,
    worldY: 0,
    cells,
    kind: 'ground',
    buildable: true,
    walkable: true,
    active: true,
  });
  supports.register(PLATFORM_SUPPORT);
  const traversals = new TraversalRegistry();
  traversals.register(STAIRS_TRAVERSAL);
  return { supports, traversals };
}

function groundState(x: number, z: number): VerticalState {
  return { x, feetY: 0, z, level: 0, supportId: GROUND_SUPPORT_ID };
}

function platformState(x: number, z: number): VerticalState {
  return { x, feetY: 3, z, level: 1, supportId: PLATFORM_SUPPORT.id };
}

function stairState(x: number, z: number, level = 0): VerticalState {
  const index = stairStepIndexAt(x, z, STAIRS_TRAVERSAL);
  if (index === undefined) throw new Error('test point not on stairs');
  return {
    x,
    feetY: stairSurfaceStepTopY(STAIRS_TRAVERSAL, index),
    z,
    level,
    supportId: STAIRS_TRAVERSAL.id,
  };
}

function move(world: VerticalWorld, state: VerticalState, x: number, z: number) {
  return resolveMove(state, x, z, world);
}

describe('deterministic flat support selection', () => {
  const world = createWorld();
  const atPlatformCell = world.supports.supportsAtPoint(0.5, 3.5);

  it('selects Ground at feetY=0 and Platform at feetY=3 despite overlapping range', () => {
    expect(selectFlatSupport(atPlatformCell, null, 0, FLAT_SWITCH_TOLERANCE)?.id)
      .toBe(GROUND_SUPPORT_ID);
    expect(selectFlatSupport(atPlatformCell, null, 3, FLAT_SWITCH_TOLERANCE)?.id)
      .toBe(PLATFORM_SUPPORT.id);
  });

  it('is independent of candidate (registry) order', () => {
    const reversed = [...atPlatformCell].reverse();
    expect(selectFlatSupport(atPlatformCell, null, 3, FLAT_SWITCH_TOLERANCE)?.id)
      .toBe(selectFlatSupport(reversed, null, 3, FLAT_SWITCH_TOLERANCE)?.id);
  });

  it('prefers the current support when valid', () => {
    const current = atPlatformCell.find((surface) => surface.id === PLATFORM_SUPPORT.id);
    expect(selectFlatSupport([...atPlatformCell], PLATFORM_SUPPORT.id, 3, FLAT_SWITCH_TOLERANCE))
      .toBe(current);
  });

  it('filters inactive and non-walkable surfaces', () => {
    const inactive: SupportSurface = {
      id: 'inactive', level: 1, worldY: 3, cells: [{ gx: 0, gz: 3 }],
      kind: 'platform', buildable: true, walkable: true, active: false,
    };
    const nonWalkable: SupportSurface = {
      id: 'non-walkable', level: 1, worldY: 3, cells: [{ gx: 0, gz: 3 }],
      kind: 'platform', buildable: true, walkable: false, active: true,
    };
    expect(selectFlatSupport([inactive, nonWalkable], null, 3, FLAT_SWITCH_TOLERANCE)).toBeUndefined();
  });

  it('uses level then id as deterministic tie-breakers', () => {
    const low: SupportSurface = {
      id: 'z-low', level: 0, worldY: 1, cells: [{ gx: 0, gz: 3 }],
      kind: 'ground', buildable: true, walkable: true, active: true,
    };
    const highA: SupportSurface = {
      id: 'b-high', level: 1, worldY: 1, cells: [{ gx: 0, gz: 3 }],
      kind: 'platform', buildable: true, walkable: true, active: true,
    };
    const highB: SupportSurface = {
      id: 'a-high', level: 1, worldY: 1, cells: [{ gx: 0, gz: 3 }],
      kind: 'platform', buildable: true, walkable: true, active: true,
    };
    expect(selectFlatSupport([low, highB, highA], null, 1, FLAT_SWITCH_TOLERANCE)?.id)
      .toBe('a-high');
  });
});

describe('discrete stair geometry', () => {
  it('maps locked x positions to the correct step and top height', () => {
    expect(stairStepIndexAt(-4, 3.5, STAIRS_TRAVERSAL)).toBe(0);
    expect(stairStepIndexAt(-3.5001, 3.5, STAIRS_TRAVERSAL)).toBe(0);
    expect(stairStepIndexAt(-3.5, 3.5, STAIRS_TRAVERSAL)).toBe(1);
    expect(stairStepIndexAt(-0.01, 3.5, STAIRS_TRAVERSAL)).toBe(7);
    expect(stairStepIndexAt(0, 3.5, STAIRS_TRAVERSAL)).toBeUndefined();
    expect(stairStepIndexAt(-2, 2.99, STAIRS_TRAVERSAL)).toBeUndefined();
    expect(stairSurfaceStepTopY(STAIRS_TRAVERSAL, 0)).toBe(0.375);
    expect(stairSurfaceStepTopY(STAIRS_TRAVERSAL, 7)).toBe(3);
  });

  it('keeps visual step centers consistent with CELL_SIZE', () => {
    expect(CELL_SIZE).toBe(1);
    expect(stairStepCenter(0)).toEqual({ x: -3.75, z: 3.5, topY: 0.375 });
    expect(stairStepCenter(7)).toEqual({ x: -0.25, z: 3.5, topY: 3 });
  });
});

describe('ground and platform movement', () => {
  const world = createWorld();

  it('keeps feetY=0 on ground', () => {
    const result = move(world, groundState(2, 2), 2.2, 2);
    expect(result.moved).toBe(true);
    if (!result.moved) return;
    expect(result.position[1]).toBe(0);
    expect(result.supportId).toBe(GROUND_SUPPORT_ID);
    expect(result.level).toBe(0);
  });

  it('keeps feetY=3 on the platform', () => {
    const result = move(world, platformState(0.5, 3.5), 0.7, 3.5);
    expect(result.moved).toBe(true);
    if (!result.moved) return;
    expect(result.position[1]).toBe(3);
    expect(result.supportId).toBe(PLATFORM_SUPPORT.id);
    expect(result.level).toBe(1);
  });

  it('blocks walking directly off a platform edge', () => {
    const result = move(world, platformState(0.5, 2.1), 0.5, 1.9);
    expect(result.moved).toBe(false);
  });

  it('keeps Ground under the platform instead of switching to Platform', () => {
    const result = move(world, groundState(0.5, 1.9), 0.5, 2.1);
    expect(result.moved).toBe(true);
    if (!result.moved) return;
    expect(result.position[1]).toBe(0);
    expect(result.supportId).toBe(GROUND_SUPPORT_ID);
  });
});

describe('stair entry and exit', () => {
  const world = createWorld();

  it('enters step 0 from Ground at the low end', () => {
    const result = move(world, groundState(-4.2, 3.5), -3.9, 3.5);
    expect(result.moved).toBe(true);
    if (!result.moved) return;
    expect(result.position[1]).toBe(0.375);
    expect(result.supportId).toBe(STAIRS_TRAVERSAL.id);
    expect(result.level).toBe(0);
    expect(result.cell).toEqual({ gx: -4, gz: 3 });
  });

  it('walks up one step and keeps height within one tread', () => {
    const first = move(world, stairState(-3.9, 3.5), -3.4, 3.5);
    expect(first.moved).toBe(true);
    if (!first.moved) return;
    expect(first.position[1]).toBe(0.75);

    const sameTread = move(world, stairState(-3.4, 3.5), -3.2, 3.5);
    expect(sameTread.moved).toBe(true);
    if (!sameTread.moved) return;
    expect(sameTread.position[1]).toBe(0.75);
  });

  it('reaches step 7 and exits onto the platform at the high end', () => {
    const exit = move(world, stairState(-0.1, 3.5), 0.1, 3.5);
    expect(exit.moved).toBe(true);
    if (!exit.moved) return;
    expect(exit.position[1]).toBe(3);
    expect(exit.supportId).toBe(PLATFORM_SUPPORT.id);
    expect(exit.level).toBe(1);
  });

  it('enters the stairs from the platform at the high end', () => {
    const result = move(world, platformState(0.1, 3.5), -0.1, 3.5);
    expect(result.moved).toBe(true);
    if (!result.moved) return;
    expect(result.position[1]).toBe(3);
    expect(result.supportId).toBe(STAIRS_TRAVERSAL.id);
    expect(result.level).toBe(1);
  });

  it('exits step 0 back to Ground at the low end', () => {
    const result = move(world, stairState(-3.9, 3.5), -4.1, 3.5);
    expect(result.moved).toBe(true);
    if (!result.moved) return;
    expect(result.position[1]).toBe(0);
    expect(result.supportId).toBe(GROUND_SUPPORT_ID);
    expect(result.level).toBe(0);
  });

  it('reverses direction inside the stairs', () => {
    const down = move(world, stairState(-2.5, 3.5), -2.6, 3.5);
    expect(down.moved).toBe(true);
    if (!down.moved) return;
    expect(down.position[1]).toBe(1.125);
    expect(down.supportId).toBe(STAIRS_TRAVERSAL.id);
    expect(down.level).toBe(0);
  });

  it('blocks side entry and does not snap to stair height', () => {
    const result = move(world, groundState(-2, 2.9), -2, 3.1);
    expect(result.moved).toBe(false);
  });

  it('blocks side exit, including step 0', () => {
    const result = move(world, stairState(-4, 3.1), -4, 2.9);
    expect(result.moved).toBe(false);
  });

  it('does not allow walking under the stairs through Ground', () => {
    const result = move(world, groundState(-2, 3.5), -1.9, 3.5);
    expect(result.moved).toBe(false);
  });

  it('blocks illegally crossing the high end from Ground', () => {
    const result = move(world, groundState(0.1, 3.5), -0.1, 3.5);
    expect(result.moved).toBe(false);
  });

  it('has tolerance constants covering the first step but not a full floor', () => {
    expect(STAIR_ENTRY_TOLERANCE).toBe(0.45);
    expect(STAIR_CONTINUOUS_TOLERANCE).toBe(0.45);
    expect(STAIR_ENTRY_TOLERANCE).toBeGreaterThan(0.375);
    expect(STAIR_ENTRY_TOLERANCE).toBeLessThan(3);
  });
});

describe('transaction and axis sliding', () => {
  const world = createWorld();

  it('leaves every field unchanged on a failed move', () => {
    const state = groundState(-2, 2.9);
    const result = move(world, state, -2, 3.1);
    expect(result.moved).toBe(false);
    expect(state).toEqual({ x: -2, feetY: 0, z: 2.9, level: 0, supportId: GROUND_SUPPORT_ID });
  });

  it('X-only sliding re-resolves support and stays on Ground', () => {
    const state = groundState(-2, 2.9);
    const result = resolveWithSliding(state, -1.9, 3.1, world);
    expect(result.moved).toBe(true);
    if (!result.moved) return;
    expect(result.position[0]).toBeCloseTo(-1.9, 9);
    expect(result.position[2]).toBeCloseTo(2.9, 9);
    expect(result.position[1]).toBe(0);
    expect(result.supportId).toBe(GROUND_SUPPORT_ID);
  });

  it('Z-only sliding works at a platform edge and keeps feetY=3', () => {
    const state = platformState(0.5, 2.1);
    const result = resolveWithSliding(state, 0.6, 1.9, world);
    expect(result.moved).toBe(true);
    if (!result.moved) return;
    expect(result.position[0]).toBeCloseTo(0.6, 9);
    expect(result.position[2]).toBeCloseTo(2.1, 9);
    expect(result.position[1]).toBe(3);
    expect(result.supportId).toBe(PLATFORM_SUPPORT.id);
  });

  it('does not use a previous height result when sliding', () => {
    const state = groundState(-2, 2.9);
    const xOnly = resolveMove(state, -1.9, 2.9, world);
    expect(xOnly.moved).toBe(true);
    if (!xOnly.moved) return;
    expect(xOnly.position[1]).toBe(0);
    const zOnly = resolveMove(state, -2, 3.1, world);
    expect(zOnly.moved).toBe(false);
  });
});