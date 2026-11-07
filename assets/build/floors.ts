import { CELL_SIZE, cellsOf, worldExtent, type Cell, type Placement, type Rotation } from '../grid/grid.ts';
import { levelBaseY, type Aabb, type Level } from '../spatial/space.ts';
import type { SupportKind, SupportSurface, TraversalSurface } from '../spatial/support.ts';
import type { StairDirection } from '../spatial/structures.ts';

/**
 * M1.8-A 可建造楼层结构（纯逻辑、零引擎依赖）。
 *
 * 四种结构都「在场 L 放置」，但作用在不同高度：
 * - 支柱 pillar：占据 y[3L, 3L+2.7]，是楼板的承重件；
 * - 楼板 deck：薄板 y[3L+2.7, 3L+3.0]，顶面 = level L+1 的可建造 + 可行走支撑面；
 * - 开孔 opening：与楼板同位置，但**不注册碰撞体**，且顶面只可建造、**不可行走**；
 *   这是「跨层传动」唯一合法的穿层机制；
 * - 楼梯 stair：4 格跑、8 级、rise 0.375 / run 0.5，注册 L→L+1 的通行面。
 *
 * 关键不变量：
 * 1. `Placement.level` 一律是「玩家建造时所在的层 L」，不是产物所在层；
 * 2. 楼板/开孔的支撑面在 L+1，`worldY = levelBaseY(L+1)`（正好是标准层高，SupportRegistry 校验通过）；
 * 3. 支柱高 2.7 + 楼板厚 0.3 = 3.0，两个 AABB 只在边界贴合，`aabbIntersects` 不判为相交，
 *    因此同一格可以「支柱在下、楼板在上」而不冲突。
 */

/** 楼层建造模式的 World 资源键；存在且 active 时 build / mechanical 让出输入。 */
export const FLOOR_MODE_KEY = 'IslandIndustriaFloorMode';

export interface FloorModeState {
  readonly active: boolean;
  readonly kind: FloorKind;
  readonly rotation: Rotation;
}

/** 楼层建造模式允许的四种结构。 */

export type FloorKind = 'pillar' | 'deck' | 'opening' | 'stair';

export const FLOOR_KINDS: readonly FloorKind[] = Object.freeze(['pillar', 'deck', 'opening', 'stair']);

/** 支柱高度：2.7 = 3.0 − 楼板厚度，保证与楼板薄板首尾相接不重叠。 */
export const PILLAR_HEIGHT = 2.7;
/** 楼板厚度。 */
export const DECK_THICKNESS = 0.3;
/** 楼梯沿跑向的格数。 */
export const STAIR_RUN_CELLS = 4;
/** 楼梯宽度（格）。 */
export const STAIR_WIDTH_CELLS = 1;
/** 楼梯级数。 */
export const STAIR_STEP_COUNT = 8;
/** 每级水平长度（米）：8 × 0.5 = 4 格。 */
export const STAIR_STEP_RUN = 0.5;
/** 每级垂直高度（米）：8 × 0.375 = 3.0 = 标准层高。 */
export const STAIR_STEP_RISE = 0.375;

export function isFloorKind(value: string): value is FloorKind {
  return value === 'pillar' || value === 'deck' || value === 'opening' || value === 'stair';
}

/** 该结构在放置时占据的本地足迹（未旋转）。 */
export function floorFootprint(kind: FloorKind): { readonly w: number; readonly d: number } {
  if (kind === 'stair') return { w: STAIR_RUN_CELLS, d: STAIR_WIDTH_CELLS };
  return { w: 1, d: 1 };
}

/**
 * 结构的世界 AABB。
 * - pillar：y[3L, 3L+2.7]
 * - deck / opening：y[3L+2.7, 3L+3.0]（opening 不注册碰撞体，但几何仍需要它做体积校验与视觉）
 * - stair：y[3L, 3L+3]，覆盖整条跑向
 */
export function floorAabb(kind: FloorKind, placement: Placement): Aabb {
  const baseY = levelBaseY(placement.level);
  const extent = worldExtent(placement);
  const minX = placement.gx * CELL_SIZE;
  const minZ = placement.gz * CELL_SIZE;
  const maxX = (placement.gx + extent.w) * CELL_SIZE;
  const maxZ = (placement.gz + extent.d) * CELL_SIZE;
  if (kind === 'pillar') {
    return { min: [minX, baseY, minZ], max: [maxX, baseY + PILLAR_HEIGHT, maxZ] };
  }
  if (kind === 'deck' || kind === 'opening') {
    return {
      min: [minX, baseY + PILLAR_HEIGHT, minZ],
      max: [maxX, baseY + PILLAR_HEIGHT + DECK_THICKNESS, maxZ],
    };
  }
  return { min: [minX, baseY, minZ], max: [maxX, baseY + STAIR_STEP_COUNT * STAIR_STEP_RISE, maxZ] };
}

