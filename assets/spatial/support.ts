import { CELL_SIZE, cellKey, cellsOf, worldToCell, type Cell, type Placement } from '../grid/grid.ts';
import {
  SPATIAL_EPS,
  assertValidLevel,
  cellKey3,
  levelBaseY,
  normalizeLevel,
  placementBaseY,
  type Level,
} from './space.ts';

/**
 * SupportSurface：行走与建造支撑面（独立于建筑 Placement 与实体碰撞体）。
 * M1.5 只允许标准层高（worldY === levelBaseY(level)），特殊高度后续扩展。
 */
/** 地面/平台/未来楼板共用的 World 资源键：外部系统可向同一注册表注册。 */
export const SUPPORT_REGISTRY_KEY = 'IslandIndustriaSupportRegistry';
export const GROUND_SUPPORT_ID = 'support:ground';

/**
 * 支撑面种类。
 * - ground：地面（MapConfig 覆盖全域）；
 * - platform：固定平台；
 * - deck：M1.8 玩家自建楼板顶面（可建造 + 可行走）；
 * - opening：M1.8 玩家自建楼板「开孔」面（可建造、**不可行走**）——
 *   这是跨层传动唯一合法的穿层机制：孔上可以立传动件，但玩家走不进洞里。
 */
export type SupportKind = 'ground' | 'platform' | 'deck' | 'opening';

export interface SupportSurface {
  readonly id: string;
  readonly level: Level;
  readonly worldY: number;
  readonly cells: readonly Cell[];
  readonly kind: SupportKind;
  readonly buildable: boolean;
  readonly walkable: boolean;
  readonly active: boolean;
}

/**
 * TraversalSurface：楼梯/坡道等连续高度通行面的数据结构。
 * M1.5-A 只建立数据结构与基础注册能力，不实现高度插值或玩家移动。
 */
export interface TraversalSurface {
  readonly id: string;
  readonly levelLow: Level;
  readonly levelHigh: Level;
  readonly worldYLow: number;
  readonly worldYHigh: number;
  readonly originCell: Cell;
  readonly direction: 'north' | 'east' | 'south' | 'west';
  readonly runLengthCells: number;
  readonly widthCells: number;
  /** 台阶数：视觉台阶与未来高度计算共用同一数据。 */
  readonly stepCount: number;
  /** 每级水平长度（米）。 */
  readonly stepRun: number;
  /** 每级垂直高度（米）。 */
  readonly stepRise: number;
  readonly cells: readonly Cell[];
  readonly walkable: boolean;
}

export interface SupportRegistryOptions {
  /** M1.5 默认要求标准层高；特殊高度后续阶段可关闭。 */
  readonly requireStandardHeight?: boolean;
}

/** 支撑面注册表：统一地面、地图平台与未来玩家楼板。 */
export class SupportRegistry {
  private readonly byId = new Map<string, SupportSurface>();
  private readonly byCell = new Map<string, Set<string>>();
  private readonly requireStandardHeight: boolean;

  constructor(options: SupportRegistryOptions = {}) {
    this.requireStandardHeight = options.requireStandardHeight ?? true;
  }

  register(surface: SupportSurface): void {
    assertValidLevel(surface.level);
    if (!Number.isFinite(surface.worldY)) {
      throw new RangeError(`support worldY must be finite, received ${surface.worldY}`);
    }
    if (this.requireStandardHeight && Math.abs(surface.worldY - levelBaseY(surface.level)) > SPATIAL_EPS) {
      throw new RangeError(
        `M1.5 supports must use standard level height: level ${surface.level}, worldY ${surface.worldY}`,
      );
    }
    if (surface.cells.length === 0) throw new RangeError('support surface must cover at least one cell');
    if (this.byId.has(surface.id)) throw new Error(`duplicate support id: ${surface.id}`);
    const cells = surface.cells.map((cell) => ({ gx: cell.gx, gz: cell.gz }));
    this.byId.set(surface.id, { ...surface, cells });
    for (const cell of cells) {
      const key = cellKey(cell);
      let ids = this.byCell.get(key);
      if (!ids) {
        ids = new Set();
        this.byCell.set(key, ids);
      }
      ids.add(surface.id);
    }
  }

  unregister(id: string): void {
    const surface = this.byId.get(id);
    if (!surface) return;
    this.byId.delete(id);
    for (const cell of surface.cells) {
      const key = cellKey(cell);
      const ids = this.byCell.get(key);
      if (!ids) continue;
      ids.delete(id);
      if (ids.size === 0) this.byCell.delete(key);
    }
  }

  get(id: string): SupportSurface | undefined {
    return this.byId.get(id);
  }

  all(): readonly SupportSurface[] {
    return [...this.byId.values()];
  }

  /** 指定格、指定逻辑层的有效支撑面（优先 buildable 不在此过滤）。 */
  supportAt(cell: Cell, level: Level): SupportSurface | undefined {
    assertValidLevel(level);
    const ids = this.byCell.get(cellKey(cell));
    if (!ids) return undefined;
    for (const id of ids) {
      const surface = this.byId.get(id);
      if (surface && surface.active && surface.level === level) return surface;
    }
    return undefined;
  }

