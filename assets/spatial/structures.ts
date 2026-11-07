import { CELL_SIZE, type Cell } from '../grid/grid.ts';
import type { StructureCollider } from './structure.ts';
import type { SupportSurface, TraversalSurface } from './support.ts';
import type { Aabb } from './space.ts';

/**
 * M1.5-B 固定世界结构数据（唯一权威定义）。
 * 平台/楼梯的支撑面、实体 AABB、视觉几何与未来楼梯高度计算都从这里派生，
 * 不在视觉插件与移动逻辑中各写一套硬编码。
 */

// ---------------- 固定平台 ----------------
export const PLATFORM_LEVEL = 1;
export const PLATFORM_WORLD_Y = 3.0;
export const PLATFORM_MIN_GX = 0;
export const PLATFORM_MAX_GX = 7;
export const PLATFORM_MIN_GZ = 2;
export const PLATFORM_MAX_GZ = 7;

export const PLATFORM_CELLS: readonly Cell[] = (() => {
  const cells: Cell[] = [];
  for (let gz = PLATFORM_MIN_GZ; gz <= PLATFORM_MAX_GZ; gz += 1) {
    for (let gx = PLATFORM_MIN_GX; gx <= PLATFORM_MAX_GX; gx += 1) cells.push({ gx, gz });
  }
  return cells;
})();

export const PLATFORM_SUPPORT: SupportSurface = {
  id: 'support:platform',
  level: PLATFORM_LEVEL,
  worldY: PLATFORM_WORLD_Y,
  cells: PLATFORM_CELLS,
  kind: 'platform',
  buildable: true,
  walkable: true,
  active: true,
};

export const PLATFORM_AABB: Aabb = {
  min: [PLATFORM_MIN_GX, 2.7, PLATFORM_MIN_GZ],
  max: [PLATFORM_MAX_GX + 1, PLATFORM_WORLD_Y, PLATFORM_MAX_GZ + 1],
};

export const PLATFORM_COLLIDER: StructureCollider = {
  id: 'structure:platform',
  aabb: PLATFORM_AABB,
  blocksBuild: true,
  blocksPlayer: false,
};

// ---------------- 固定楼梯 ----------------
export type StairDirection = 'north' | 'east' | 'south' | 'west';

export interface StairDefinition {
  readonly id: string;
  readonly originCell: Cell;
  readonly direction: StairDirection;
  readonly levelLow: number;
  readonly levelHigh: number;
  readonly worldYLow: number;
  readonly worldYHigh: number;
  readonly runLengthCells: number;
  readonly widthCells: number;
  /** 台阶数：视觉台阶和未来 M1.5-C 高度计算共用。 */
  readonly stepCount: number;
  /** 每级水平长度（米）。 */
  readonly stepRun: number;
  /** 每级垂直高度（米）。 */
  readonly stepRise: number;
  readonly cells: readonly Cell[];
  readonly aabb: Aabb;
}

export const MAIN_STAIRS: StairDefinition = (() => {
  const originCell: Cell = { gx: -4, gz: 3 };
  const runLengthCells = 4;
  const widthCells = 1;
  const stepCount = 8;
  const stepRun = 0.5;
  const stepRise = 0.375;
  const cells: Cell[] = [];
  for (let index = 0; index < runLengthCells; index += 1) {
    cells.push({ gx: originCell.gx + index, gz: originCell.gz });
  }
  // 楼梯保守实体 AABB：低端 x=-4，高端 x=0，z [3,4)，y [0,3]。
  const aabb: Aabb = {
    min: [originCell.gx, 0, originCell.gz],
    max: [originCell.gx + runLengthCells, 3, originCell.gz + widthCells],
  };
  return {
    id: 'traversal:main-stairs',
    originCell,
    direction: 'east',
    levelLow: 0,
    levelHigh: 1,
    worldYLow: 0,
    worldYHigh: 3,
    runLengthCells,
    widthCells,
    stepCount,
    stepRun,
    stepRise,
    cells,
    aabb,
  };
})();