/** 该结构是否注册实体碰撞体；开孔楼板是「洞」，不阻挡任何东西。 */
export function floorBlocksBuild(kind: FloorKind): boolean {
  return kind !== 'opening';
}

/** 该结构是否阻挡玩家移动。支柱阻挡；楼板薄板在头顶不阻挡；楼梯由通行面处理。 */
export function floorBlocksPlayer(kind: FloorKind): boolean {
  return kind === 'pillar';
}

/**
 * 楼板/开孔在上层产生的支撑面。
 * - deck：buildable + walkable，玩家可以站上去；
 * - opening：buildable 但**不可行走**，玩家不会走进洞里（垂直移动找不到可行支撑面即被挡住），
 *   但立体传动件可以「站在」孔上继续向上连接。
 */
export function floorTopSupport(
  kind: FloorKind,
  id: string,
  placement: Placement,
): SupportSurface | undefined {
  if (kind !== 'deck' && kind !== 'opening') return undefined;
  const level: Level = placement.level + 1;
  const supportKind: SupportKind = kind === 'deck' ? 'deck' : 'opening';
  return {
    id,
    level,
    worldY: levelBaseY(level),
    cells: cellsOf(placement).map((cell) => ({ gx: cell.gx, gz: cell.gz })),
    kind: supportKind,
    buildable: true,
    walkable: kind === 'deck',
    active: true,
  };
}

/**
 * 旋转换算成楼梯跑向。
 * 与 `ports.ts` 的 `rotateY` 同一约定（本地 +X 经 rotation 旋转后的世界方向）：
 * 0 = 东(+X)、90 = 北(−Z)、180 = 西(−X)、270 = 南(+Z)。
 */
export function stairDirectionOf(placement: Placement): StairDirection {
  switch (placement.rotation) {
    case 0: return 'east';
    case 90: return 'north';
    case 180: return 'west';
    case 270: return 'south';
    default: return 'east';
  }
}

/**
 * `stairWorldBounds` 以 originCell + direction 派生世界矩形，三个方向需要不同的 origin：
 * east/south 用最小角；west/north 用「跑向末端那一格」，否则矩形会跑到负方向去。
 */
export function stairOriginCell(placement: Placement): Cell {
  const direction = stairDirectionOf(placement);
  if (direction === 'west') return { gx: placement.gx + STAIR_RUN_CELLS - 1, gz: placement.gz };
  if (direction === 'north') return { gx: placement.gx, gz: placement.gz + STAIR_RUN_CELLS - 1 };
  return { gx: placement.gx, gz: placement.gz };
}

/** 楼梯的通行面（严格满足 TraversalRegistry 的两条守恒校验）。 */
export function floorTraversal(kind: FloorKind, id: string, placement: Placement): TraversalSurface | undefined {
  if (kind !== 'stair') return undefined;
  const baseY = levelBaseY(placement.level);
  return {
    id,
    levelLow: placement.level,
    levelHigh: placement.level + 1,
    worldYLow: baseY,
    worldYHigh: baseY + STAIR_STEP_COUNT * STAIR_STEP_RISE,
    originCell: stairOriginCell(placement),
    direction: stairDirectionOf(placement),
    runLengthCells: STAIR_RUN_CELLS,
    widthCells: STAIR_WIDTH_CELLS,
    stepCount: STAIR_STEP_COUNT,
    stepRun: STAIR_STEP_RUN,
    stepRise: STAIR_STEP_RISE,
    cells: cellsOf(placement).map((cell) => ({ gx: cell.gx, gz: cell.gz })),
    walkable: true,
  };
}

/** 一级台阶的视觉箱体（世界坐标中心 + 尺寸）。 */
export interface StepBox {
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
}

