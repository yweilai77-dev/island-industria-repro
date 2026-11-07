import { worldToCell, type Cell } from '../grid/grid.ts';
import {
  isInsideStair,
  stairStepIndexAt,
  stairSurfaceStepTopY,
  stairWorldBounds,
} from '../spatial/structures.ts';
import type {
  SupportRegistry,
  SupportSurface,
  TraversalRegistry,
  TraversalSurface,
} from '../spatial/support.ts';
import type { Level } from '../spatial/space.ts';

/** 平面支撑面切换的最大高度差。 */
export const FLAT_SWITCH_TOLERANCE = 0.05;
/** 平面 ↔ 楼梯端边的最大高度差（低端第一级 0.375）。 */
export const STAIR_ENTRY_TOLERANCE = 0.45;
/** 楼梯内部单次移动的最大踏面高度变化保护。 */
export const STAIR_CONTINUOUS_TOLERANCE = 0.45;
const EPS = 1e-9;

export interface VerticalState {
  readonly x: number;
  readonly feetY: number;
  readonly z: number;
  readonly level: Level;
  readonly supportId: string | null;
}

export interface VerticalWorld {
  readonly supports: SupportRegistry;
  readonly traversals: TraversalRegistry;
  /**
   * 可选机械阻挡：从 (fromX,fromZ) 到 (toX,toZ)、脚底高度范围 [yMin,yMax]
   * 的移动是否被 blocksPlayer 结构挡住。不传时行为与 M1.5 完全一致。
   */
  readonly isBlockedMove?: (
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    yMin: number,
    yMax: number,
  ) => boolean;
}

export type VerticalMoveResult =
  | {
      readonly moved: true;
      readonly position: [number, number, number];
      readonly level: Level;
      readonly supportId: string;
      readonly cell: Cell;
    }
  | { readonly moved: false };

type StairEdge = 'low' | 'high' | 'side' | null;

/**
 * 确定性平面支撑选择：
 * 1. 过滤 active + walkable；
 * 2. 当前 supportId 且高度在容差内 → 优先；
 * 3. 只保留高度差在容差内；
 * 4. 高度差最小 → level 高者 → id 字典序最小。
 * 绝不依赖 supportsAtPoint 的 Set 注册顺序。
 */
export function selectFlatSupport(
  candidates: readonly SupportSurface[],
  currentSupportId: string | null,
  currentFeetY: number,
  tolerance: number,
): SupportSurface | undefined {
  const usable = candidates.filter((surface) => surface.active && surface.walkable);
  if (currentSupportId !== null) {
    const current = usable.find(
      (surface) => surface.id === currentSupportId
        && Math.abs(surface.worldY - currentFeetY) <= tolerance,
    );
    if (current) return current;
  }
  const viable = usable.filter(
    (surface) => Math.abs(surface.worldY - currentFeetY) <= tolerance,
  );
  if (viable.length === 0) return undefined;
  return [...viable].sort(compareSupports(currentFeetY))[0];
}

function compareSupports(feetY: number): (a: SupportSurface, b: SupportSurface) => number {
  return (a, b) => {
    const dyA = Math.abs(a.worldY - feetY);
    const dyB = Math.abs(b.worldY - feetY);
    if (Math.abs(dyA - dyB) > EPS) return dyA - dyB;
    if (a.level !== b.level) return b.level - a.level;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  };
}

function currentTraversal(state: VerticalState, world: VerticalWorld): TraversalSurface | undefined {
  if (state.supportId === null) return undefined;
  const traversal = world.traversals.get(state.supportId);
  if (!traversal) return undefined;
  return isInsideStair(state.x, state.z, traversal) ? traversal : undefined;
}

function currentFlatSupport(state: VerticalState, world: VerticalWorld): SupportSurface | undefined {
  if (state.supportId !== null) {
    const surface = world.supports.get(state.supportId);
    if (surface) return surface;
  }
  return selectFlatSupport(
    world.supports.supportsAtPoint(state.x, state.z),
    null,
    state.feetY,
    FLAT_SWITCH_TOLERANCE,
  );
}

