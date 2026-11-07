import { worldToCell, type Cell } from './grid.ts';

/**
 * M0.4 网格可视化的纯数学部分（零引擎依赖，可单测）。
 *
 * 地面范围与 assets/world/scene.pack.ts 保持一致：20×20 米、X/Z ∈ [-10, 10]，
 * 因此可用格坐标是 -10 … 9（每格 1 米）。
 */

/** 地面半边长（米）。 */
export const BUILD_AREA_HALF_EXTENT = 10;
/** 可用格坐标下限（含）。 */
export const BUILD_AREA_MIN_CELL = -10;
/** 可用格坐标上限（含）。 */
export const BUILD_AREA_MAX_CELL = 9;
/** 网格线数量：-10 … 10 共 21 条/方向。 */
export const GRID_LINE_COUNT = 21;
/** 网格线抬高量，避免与地面顶面 z-fighting。 */
export const GRID_LINE_Y = 0.01;
/** 高亮薄板中心高度（薄板高 0.02，顶面在 0.04）。 */
export const HIGHLIGHT_CENTER_Y = 0.03;
/** 高亮实体隐藏位置（引擎没有可见性组件，用移出视线代替）。 */
export const HIDDEN_POSITION_Y = -1000;

function pushVertex(out: number[], x: number, y: number, z: number): void {
  out.push(x, y, z);
}

/**
 * 生成 20×20 网格的 line-list 顶点（非索引）。
 * 每个方向 21 条线，每条 2 个端点 → 84 个顶点 → 252 个 float。
 */
export function buildGridLinePositions(
  y: number = GRID_LINE_Y,
  halfExtent: number = BUILD_AREA_HALF_EXTENT,
): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < GRID_LINE_COUNT; i += 1) {
    const coord = -halfExtent + i;
    // 平行于 Z 轴的线
    pushVertex(out, coord, y, -halfExtent);
    pushVertex(out, coord, y, halfExtent);
    // 平行于 X 轴的线
    pushVertex(out, -halfExtent, y, coord);
    pushVertex(out, halfExtent, y, coord);
  }
  return new Float32Array(out);
}

/** 射线（Float32Array[ox,oy,oz,dx,dy,dz]，方向已归一化）与水平面求交。 */
export function intersectGroundPlane(
  ray: ArrayLike<number>,
  planeY = 0,
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
  return cell.gx >= BUILD_AREA_MIN_CELL
    && cell.gx <= BUILD_AREA_MAX_CELL
    && cell.gz >= BUILD_AREA_MIN_CELL
    && cell.gz <= BUILD_AREA_MAX_CELL;
}

/** 世界点 → 可建造格；超出地面范围返回 undefined。 */
export function buildAreaCellAt(worldX: number, worldZ: number): Cell | undefined {
  const cell = worldToCell(worldX, worldZ);
  return isBuildAreaCell(cell) ? cell : undefined;
}
