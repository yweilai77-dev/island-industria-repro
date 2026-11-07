/**
 * ISLAND INDUSTRIA 建造网格内核（M0.3）。
 *
 * 纯数学模块：零引擎依赖、零副作用、无 ECS / 渲染 / 输入。
 * 后续 M0.4（占地表、预览、放置）与 M0.5（机械端口、传送带）共用这里的坐标约定。
 *
 * 坐标约定：
 * - 世界为右手系、+Y 朝上；建造平面在 y = GRID_PLANE_Y。
 * - 1 格 = CELL_SIZE 米；格 (gx, gz) 覆盖世界 X ∈ [gx, gx+1) × Z ∈ [gz, gz+1)。
 * - 锚点是「世界轴上的最小角」，永远是整数格坐标，底层数据不出现浮点数。
 * - w/d 是物体的「本地足迹」（未旋转），rotation 单独保存；世界轴占用由派生得到。
 * - rotation 为俯视顺时针（从 +Y 向下看），取值 0 / 90 / 180 / 270。
 */

import { levelBaseY, normalizeLevel } from '../spatial/space.ts';

/** 每格的边长（米）。 */
export const CELL_SIZE = 1;

/** 建造平面高度（当前地面顶面）。 */
export const GRID_PLANE_Y = 0;

/** 逻辑楼层：有限、非负整数；不设楼层数量上限。 */
export type { Level } from '../spatial/space.ts';

/** 俯视顺时针的旋转方向（度）。 */
export type Rotation = 0 | 90 | 180 | 270;

/** 整数格坐标。 */
export interface Cell {
  readonly gx: number;
  readonly gz: number;
}

/** 本地足迹（未旋转）的格数，必须为正整数。 */
export interface Footprint {
  readonly w: number;
  readonly d: number;
}

/** 世界轴上的足迹（旋转后）：仅用于渲染/包围盒，不存储。 */
export interface WorldExtent {
  readonly w: number;
  readonly d: number;
}

/** 世界轴上的格子范围（格坐标，半开区间）。 */
export interface CellBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * 一次放置的权威数据：
 * - gx/gz：整数锚点（世界最小角）
 * - w/d：本地足迹（端口、朝向定义在此坐标系）
 * - rotation：旋转方向
 */
export interface Placement extends Cell, Footprint {
  /** 逻辑楼层；世界底部高度 = levelBaseY(level)。 */
  readonly level: number;
  readonly rotation: Rotation;
}

function assertIntegerCell(gx: number, gz: number): void {
  if (!Number.isInteger(gx) || !Number.isInteger(gz)) {
    throw new RangeError(`grid cell must be integer, received (${gx}, ${gz})`);
  }
}

function assertFootprint(w: number, d: number): void {
  if (!Number.isInteger(w) || !Number.isInteger(d) || w < 1 || d < 1) {
    throw new RangeError(`footprint must be positive integers, received (${w}, ${d})`);
  }
}

/** 判断一个数字是否是合法旋转值。 */
export function isRotation(value: number): value is Rotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/** 把任意 90 的倍数规范到 0/90/180/270；不是 90 的倍数则报错。 */
export function normalizeRotation(degrees: number): Rotation {
  if (!Number.isFinite(degrees) || degrees % 90 !== 0) {
    throw new RangeError(`rotation must be a multiple of 90, received ${degrees}`);
  }
  return (((degrees % 360) + 360) % 360) as Rotation;
}

/** 世界坐标 → 格坐标（向下取整，负坐标同样正确，半开区间）。 */
export function worldToCell(worldX: number, worldZ: number): Cell {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
    throw new RangeError(`world position must be finite, received (${worldX}, ${worldZ})`);
  }
  return {
    gx: Math.floor(worldX / CELL_SIZE),
    gz: Math.floor(worldZ / CELL_SIZE),
  };
}

