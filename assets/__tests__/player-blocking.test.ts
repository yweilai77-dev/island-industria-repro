import { describe, expect, it } from 'vitest';
import { BUILD_AREA_MAX_CELL, BUILD_AREA_MIN_CELL } from '../grid/grid-overlay.ts';
import type { Cell } from '../grid/grid.ts';
import {
  GROUND_SUPPORT_ID,
  SupportRegistry,
  TraversalRegistry,
} from '../spatial/support.ts';
import { PLATFORM_SUPPORT, STAIRS_TRAVERSAL, stairStepIndexAt, stairSurfaceStepTopY } from '../spatial/structures.ts';
import type { Aabb } from '../spatial/space.ts';
import {
  PLAYER_HALF_EXTENT,
  PLAYER_HEIGHT,
  blocksPlayerMove,
  playerAabb,
  segmentIntersectsRectXZ,
} from '../player/occupancy.ts';
import {
  resolveMove,
  resolveWithSliding,
  type VerticalState,
  type VerticalWorld,
} from '../player/vertical.ts';

function createWorld(blocker?: (fromX: number, fromZ: number, toX: number, toZ: number, yMin: number, yMax: number) => boolean): VerticalWorld {
  const supports = new SupportRegistry();
  const cells: Cell[] = [];
  for (let gz = BUILD_AREA_MIN_CELL; gz <= BUILD_AREA_MAX_CELL; gz += 1) {
    for (let gx = BUILD_AREA_MIN_CELL; gx <= BUILD_AREA_MAX_CELL; gx += 1) cells.push({ gx, gz });
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
  return { supports, traversals, isBlockedMove: blocker };
}

function groundState(x: number, z: number): VerticalState {
  return { x, feetY: 0, z, level: 0, supportId: GROUND_SUPPORT_ID };
}

function stairState(x: number, z: number): VerticalState {
  const index = stairStepIndexAt(x, z, STAIRS_TRAVERSAL)!;
  return {
    x,
    feetY: stairSurfaceStepTopY(STAIRS_TRAVERSAL, index),
    z,
    level: 0,
    supportId: STAIRS_TRAVERSAL.id,
  };
}

describe('player occupancy geometry', () => {
  it('builds the shared AABB and sweeps it against an expanded blocker', () => {
    const player = playerAabb(1, 0, 2);
    expect(player.min).toEqual([1 - PLAYER_HALF_EXTENT, 0, 2 - PLAYER_HALF_EXTENT]);
    expect(player.max[1]).toBe(PLAYER_HEIGHT);
    expect(segmentIntersectsRectXZ(-1, 2, 1, 2, 0, 0.4, 1.5, 2.5)).toBe(true);
    expect(segmentIntersectsRectXZ(-1, 1, 1, 1, 0, 0.4, 1.5, 2.5)).toBe(false);

    const blocker: Aabb = { min: [0, 0, 1.5], max: [1, 1, 2.5] };
    expect(blocksPlayerMove(blocker, -1, 2, 1, 2, 0, 0)).toBe(true);
    expect(blocksPlayerMove(blocker, -1, 1, 1, 1, 0, 0)).toBe(false);
  });

  it('respects height changes (stair-like feet height range)', () => {
    const blocker: Aabb = { min: [0, 1.5, 1], max: [1, 2.5, 3] };
    // 脚底 0 → 1：玩家 AABB 顶到 2.0，与 blocker 相交。
    expect(blocksPlayerMove(blocker, -1, 2, 1, 2, 0, 1)).toBe(true);
    // 脚底 2.6 以上：玩家 AABB 已高过 blocker。
    expect(blocksPlayerMove(blocker, -1, 2, 1, 2, 2.6, 2.8)).toBe(false);
  });
});

describe('swept mechanical blocking in vertical movement', () => {
  it('blocks a large step across a mechanical part (no tunneling)', () => {
    const blocker: Aabb = { min: [0.4, 0, 1.4], max: [0.6, 1, 2.6] };
    const world = createWorld((fromX, fromZ, toX, toZ, yMin, yMax) =>
      blocksPlayerMove(blocker, fromX, fromZ, toX, toZ, yMin, yMax));
    const result = resolveMove(groundState(-2, 2), 2, 2, world);
    expect(result.moved).toBe(false);
  });

  it('slides along a mechanical part edge with X-only movement', () => {
    const blocker: Aabb = { min: [0.4, 0, 2.3], max: [0.6, 1, 2.7] };
    const world = createWorld((fromX, fromZ, toX, toZ, yMin, yMax) =>
      blocksPlayerMove(blocker, fromX, fromZ, toX, toZ, yMin, yMax));
    const result = resolveWithSliding(groundState(-0.5, 1.5), 0.5, 2.5, world);
    expect(result.moved).toBe(true);
    if (!result.moved) return;
    expect(result.position[0]).toBeCloseTo(0.5, 9);
    expect(result.position[2]).toBeCloseTo(1.5, 9);
  });

  it('feeds changing stair heights into the blocking predicate', () => {
    const calls: { yMin: number; yMax: number }[] = [];
    const world = createWorld((_fromX, _fromZ, _toX, _toZ, yMin, yMax) => {
      calls.push({ yMin, yMax });
      return false;
    });
    const result = resolveMove(stairState(-3.9, 3.5), -3.4, 3.5, world);
    expect(result.moved).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.yMin).toBeCloseTo(0.375, 9);
    expect(calls[0]?.yMax).toBeCloseTo(0.75, 9);
  });

  it('does not disturb platform movement when no blocker is present', () => {
    const world = createWorld();
    const result = resolveMove(
      { x: 0.5, feetY: 3, z: 3.5, level: 1, supportId: PLATFORM_SUPPORT.id },
      0.7,
      3.5,
      world,
    );
    expect(result.moved).toBe(true);
  });
});