import type { Cell, Placement } from '../grid/grid.ts';

/**
 * M1.5 三维空间基础：层高、Level 校验、世界 Y 映射与 AABB 工具。
 * 纯逻辑、零引擎依赖。
 *
 * 坐标约定：
 * - 世界右手系，+Y 向上；标准层高 3.0m。
 * - level 是离散逻辑层（有限非负整数），不等于任意世界 Y。
 * - 地面基准 GRID_PLANE_Y = 0；level 0 的 baseY = 0，level 1 的 baseY = 3。
 */

export const STANDARD_LEVEL_HEIGHT = 3.0;
export const SPATIAL_EPS = 1e-6;

/** 逻辑楼层：有限、非负整数；不设楼层数量上限。 */
export type Level = number;

/** 一个三维轴对齐包围盒（世界坐标）。 */
export interface Aabb {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** 校验 Level；非法值直接抛出 RangeError。 */
export function assertValidLevel(value: unknown): asserts value is Level {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new RangeError(`level must be a finite non-negative integer, received ${String(value)}`);
  }
}

/**
 * 旧数据兼容策略：缺失 level（undefined/null）按 level 0 处理；
 * 一旦显式传入值，则必须通过 assertValidLevel。
 * 这是唯一允许的“缺失高度”兼容路径，不生成不可预测状态。
 */
export function normalizeLevel(value: number | undefined | null): Level {
  if (value === undefined || value === null) return 0;
  assertValidLevel(value);
  return value;
}

/** 由逻辑层得到世界底部高度：level * 3.0。 */
export function levelBaseY(level: Level | undefined): number {
  return normalizeLevel(level) * STANDARD_LEVEL_HEIGHT;
}

/** 世界 Y → 逻辑层（标准层高）；负高度或非有限值拒绝。 */
export function worldYToLevel(y: number): Level {
  if (!Number.isFinite(y) || y < 0) {
    throw new RangeError(`world Y must be a finite non-negative number, received ${y}`);
  }
  return Math.floor(y / STANDARD_LEVEL_HEIGHT);
}

/** 三维格键：gx,gz,level。 */
export function cellKey3(cell: Cell, level: Level | undefined): string {
  return `${cell.gx},${cell.gz},${normalizeLevel(level)}`;
}

/** Placement 的底部世界高度（兼容缺失 level 的旧数据，默认 0）。 */
export function placementBaseY(placement: Placement | { level?: number }): number {
  return levelBaseY((placement as { level?: number }).level);
}

/**
 * 建筑垂直范围覆盖了哪些“楼层 slab”。
 * slab 定义为 [levelBaseY(l), levelBaseY(l)+3.0)；只有真正正长度重叠的层才返回。
 * 用于宽相位空间索引；最终碰撞仍由 AABB 决定。
 */
export function levelsForSpan(baseY: number, height: number): Level[] {
  if (!Number.isFinite(baseY) || baseY < 0) {
    throw new RangeError(`baseY must be finite and non-negative, received ${baseY}`);
  }
  if (!Number.isFinite(height) || height < 0) {
    throw new RangeError(`height must be finite and non-negative, received ${height}`);
  }
  if (height === 0) return [];
  const first = Math.floor((baseY + SPATIAL_EPS) / STANDARD_LEVEL_HEIGHT);
  const last = Math.floor((baseY + height - SPATIAL_EPS) / STANDARD_LEVEL_HEIGHT);
  if (last < first) return [];
  const levels: Level[] = [];
  for (let level = first; level <= last; level += 1) levels.push(level);
  return levels;
}

/** 由 Placement + 建筑高度得到世界 AABB。 */
export function placementAabb(placement: Placement, height: number): Aabb {
  const baseY = placementBaseY(placement);
  if (!Number.isFinite(height) || height <= 0) {
    throw new RangeError(`height must be positive, received ${height}`);
  }
  const w = placement.rotation % 180 === 0 ? placement.w : placement.d;
  const d = placement.rotation % 180 === 0 ? placement.d : placement.w;
  return {
    min: [placement.gx, baseY, placement.gz],
    max: [placement.gx + w, baseY + height, placement.gz + d],
  };
}

/** 三个轴都真正相交才算碰撞；边界贴合不算。 */
export function aabbIntersects(a: Aabb, b: Aabb): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    const aMin = a.min[axis] as number;
    const aMax = a.max[axis] as number;
    const bMin = b.min[axis] as number;
    const bMax = b.max[axis] as number;
    if (!(aMin < bMax - SPATIAL_EPS && aMax > bMin + SPATIAL_EPS)) return false;
  }
  return true;
}

/** 取 AABB 在水平网格上覆盖的所有整数格。 */
export function cellsInAabb2D(aabb: Aabb): Cell[] {
  const cells: Cell[] = [];
  const minX = Math.floor(aabb.min[0] as number);
  const maxX = Math.ceil(aabb.max[0] as number) - 1;
  const minZ = Math.floor(aabb.min[2] as number);
  const maxZ = Math.ceil(aabb.max[2] as number) - 1;
  for (let gz = minZ; gz <= maxZ; gz += 1) {
    for (let gx = minX; gx <= maxX; gx += 1) cells.push({ gx, gz });
  }
  return cells;
}