function candidateTraversal(
  x: number,
  z: number,
  world: VerticalWorld,
): TraversalSurface | undefined {
  const matches = world.traversals.all().filter(
    (surface) => surface.walkable && isInsideStair(x, z, surface),
  );
  if (matches.length === 0) return undefined;
  // 多楼梯重叠不是 C 的地图情况；block 而不是依赖注册顺序。
  if (matches.length > 1) return undefined;
  return matches[0];
}

function sideWithin(value: number, sideMin: number, sideMax: number): boolean {
  return value >= sideMin && value < sideMax;
}

/** 判定当前在外部、候选进入楼梯时跨越的是哪条边。 */
function entryEdge(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  surface: TraversalSurface,
): StairEdge {
  if (isInsideStair(fromX, fromZ, surface)) return null;
  if (!isInsideStair(toX, toZ, surface)) return null;
  const b = stairWorldBounds(surface);
  const longIsX = surface.direction === 'east' || surface.direction === 'west';
  if (longIsX) {
    const fromSide = sideWithin(fromZ, b.minZ, b.maxZ);
    const toSide = sideWithin(toZ, b.minZ, b.maxZ);
    if (!fromSide || !toSide) return 'side';
    if (surface.direction === 'east') {
      if (fromX < b.minX && toX >= b.minX) return 'low';
      if (fromX >= b.maxX && toX < b.maxX) return 'high';
    } else {
      if (fromX >= b.maxX && toX < b.maxX) return 'low';
      if (fromX < b.minX && toX >= b.minX) return 'high';
    }
    return 'side';
  }
  const fromSide = sideWithin(fromX, b.minX, b.maxX);
  const toSide = sideWithin(toX, b.minX, b.maxX);
  if (!fromSide || !toSide) return 'side';
  if (surface.direction === 'south') {
    if (fromZ < b.minZ && toZ >= b.minZ) return 'low';
    if (fromZ >= b.maxZ && toZ < b.maxZ) return 'high';
  } else {
    if (fromZ >= b.maxZ && toZ < b.maxZ) return 'low';
    if (fromZ < b.minZ && toZ >= b.minZ) return 'high';
  }
  return 'side';
}

/** 判定当前在楼梯内、候选离开时跨越的是哪条边。 */
function exitEdge(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  surface: TraversalSurface,
): StairEdge {
  if (!isInsideStair(fromX, fromZ, surface)) return null;
  if (isInsideStair(toX, toZ, surface)) return null;
  const b = stairWorldBounds(surface);
  const longIsX = surface.direction === 'east' || surface.direction === 'west';
  if (longIsX) {
    if (!sideWithin(toZ, b.minZ, b.maxZ)) return 'side';
    if (surface.direction === 'east') {
      if (toX < b.minX) return 'low';
      if (toX >= b.maxX) return 'high';
    } else {
      if (toX >= b.maxX) return 'low';
      if (toX < b.minX) return 'high';
    }
    return 'side';
  }
  if (!sideWithin(toX, b.minX, b.maxX)) return 'side';
  if (surface.direction === 'south') {
    if (toZ < b.minZ) return 'low';
    if (toZ >= b.maxZ) return 'high';
  } else {
    if (toZ >= b.maxZ) return 'low';
    if (toZ < b.minZ) return 'high';
  }
  return 'side';
}

function finish(
  current: VerticalState,
  x: number,
  feetY: number,
  z: number,
  level: Level,
  supportId: string,
  world: VerticalWorld,
): VerticalMoveResult {
  if (world.isBlockedMove) {
    const yMin = Math.min(current.feetY, feetY);
    const yMax = Math.max(current.feetY, feetY);
    if (world.isBlockedMove(current.x, current.z, x, z, yMin, yMax)) {
      return { moved: false };
    }
  }
  const stair = world.traversals.get(supportId);
  if (stair) {
    const index = stairStepIndexAt(x, z, stair);
    if (index === undefined) return { moved: false };
    const expected = stairSurfaceStepTopY(stair, index);
    if (Math.abs(expected - feetY) > EPS) return { moved: false };
    return {
      moved: true,
      position: [x, feetY, z],
      level,
      supportId,
      cell: worldToCell(x, z),
    };
  }
  const flat = world.supports.get(supportId);
  if (!flat || !flat.active || !flat.walkable) return { moved: false };
  if (Math.abs(flat.worldY - feetY) > EPS) return { moved: false };
  if (level !== flat.level) return { moved: false };
  const atPoint = world.supports.supportsAtPoint(x, z).some((surface) => surface.id === supportId);
  if (!atPoint) return { moved: false };
  return {
    moved: true,
    position: [x, feetY, z],
    level,
    supportId,
    cell: worldToCell(x, z),
  };
}

