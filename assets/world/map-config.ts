import { CELL_SIZE, worldToCell, type Cell } from '../grid/grid.ts';

/**
 * M1.6 地图配置：地图尺寸的唯一权威来源。
 *
 * 坐标约定沿用 grid.ts：1 格 = CELL_SIZE 米，格 (gx, gz) 覆盖
 * 世界 X ∈ [gx, gx+1) × Z ∈ [gz, gz+1)；地图以世界原点为中心。
 *
 * M1.6 采用偶数边长：这样原点正好落在格交点上，min = -half、max = half-1，
 * 平台/楼梯/出生点等既有内容坐标语义保持不变。接口按 X/Z 两个方向分别
 * 表达，当前生产地图为正方形，但计算不把两个方向绑定为同一个变量。
 */

export interface MapConfigInput {
  readonly id: string;
  /** 地图 X 方向宽度（格）。M1.6 要求正偶数。 */
  readonly widthCells: number;
  /** 地图 Z 方向深度（格）。M1.6 要求正偶数。 */
  readonly depthCells: number;
  /** 玩家中心到地图边缘的留白（米），默认 0.5。 */
  readonly playerMargin?: number;
  /** 地面顶面高度（世界 Y），默认 0。 */
  readonly groundTopY?: number;
  /** 地面板厚度（米），默认 0.2。 */
  readonly groundThickness?: number;
}

export interface MapConfig {
  readonly id: string;
  readonly widthCells: number;
  readonly depthCells: number;
  readonly cellSize: number;
  readonly playerMargin: number;
  readonly groundTopY: number;
  readonly groundThickness: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly minCellX: number;
  readonly maxCellX: number;
  readonly minCellZ: number;
  readonly maxCellZ: number;
  readonly worldMinX: number;
  readonly worldMaxX: number;
  readonly worldMinZ: number;
  readonly worldMaxZ: number;
  readonly playerBoundsX: number;
  readonly playerBoundsZ: number;
  readonly gridLineCountX: number;
  readonly gridLineCountZ: number;
  readonly groundSizeX: number;
  readonly groundSizeZ: number;
  readonly groundCenterY: number;
  readonly cellCount: number;
  /** 格坐标是否在地图内（闭区间 + 整数校验）。 */
  containsCell(cell: Cell): boolean;
  /** 世界点 → 地图内格；地图外返回 undefined；非有限输入沿用 worldToCell 抛 RangeError。 */
  buildAreaCellAt(worldX: number, worldZ: number): Cell | undefined;
  /** 地图内全部格（行优先）。返回冻结数据，调用者不能修改内部配置。 */
  cells(): readonly Cell[];
}

/** 地图边缘包边：只负责视觉提示，不进入任何空间/碰撞注册表。 */
export const EDGE_TRIM = Object.freeze({
  /** 包边水平厚度（米）。 */
  thickness: 0.2,
  /** 包边高出地面顶面的可见高度（米）。 */
  aboveGround: 0.25,
});

export interface EdgeTrimBox {
  readonly id: 'north' | 'south' | 'east' | 'west';
  /** 世界轴上的盒体尺寸 [x, y, z]。 */
  readonly size: readonly [number, number, number];
  /** 盒体中心世界位置。 */
  readonly pos: readonly [number, number, number];
}

function assertPositiveEvenInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0 || value % 2 !== 0) {
    throw new RangeError(
      `M1.6 map ${name} must be a positive even integer (origin-centered grid), received ${String(value)}`,
    );
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`map ${name} must be finite, received ${String(value)}`);
  }
}

/**
 * 创建并校验 MapConfig。返回对象及其格集合均为冻结数据，
 * 外部调用者不能通过返回值修改内部配置。
 */