/** 由同一定义生成 TraversalSurface；未来 C 的高度计算从这里读取 step 数据。 */
export function stairsTraversal(definition: StairDefinition = MAIN_STAIRS): TraversalSurface {
  return {
    id: definition.id,
    levelLow: definition.levelLow,
    levelHigh: definition.levelHigh,
    worldYLow: definition.worldYLow,
    worldYHigh: definition.worldYHigh,
    originCell: definition.originCell,
    direction: definition.direction,
    runLengthCells: definition.runLengthCells,
    widthCells: definition.widthCells,
    stepCount: definition.stepCount,
    stepRun: definition.stepRun,
    stepRise: definition.stepRise,
    cells: definition.cells,
    walkable: true,
  };
}

export const STAIRS_TRAVERSAL: TraversalSurface = stairsTraversal(MAIN_STAIRS);

export const STAIRS_COLLIDER: StructureCollider = {
  id: 'structure:main-stairs',
  aabb: MAIN_STAIRS.aabb,
  blocksBuild: true,
  blocksPlayer: false,
};

/** 第 index 级（0-based）台阶顶面世界高度；视觉与未来移动共用的派生函数。 */
export function stairStepTopY(index: number, definition: StairDefinition = MAIN_STAIRS): number {
  if (!Number.isInteger(index) || index < 0 || index >= definition.stepCount) {
    throw new RangeError(`stair step index out of range: ${index}`);
  }
  return definition.worldYLow + (index + 1) * definition.stepRise;
}

/** 第 index 级台阶中心 X/Z（east 方向）；视觉插件使用。 */
export function stairStepCenter(
  index: number,
  definition: StairDefinition = MAIN_STAIRS,
): { x: number; z: number; topY: number } {
  if (!Number.isInteger(index) || index < 0 || index >= definition.stepCount) {
    throw new RangeError(`stair step index out of range: ${index}`);
  }
  if (definition.direction !== 'east') {
    throw new Error('visual stair placement currently supports east direction only');
  }
  return {
    x: definition.originCell.gx * CELL_SIZE + (index + 0.5) * definition.stepRun,
    z: definition.originCell.gz * CELL_SIZE + (definition.widthCells * CELL_SIZE) / 2,
    topY: stairStepTopY(index, definition),
  };
}

/** 楼梯世界矩形（与视觉台阶/占用格一致）。 */
export function stairWorldBounds(surface: TraversalSurface): {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
} {
  const minX = surface.originCell.gx * CELL_SIZE;
  const minZ = surface.originCell.gz * CELL_SIZE;
  const longCells = surface.runLengthCells;
  const widthCells = surface.widthCells;
  if (surface.direction === 'east') {
    return { minX, maxX: minX + longCells * CELL_SIZE, minZ, maxZ: minZ + widthCells * CELL_SIZE };
  }
  if (surface.direction === 'west') {
    return { minX: minX - (longCells - 1) * CELL_SIZE, maxX: minX + CELL_SIZE, minZ, maxZ: minZ + widthCells * CELL_SIZE };
  }
  if (surface.direction === 'south') {
    return { minX, maxX: minX + widthCells * CELL_SIZE, minZ, maxZ: minZ + longCells * CELL_SIZE };
  }
  return {
    minX,
    maxX: minX + widthCells * CELL_SIZE,
    minZ: minZ - (longCells - 1) * CELL_SIZE,
    maxZ: minZ + CELL_SIZE,
  };
}

export function isInsideStair(x: number, z: number, surface: TraversalSurface): boolean {
  const b = stairWorldBounds(surface);
  return x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ;
}

/**
 * 0-based 台阶编号。仅 M1.5-C 需要 east 楼梯；其余方向按数据给出通用投影，
 * 但本阶段实际地图只有 east。
 */
export function stairStepIndexAt(x: number, z: number, surface: TraversalSurface): number | undefined {
  if (!isInsideStair(x, z, surface)) return undefined;
  const b = stairWorldBounds(surface);
  let along: number;
  if (surface.direction === 'east') along = x - b.minX;
  else if (surface.direction === 'west') along = b.maxX - x;
  else if (surface.direction === 'south') along = z - b.minZ;
  else along = b.maxZ - z;
  const index = Math.floor(along / surface.stepRun);
  return Math.min(surface.stepCount - 1, Math.max(0, index));
}

/** 由 TraversalSurface + 0-based 台阶编号得到踏面世界高度。 */
export function stairSurfaceStepTopY(surface: TraversalSurface, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= surface.stepCount) {
    throw new RangeError(`stair step index out of range: ${index}`);
  }
  return surface.worldYLow + (index + 1) * surface.stepRise;
}