export function stairStepBoxes(placement: Placement): StepBox[] {
  const direction = stairDirectionOf(placement);
  const baseY = levelBaseY(placement.level);
  const extent = worldExtent(placement);
  const minX = placement.gx * CELL_SIZE;
  const minZ = placement.gz * CELL_SIZE;
  const boxes: StepBox[] = [];
  for (let index = 0; index < STAIR_STEP_COUNT; index += 1) {
    const height = (index + 1) * STAIR_STEP_RISE;
    const along = (index + 0.5) * STAIR_STEP_RUN;
    const centerY = baseY + height / 2;
    let centerX: number;
    let centerZ: number;
    let sizeX: number;
    let sizeZ: number;
    if (direction === 'east' || direction === 'west') {
      centerX = direction === 'east' ? minX + along : minX + extent.w * CELL_SIZE - along;
      centerZ = minZ + (extent.d * CELL_SIZE) / 2;
      sizeX = STAIR_STEP_RUN;
      sizeZ = extent.d * CELL_SIZE;
    } else {
      centerZ = direction === 'south' ? minZ + along : minZ + extent.d * CELL_SIZE - along;
      centerX = minX + (extent.w * CELL_SIZE) / 2;
      sizeX = extent.w * CELL_SIZE;
      sizeZ = STAIR_STEP_RUN;
    }
    boxes.push({ center: [centerX, centerY, centerZ], size: [sizeX, height, sizeZ] });
  }
  return boxes;
}

/** 楼板/开孔薄板的视觉箱体。 */
export function deckBox(placement: Placement): StepBox {
  const aabb = floorAabb('deck', placement);
  return {
    center: [
      (aabb.min[0] + aabb.max[0]) / 2,
      (aabb.min[1] + aabb.max[1]) / 2,
      (aabb.min[2] + aabb.max[2]) / 2,
    ],
    size: [
      (aabb.max[0] as number) - (aabb.min[0] as number),
      DECK_THICKNESS,
      (aabb.max[2] as number) - (aabb.min[2] as number),
    ],
  };
}

/** 开孔框线：4 根细条，留出中间的洞。 */
export const OPENING_RIM_THICKNESS = 0.09;
export const OPENING_RIM_HEIGHT = 0.34;

export function openingRimBoxes(placement: Placement): StepBox[] {
  const baseY = levelBaseY(placement.level);
  const minX = placement.gx * CELL_SIZE;
  const minZ = placement.gz * CELL_SIZE;
  const size = CELL_SIZE;
  const y = baseY + PILLAR_HEIGHT + DECK_THICKNESS / 2;
  const t = OPENING_RIM_THICKNESS;
  const h = OPENING_RIM_HEIGHT;
  return [
    { center: [minX + size / 2, y, minZ + t / 2], size: [size, h, t] },
    { center: [minX + size / 2, y, minZ + size - t / 2], size: [size, h, t] },
    { center: [minX + t / 2, y, minZ + size / 2], size: [t, h, size] },
    { center: [minX + size - t / 2, y, minZ + size / 2], size: [t, h, size] },
  ];
}

/** 楼板结构校验所需的运行时查询（由 build 插件提供，纯函数便于单测）。 */
export interface FloorSupportQuery {
  /** 该格、该层是否存在支柱结构。 */
  readonly hasPillar: (cell: Cell, level: Level) => boolean;
  /** 该格、该层是否有可建造支撑面（含地面/固定平台/楼板/开孔）。 */
  readonly hasBuildableSupport: (cell: Cell, level: Level, worldY: number) => boolean;
}

/**
 * 楼板/开孔的「结构支撑」规则：
 * 1) 本格下层（level L）有支柱；或
 * 2) 四邻格在目标层 L+1 已有可建造支撑面（既有楼板、开孔、固定平台都算）。
 *
 * 已知简化：允许无限向外悬挑（相邻即成立），没有做跨距/受力计算。
 * 这是 M1 范围内的显式取舍，已记录在方案文档的「已知限制」。
 */
export function deckSupportVerdict(
  cell: Cell,
  level: Level,
  query: FloorSupportQuery,
): boolean {
  if (query.hasPillar(cell, level)) return true;
  const targetLevel = level + 1;
  const worldY = levelBaseY(targetLevel);
  const neighbours: Cell[] = [
    { gx: cell.gx + 1, gz: cell.gz },
    { gx: cell.gx - 1, gz: cell.gz },
    { gx: cell.gx, gz: cell.gz + 1 },
    { gx: cell.gx, gz: cell.gz - 1 },
  ];
  return neighbours.some((neighbour) => query.hasBuildableSupport(neighbour, targetLevel, worldY));
}

/** 楼板/开孔的支撑面注册 id（来源是建筑自身的稳定 id）。 */
export function floorSupportId(kind: FloorKind, buildingId: number): string {
  return `support:${kind}:${buildingId}`;
}

/** 楼梯通行面注册 id。 */
export function floorTraversalId(buildingId: number): string {
  return `traversal:stair:${buildingId}`;
}

/** 支柱/楼板/楼梯的碰撞体注册 id（走 StructureRegistry，与 SpatialIndex 同源）。 */
export function floorStructureId(kind: FloorKind, buildingId: number): string {
  return `floor:${kind}:${buildingId}`;
}

export type { StairDirection };