/** 格坐标 → 世界最小角。 */
export function cellToMinCorner(cell: Cell): [number, number, number] {
  assertIntegerCell(cell.gx, cell.gz);
  return [cell.gx * CELL_SIZE, GRID_PLANE_Y, cell.gz * CELL_SIZE];
}

/** 格坐标 → 世界格中心（x、z 落在半格处）。 */
export function cellToCenter(cell: Cell): [number, number, number] {
  assertIntegerCell(cell.gx, cell.gz);
  return [
    (cell.gx + 0.5) * CELL_SIZE,
    GRID_PLANE_Y,
    (cell.gz + 0.5) * CELL_SIZE,
  ];
}

/** 占用表用的稳定字符串键。 */
export function cellKey(cell: Cell): string {
  assertIntegerCell(cell.gx, cell.gz);
  return `${cell.gx},${cell.gz}`;
}

/** 本地足迹经过旋转后的世界轴足迹（90/270 交换宽深）。 */
export function worldExtent(placement: Placement): WorldExtent {
  assertFootprint(placement.w, placement.d);
  return placement.rotation % 180 === 0
    ? { w: placement.w, d: placement.d }
    : { w: placement.d, d: placement.w };
}

/** 世界轴占地范围（格坐标，半开区间）。 */
export function placementBounds(placement: Placement): CellBounds {
  assertIntegerCell(placement.gx, placement.gz);
  const extent = worldExtent(placement);
  return {
    minX: placement.gx,
    maxX: placement.gx + extent.w,
    minZ: placement.gz,
    maxZ: placement.gz + extent.d,
  };
}

/** 派生渲染中心：偶数尺寸会落在格线上，奇数尺寸落在格心；不存储。 */
export function placementCenter(placement: Placement): [number, number, number] {
  assertIntegerCell(placement.gx, placement.gz);
  const extent = worldExtent(placement);
  return [
    (placement.gx + extent.w / 2) * CELL_SIZE,
    levelBaseY((placement as { level?: number }).level),
    (placement.gz + extent.d / 2) * CELL_SIZE,
  ];
}

/** 枚举世界轴上的占地格（顺序：先 gz 后 gx，即按行）。 */
export function cellsOf(placement: Placement): Cell[] {
  const bounds = placementBounds(placement);
  const cells: Cell[] = [];
  for (let gz = bounds.minZ; gz < bounds.maxZ; gz += 1) {
    for (let gx = bounds.minX; gx < bounds.maxX; gx += 1) {
      cells.push({ gx, gz });
    }
  }
  return cells;
}

/** 构造 Placement，并对整数格、足迹、旋转做校验。 */
export function createPlacement(
  gx: number,
  gz: number,
  w: number,
  d: number,
  rotation: Rotation = 0,
  level: number = 0,
): Placement {
  assertIntegerCell(gx, gz);
  assertFootprint(w, d);
  if (!isRotation(rotation)) {
    throw new RangeError(`rotation must be 0/90/180/270, received ${rotation}`);
  }
  return { gx, gz, level: normalizeLevel(level), w, d, rotation };
}

/** 旋转 delta 度（必须为 90 的倍数）：锚点与本地足迹不变，只改方向。 */
export function rotatePlacement(placement: Placement, deltaDegrees: number): Placement {
  return {
    ...placement,
    rotation: normalizeRotation(placement.rotation + deltaDegrees),
  };
}

/** 设置绝对旋转方向。 */
export function withRotation(placement: Placement, rotation: Rotation): Placement {
  if (!isRotation(rotation)) {
    throw new RangeError(`rotation must be 0/90/180/270, received ${rotation}`);
  }
  return { ...placement, rotation };
}

/** 判断格是否位于给定范围内（半开区间）。 */
export function isCellInside(cell: Cell, bounds: CellBounds): boolean {
  assertIntegerCell(cell.gx, cell.gz);
  return cell.gx >= bounds.minX && cell.gx < bounds.maxX
    && cell.gz >= bounds.minZ && cell.gz < bounds.maxZ;
}