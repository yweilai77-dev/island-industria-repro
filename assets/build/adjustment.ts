import {
  createPlacement,
  rotatePlacement,
  type Cell,
  type Placement,
} from '../grid/grid.ts';

/**
 * 搬动调整的纯数据状态（M1.4.1）。
 * - original 是进入调整时的完整快照，取消时据此恢复；
 * - placement 是当前预览（锚点 + rotation），始终是整数格数据；
 * - valid/hasPreview 每帧由插件重新计算，不信任缓存。
 */

/** 搬动期间写进 World 的锁定标记：玩家移动与采矿读取它。 */
export const BUILD_ADJUSTING_KEY = 'IslandIndustriaBuildAdjusting';

export interface BuildingAdjustment {
  readonly buildingId: number;
  readonly typeIndex: number;
  readonly original: Placement;
  readonly placement: Placement;
  /** 鼠标是否落在地面有效格。 */
  readonly hasPreview: boolean;
  /** 当前预览是否合法（进入时先按释放原占地后的真实情况计算，不能预设 true）。 */
  readonly valid: boolean;
}

export function copyPlacement(placement: Placement): Placement {
  return createPlacement(
    placement.gx,
    placement.gz,
    placement.w,
    placement.d,
    placement.rotation,
    placement.level,
  );
}

/** 进入调整：原始位置快照 + 初始预览（合法性由调用方用 validatePlacement 计算）。 */
export function beginAdjustment(
  buildingId: number,
  typeIndex: number,
  placement: Placement,
): BuildingAdjustment {
  return {
    buildingId,
    typeIndex,
    original: copyPlacement(placement),
    placement: copyPlacement(placement),
    hasPreview: true,
    valid: false,
  };
}

/** 鼠标移动到某格：只改锚点，保留本地足迹与 rotation。 */
export function moveAdjustmentTo(adj: BuildingAdjustment, cell: Cell): BuildingAdjustment {
  return {
    ...adj,
    placement: createPlacement(
      cell.gx,
      cell.gz,
      adj.placement.w,
      adj.placement.d,
      adj.placement.rotation,
      adj.placement.level,
    ),
    hasPreview: true,
    valid: false,
  };
}

/** R 旋转：只改 rotation，锚点保持固定（已确认的旋转基准）。 */
export function rotateAdjustment(adj: BuildingAdjustment, deltaDegrees = 90): BuildingAdjustment {
  return {
    ...adj,
    placement: rotatePlacement(adj.placement, deltaDegrees),
    valid: false,
  };
}

/** 写入最新合法性/预览可用性（每帧重算后调用）。 */
export function setAdjustmentValidity(
  adj: BuildingAdjustment,
  hasPreview: boolean,
  valid: boolean,
): BuildingAdjustment {
  return { ...adj, hasPreview, valid };
}

/** 取消时用于恢复的原始 Placement（副本）。 */
export function originalPlacement(adj: BuildingAdjustment): Placement {
  return copyPlacement(adj.original);
}

/** 当前预览 Placement（副本）。 */
export function currentPlacement(adj: BuildingAdjustment): Placement {
  return copyPlacement(adj.placement);
}