/**
 * 单次完整移动解析（无轴向滑动）。失败返回 moved:false，不修改 current。
 */
export function resolveMove(
  current: VerticalState,
  nextX: number,
  nextZ: number,
  world: VerticalWorld,
): VerticalMoveResult {
  if (!Number.isFinite(nextX) || !Number.isFinite(nextZ)) return { moved: false };
  const stair = currentTraversal(current, world);
  if (stair) {
    const nextStair = candidateTraversal(nextX, nextZ, world);
    if (nextStair) {
      if (nextStair.id !== stair.id) return { moved: false };
      const index = stairStepIndexAt(nextX, nextZ, stair);
      if (index === undefined) return { moved: false };
      const top = stairSurfaceStepTopY(stair, index);
      if (Math.abs(top - current.feetY) > STAIR_CONTINUOUS_TOLERANCE) return { moved: false };
      return finish(current, nextX, top, nextZ, current.level, stair.id, world);
    }
    const edge = exitEdge(current.x, current.z, nextX, nextZ, stair);
    if (edge !== 'low' && edge !== 'high') return { moved: false };
    const boundaryTop = stairSurfaceStepTopY(stair, edge === 'low' ? 0 : stair.stepCount - 1);
    const target = selectFlatSupport(
      world.supports.supportsAtPoint(nextX, nextZ),
      current.supportId,
      boundaryTop,
      STAIR_ENTRY_TOLERANCE,
    );
    if (!target) return { moved: false };
    return finish(current, nextX, target.worldY, nextZ, target.level, target.id, world);
  }

  const flat = currentFlatSupport(current, world);
  if (!flat) return { moved: false };
  const nextStair = candidateTraversal(nextX, nextZ, world);
  if (nextStair) {
    // 已经在楼梯 footprint 内的平面状态（异常/楼梯下方）不能直接吸附到楼梯。
    if (isInsideStair(current.x, current.z, nextStair)) return { moved: false };
    const edge = entryEdge(current.x, current.z, nextX, nextZ, nextStair);
    if (edge !== 'low' && edge !== 'high') return { moved: false };
    const index = stairStepIndexAt(nextX, nextZ, nextStair);
    if (index === undefined) return { moved: false };
    const top = stairSurfaceStepTopY(nextStair, index);
    if (Math.abs(top - current.feetY) > STAIR_ENTRY_TOLERANCE) return { moved: false };
    return finish(current, nextX, top, nextZ, current.level, nextStair.id, world);
  }

  const target = selectFlatSupport(
    world.supports.supportsAtPoint(nextX, nextZ),
    current.supportId,
    current.feetY,
    FLAT_SWITCH_TOLERANCE,
  );
  if (!target) return { moved: false };
  return finish(current, nextX, target.worldY, nextZ, target.level, target.id, world);
}

/**
 * 完整移动尝试顺序：full → X-only → Z-only。
 * 每次尝试都从 original 重新调用 resolveMove，不复用任何中间高度/支撑结果。
 */
export function resolveWithSliding(
  current: VerticalState,
  nextX: number,
  nextZ: number,
  world: VerticalWorld,
): VerticalMoveResult {
  const full = resolveMove(current, nextX, nextZ, world);
  if (full.moved) return full;
  const xOnly = resolveMove(current, nextX, current.z, world);
  if (xOnly.moved) return xOnly;
  return resolveMove(current, current.x, nextZ, world);
}