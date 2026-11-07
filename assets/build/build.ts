import {
  cellsOf,
  type Cell,
  type Placement,
} from '../grid/grid.ts';
import { isBuildAreaCell } from '../grid/grid-overlay.ts';
import type { SpatialIndex } from '../spatial/occupancy.ts';
import {
  normalizeLevel,
  placementAabb,
  placementBaseY,
  type Aabb,
  type Level,
} from '../spatial/space.ts';
import type { SupportRegistry } from '../spatial/support.ts';

/**
 * M1.5 建造纯逻辑：建筑类型、三维合法性、AABB 选中。
 * 零引擎依赖，可单测。
 */

/** 默认建筑高度（米）；实际高度由 BuildingType.height 决定。 */
export const BUILDING_HEIGHT = 1;
/** 地面玩法中玩家身体高度的保守值（用于建造位置与玩家占用检查）。 */
export const PLAYER_BODY_HEIGHT = 1;

export interface BuildingType {
  readonly id: string;
  /** 显示用短标签（1×1 / 2×2 / 2×3）。 */
  readonly label: string;
  readonly w: number;
  readonly d: number;
  /** 建筑实际高度（米），决定三维 AABB 与垂直占用跨度。 */
  readonly height: number;
  /** 线性 RGBA 主体色。 */
  readonly color: readonly [number, number, number, number];
}

/** 三种测试建筑；2×3 用于验证旋转后占地交换。 */
export const BUILDING_TYPES: readonly BuildingType[] = [
  { id: 'shed', label: '1x1', w: 1, d: 1, height: BUILDING_HEIGHT, color: [0.25, 0.45, 0.8, 1] },
  { id: 'block', label: '2x2', w: 2, d: 2, height: BUILDING_HEIGHT, color: [0.16, 0.55, 0.45, 1] },
  { id: 'hall', label: '2x3', w: 2, d: 3, height: BUILDING_HEIGHT, color: [0.62, 0.28, 0.55, 1] },
];

export type PlacementFailure =
  | 'out-of-bounds'
  | 'occupied'
  | 'player-cell'
  | 'resource-cell'
  | 'unsupported'
  | 'reserved';

export interface PlacementVerdict {
  readonly ok: boolean;
  readonly reason?: PlacementFailure;
  readonly blockingIds?: readonly number[];
}

/** 三维合法性检查所需的运行时上下文。 */
export interface PlacementContext {
  readonly spatial: SpatialIndex;
  readonly supports: SupportRegistry;
  readonly playerCell?: Cell;
  readonly playerFeetY?: number;
  readonly playerHeight?: number;
  readonly isCellBlocked?: (cell: Cell, level: Level) => boolean;
  readonly isReserved?: (cell: Cell, level: Level) => boolean;
  readonly excludeBuildingId?: number;
}

/**
 * 放置合法性：
 * 1) 每个占地格在建造区内；
 * 2) 每个占地格在目标 level 上有同高、可建造的支撑面；
 * 3) 三维空间索引候选 + AABB 精确碰撞（building 与 structure 统一）；
 * 4) 建造位置不得与玩家当前三维身体体积相交（这是建造检查，不是玩家碰撞）；
 * 5) 资源节点与结构保留区。
 */
export function validatePlacement(
  placement: Placement,
  height: number = BUILDING_HEIGHT,
  context: PlacementContext,
): PlacementVerdict {
  if (!Number.isFinite(height) || height <= 0) {
    throw new RangeError(`building height must be positive, received ${height}`);
  }
  const level = normalizeLevel((placement as { level?: number }).level);
  const baseY = placementBaseY(placement);

  for (const cell of cellsOf(placement)) {
    if (!isBuildAreaCell(cell)) return { ok: false, reason: 'out-of-bounds' };
    if (!context.supports.buildableSupportAt(cell, level, baseY)) {
      return { ok: false, reason: 'unsupported' };
    }
    if (context.isCellBlocked?.(cell, level)) return { ok: false, reason: 'resource-cell' };
    if (context.isReserved?.(cell, level)) return { ok: false, reason: 'reserved' };
  }

  if (context.playerCell !== undefined) {
    const playerFeetY = context.playerFeetY ?? 0;
    const playerHeight = context.playerHeight ?? PLAYER_BODY_HEIGHT;
    const candidate = placementAabb(placement, height);
    const sharesCell = cellsOf(placement).some(
      (cell) => cell.gx === context.playerCell?.gx && cell.gz === context.playerCell?.gz,
    );
    if (sharesCell) {
      const playerTop = playerFeetY + playerHeight;
      const yOverlaps = candidate.min[1] < playerTop && candidate.max[1] > playerFeetY;
      if (yOverlaps) return { ok: false, reason: 'player-cell' };
    }
  }

  const overlaps = context.spatial.overlapsPlacement(placement, height, context.excludeBuildingId);
  if (overlaps.length > 0) {
    const blockingIds = overlaps
      .map((overlap) => overlap.buildingId)
      .filter((id): id is number => id !== undefined);
    return { ok: false, reason: 'occupied', blockingIds };
  }

  return { ok: true };
}

/** 建筑的世界轴三维包围盒（用于射线选中）。 */
export function buildingAabb(placement: Placement, height: number = BUILDING_HEIGHT): Aabb {
  return placementAabb(placement, height);
}

/**
 * 射线与轴对齐包围盒求交（slab 法），返回最近正向命中距离 t；未命中返回 undefined。
 * ray 布局：[ox, oy, oz, dx, dy, dz]，方向已归一化。
 */
export function rayAabbDistance(
  ray: ArrayLike<number>,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): number | undefined {
  let tMin = -Infinity;
  let tMax = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const origin = ray[axis] as number;
    const direction = ray[3 + axis] as number;
    const low = min[axis] as number;
    const high = max[axis] as number;
    if (Math.abs(direction) < 1e-9) {
      if (origin < low || origin > high) return undefined;
      continue;
    }
    let t1 = (low - origin) / direction;
    let t2 = (high - origin) / direction;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return undefined;
  }
  if (tMax < 0) return undefined;
  return tMin >= 0 ? tMin : 0;
}