export function createMapConfig(input: MapConfigInput): MapConfig {
  if (typeof input.id !== 'string' || input.id.length === 0) {
    throw new RangeError('map id must be a non-empty string');
  }
  assertPositiveEvenInteger(input.widthCells, 'widthCells');
  assertPositiveEvenInteger(input.depthCells, 'depthCells');

  const playerMargin = input.playerMargin ?? 0.5;
  assertFinite(playerMargin, 'playerMargin');
  if (!(playerMargin > 0 && playerMargin < CELL_SIZE)) {
    throw new RangeError(
      `map playerMargin must be in (0, ${CELL_SIZE}), received ${String(playerMargin)}`,
    );
  }

  const groundTopY = input.groundTopY ?? 0;
  assertFinite(groundTopY, 'groundTopY');

  const groundThickness = input.groundThickness ?? 0.2;
  assertFinite(groundThickness, 'groundThickness');
  if (!(groundThickness > 0)) {
    throw new RangeError(`map groundThickness must be positive, received ${String(groundThickness)}`);
  }

  const cellSize = CELL_SIZE;
  const halfWidth = (input.widthCells / 2) * cellSize;
  const halfDepth = (input.depthCells / 2) * cellSize;
  const minCellX = -input.widthCells / 2;
  const maxCellX = input.widthCells / 2 - 1;
  const minCellZ = -input.depthCells / 2;
  const maxCellZ = input.depthCells / 2 - 1;
  const playerBoundsX = halfWidth - playerMargin;
  const playerBoundsZ = halfDepth - playerMargin;
  if (!(playerBoundsX > 0) || !(playerBoundsZ > 0)) {
    throw new RangeError('map player bounds must be positive after applying playerMargin');
  }

  const cells: Cell[] = [];
  for (let gz = minCellZ; gz <= maxCellZ; gz += 1) {
    for (let gx = minCellX; gx <= maxCellX; gx += 1) {
      cells.push(Object.freeze({ gx, gz }));
    }
  }
  const frozenCells = Object.freeze(cells);

  const containsCell = (cell: Cell): boolean =>
    Number.isInteger(cell.gx)
    && Number.isInteger(cell.gz)
    && cell.gx >= minCellX
    && cell.gx <= maxCellX
    && cell.gz >= minCellZ
    && cell.gz <= maxCellZ;

  const config: MapConfig = {
    id: input.id,
    widthCells: input.widthCells,
    depthCells: input.depthCells,
    cellSize,
    playerMargin,
    groundTopY,
    groundThickness,
    halfWidth,
    halfDepth,
    minCellX,
    maxCellX,
    minCellZ,
    maxCellZ,
    worldMinX: -halfWidth,
    worldMaxX: halfWidth,
    worldMinZ: -halfDepth,
    worldMaxZ: halfDepth,
    playerBoundsX,
    playerBoundsZ,
    gridLineCountX: input.widthCells + 1,
    gridLineCountZ: input.depthCells + 1,
    groundSizeX: input.widthCells * cellSize,
    groundSizeZ: input.depthCells * cellSize,
    groundCenterY: groundTopY - groundThickness / 2,
    cellCount: input.widthCells * input.depthCells,
    containsCell,
    buildAreaCellAt: (worldX: number, worldZ: number): Cell | undefined => {
      const cell = worldToCell(worldX, worldZ);
      return containsCell(cell) ? cell : undefined;
    },
    cells: () => frozenCells,
  };

  return Object.freeze(config);
}

/**
 * 四段低矮包边的世界布局：贴在四条地图边缘的外侧，内侧面与地面边缘齐平。
 * 只用于场景视觉，调用方不得把这些盒体注册进 SpatialIndex / SupportRegistry。
 */
export function edgeTrimBoxes(config: MapConfig): readonly EdgeTrimBox[] {
  const height = config.groundThickness + EDGE_TRIM.aboveGround;
  const y = config.groundTopY - config.groundThickness + height / 2;
  const offsetX = config.halfWidth + EDGE_TRIM.thickness / 2;
  const offsetZ = config.halfDepth + EDGE_TRIM.thickness / 2;
  const longX = config.groundSizeX + EDGE_TRIM.thickness;
  const longZ = config.groundSizeZ + EDGE_TRIM.thickness;
  return Object.freeze([
    Object.freeze({
      id: 'north',
      size: Object.freeze([longX, height, EDGE_TRIM.thickness] as const),
      pos: Object.freeze([0, y, -offsetZ] as const),
    }),
    Object.freeze({
      id: 'south',
      size: Object.freeze([longX, height, EDGE_TRIM.thickness] as const),
      pos: Object.freeze([0, y, offsetZ] as const),
    }),
    Object.freeze({
      id: 'west',
      size: Object.freeze([EDGE_TRIM.thickness, height, longZ] as const),
      pos: Object.freeze([-offsetX, y, 0] as const),
    }),
    Object.freeze({
      id: 'east',
      size: Object.freeze([EDGE_TRIM.thickness, height, longZ] as const),
      pos: Object.freeze([offsetX, y, 0] as const),
    }),
  ]);
}

/** 生产地图：32×32 格，世界范围 [-16, 16) × [-16, 16)，玩家边界 ±15.5。 */
export const MAP_CONFIG = createMapConfig({
  id: 'island-main',
  widthCells: 32,
  depthCells: 32,
});