  /** 指定格、指定逻辑层、指定世界高度的可建造支撑面。 */
  buildableSupportAt(cell: Cell, level: Level, worldY: number): SupportSurface | undefined {
    assertValidLevel(level);
    const ids = this.byCell.get(cellKey(cell));
    if (!ids) return undefined;
    for (const id of ids) {
      const surface = this.byId.get(id);
      if (!surface || !surface.active || !surface.buildable) continue;
      if (surface.level !== level) continue;
      if (Math.abs(surface.worldY - worldY) <= SPATIAL_EPS) return surface;
    }
    return undefined;
  }

  /** 是否整个 footprint 都有同层、同高、可建造的支撑面。 */
  hasBuildableSupport(placement: Placement): boolean {
    const baseY = placementBaseY(placement);
    const level = normalizeLevel((placement as { level?: number }).level);
    for (const cell of cellsOf(placement)) {
      if (!this.buildableSupportAt(cell, level, baseY)) return false;
    }
    return true;
  }

  /** 某世界水平位置上的所有有效支撑面（跨层）。 */
  supportsAtPoint(worldX: number, worldZ: number): SupportSurface[] {
    const cell = worldToCell(worldX, worldZ);
    const ids = this.byCell.get(cellKey(cell));
    if (!ids) return [];
    const result: SupportSurface[] = [];
    for (const id of ids) {
      const surface = this.byId.get(id);
      if (surface && surface.active) result.push(surface);
    }
    return result;
  }

  /** 指定三维格键的支撑面（调试/测试用）。 */
  supportAtKey(cell: Cell, level: Level): SupportSurface | undefined {
    return this.supportAt(cell, level);
  }

  clear(): void {
    this.byId.clear();
    this.byCell.clear();
  }

  get size(): number {
    return this.byId.size;
  }

  /** 用于测试/调试确认三维键与支撑面映射。 */
  keyFor(cell: Cell, level: Level): string {
    return cellKey3(cell, level);
  }
}

/** 通行面注册表：M1.5-A 只保存数据，不实现高度计算或移动。 */
export class TraversalRegistry {
  private readonly byId = new Map<string, TraversalSurface>();
  private readonly byCell = new Map<string, Set<string>>();

  register(surface: TraversalSurface): void {
    assertValidLevel(surface.levelLow);
    assertValidLevel(surface.levelHigh);
    if (!Number.isFinite(surface.worldYLow) || !Number.isFinite(surface.worldYHigh)) {
      throw new RangeError('traversal world heights must be finite');
    }
    if (!Number.isInteger(surface.stepCount) || surface.stepCount < 1) {
      throw new RangeError('traversal stepCount must be a positive integer');
    }
    if (!Number.isFinite(surface.stepRun) || surface.stepRun <= 0
      || !Number.isFinite(surface.stepRise) || surface.stepRise <= 0) {
      throw new RangeError('traversal stepRun/stepRise must be positive finite numbers');
    }
    if (Math.abs(surface.stepCount * surface.stepRun - surface.runLengthCells * CELL_SIZE) > SPATIAL_EPS) {
      throw new RangeError('traversal stepCount * stepRun must equal runLengthCells * CELL_SIZE');
    }
    if (Math.abs(surface.stepCount * surface.stepRise - (surface.worldYHigh - surface.worldYLow)) > SPATIAL_EPS) {
      throw new RangeError('traversal stepCount * stepRise must equal worldYHigh - worldYLow');
    }
    if (surface.cells.length === 0) throw new RangeError('traversal surface must cover at least one cell');
    if (this.byId.has(surface.id)) throw new Error(`duplicate traversal id: ${surface.id}`);
    this.byId.set(surface.id, surface);
    for (const cell of surface.cells) {
      const key = cellKey(cell);
      let ids = this.byCell.get(key);
      if (!ids) {
        ids = new Set();
        this.byCell.set(key, ids);
      }
      ids.add(surface.id);
    }
  }

  unregister(id: string): void {
    const surface = this.byId.get(id);
    if (!surface) return;
    this.byId.delete(id);
    for (const cell of surface.cells) {
      const key = cellKey(cell);
      const ids = this.byCell.get(key);
      if (!ids) continue;
      ids.delete(id);
      if (ids.size === 0) this.byCell.delete(key);
    }
  }

  get(id: string): TraversalSurface | undefined {
    return this.byId.get(id);
  }

  atCell(cell: Cell): readonly TraversalSurface[] {
    const ids = this.byCell.get(cellKey(cell));
    if (!ids) return [];
    const result: TraversalSurface[] = [];
    for (const id of ids) {
      const surface = this.byId.get(id);
      if (surface) result.push(surface);
    }
    return result;
  }

  all(): readonly TraversalSurface[] {
    return [...this.byId.values()];
  }

  clear(): void {
    this.byId.clear();
    this.byCell.clear();
  }

  get size(): number {
    return this.byId.size;
  }
}