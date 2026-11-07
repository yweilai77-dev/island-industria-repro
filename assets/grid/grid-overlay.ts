import { CELL_SIZE, worldToCell, type Cell } from './grid.ts';
import { MAP_CONFIG } from '../world/map-config.ts';

/**
 * M0.4 网格可视化的纯数学部分（零引擎依赖，可单测）。
 *
 * M1.6：地面范围不再写死，全部由 assets/world/map-config.ts 派生。
 * 当前生产地图 32×32 米、X/Z ∈ [-16, 16)，可用格坐标 -16 … 15。
 */

/** 地面半边长（米，X 方向）。保留旧名作为兼容性派生别名。 */
export const BUILD_AREA_HALF_EXTENT = MAP_CONFIG.halfWidth;
/** 可用格坐标下限（含，X 方向）。 */
export const BUILD_AREA_MIN_CELL = MAP_CONFIG.minCellX;
/** 可用格坐标上限（含，X 方向）。 */
export const BUILD_AREA_MAX_CELL = MAP_CONFIG.maxCellX;
/** 网格线数量（X 方向）；Z 方向见 GRID_LINE_COUNT_Z。 */
export const GRID_LINE_COUNT_X = MAP_CONFIG.gridLineCountX;
export const GRID_LINE_COUNT_Z = MAP_CONFIG.gridLineCountZ;
/** 兼容旧名：旧调用方默认正方形地图。 */
export const GRID_LINE_COUNT = GRID_LINE_COUNT_X;
/** 网格线抬高量，避免与地面顶面 z-fighting；随 MapConfig 的地面高度移动。 */
export const GRID_LINE_Y = MAP_CONFIG.groundTopY + 0.01;
/** 高亮薄板中心高度（薄板高 0.02，顶面在 0.04）。 */
export const HIGHLIGHT_CENTER_Y = 0.03;
/** 高亮实体隐藏位置（引擎没有可见性组件，用移出视线代替）。 */
export const HIDDEN_POSITION_Y = -1000;

function pushVertex(out: number[], x: number, y: number, z: number): void {
  out.push(x, y, z);
}

/**
 * 生成覆盖指定半边的 line-list 网格顶点（非索引）。
 * 条数由半边长推导，而不是模块常量，避免“只改 half 不改条数”的错位。
 * 每条线 2 个端点；默认 32×32 地图 → 33+33 条线 → 132 顶点 / 396 float。
 */
export function buildGridLinePositions(
  y: number = GRID_LINE_Y,
  halfX: number = MAP_CONFIG.halfWidth,
  halfZ: number = MAP_CONFIG.halfDepth,
): Float32Array {
  if (!Number.isFinite(halfX) || !Number.isFinite(halfZ) || !(halfX > 0) || !(halfZ > 0)) {
    throw new RangeError(`grid half extents must be positive finite numbers, received (${halfX}, ${halfZ})`);
  }
  const countX = Math.round((halfX * 2) / CELL_SIZE) + 1;
  const countZ = Math.round((halfZ * 2) / CELL_SIZE) + 1;
  const out: number[] = [];
  for (let i = 0; i < countX; i += 1) {
    const coord = -halfX + i * CELL_SIZE;
    // 平行于 Z 轴的线
    pushVertex(out, coord, y, -halfZ);
    pushVertex(out, coord, y, halfZ);
  }
  for (let i = 0; i < countZ; i += 1) {
    const coord = -halfZ + i * CELL_SIZE;
    // 平行于 X 轴的线
    pushVertex(out, -halfX, y, coord);
    pushVertex(out, halfX, y, coord);
  }
  return new Float32Array(out);
}

/** 射线（Float32Array[ox,oy,oz,dx,dy,dz]，方向已归一化）与水平面求交。 */
export function intersectGroundPlane(
  ray: ArrayLike<number>,
  planeY = MAP_CONFIG.groundTopY,
): { x: number; z: number } | undefined {
  const originY = ray[1] as number;
  const directionY = ray[4] as number;
  // 与平面平行或朝上：没有有效交点
  if (!(directionY < -1e-6)) return undefined;
  const t = (planeY - originY) / directionY;
  if (!(t > 0)) return undefined;
  return {
    x: (ray[0] as number) + (ray[3] as number) * t,
    z: (ray[2] as number) + (ray[5] as number) * t,
  };
}

/** 格坐标是否在可建造地面范围内。 */
export function isBuildAreaCell(cell: Cell): boolean {
  return MAP_CONFIG.containsCell(cell);
}

/** 世界点 → 可建造格；超出地面范围返回 undefined。 */
export function buildAreaCellAt(worldX: number, worldZ: number): Cell | undefined {
  return MAP_CONFIG.buildAreaCellAt(worldX, worldZ);
}
