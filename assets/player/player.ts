import type { EntityHandle } from '@forgeax/engine/ecs';
import type { Cell } from '../grid/grid.ts';
import type { SaveRestoreReport } from '../save/save-ports.ts';
import type { Level } from '../spatial/space.ts';
import { MAP_CONFIG } from '../world/map-config.ts';

/** 玩家出生格（保留 M1.5 原坐标：地图中部偏左，开局即可看到两处旧铁矿）。 */
export const PLAYER_START_CELL: Cell = { gx: -2, gz: 2 };

/** 正面方向：-Z（地图北），与相机 yaw=0 的视线方向一致。 */
export type FacingDirection = 'north';

/** 玩家移动速度（米/秒）。 */
export const PLAYER_SPEED = 4;
/** 玩家中心允许到达的地图边界（米），由 MapConfig 派生；当前为 ±15.5。 */
export const PLAYER_BOUNDS_X = MAP_CONFIG.playerBoundsX;
export const PLAYER_BOUNDS_Z = MAP_CONFIG.playerBoundsZ;
/** 兼容性派生别名（正方形地图下等于 X 边界）；新代码请使用 _X/_Z。 */
export const PLAYER_BOUNDS = PLAYER_BOUNDS_X;
/** 单帧最大推进时间：标签页挂起恢复时避免瞬移。 */
export const PLAYER_MAX_STEP_SECONDS = 0.1;
export const PLAYER_MOVE_SYSTEM_NAME = 'island-industria/player-move';
/** 玩家运行时状态的 World 资源键（相机通过它读取玩家位置）。 */
export const PLAYER_STATE_KEY = 'IslandIndustriaPlayerState';

export interface PlayerState {
  /** 连续世界坐标；position[1] 是玩家脚底高度 feetY。 */
  readonly position: [number, number, number];
  /** 逻辑楼层。 */
  level: Level;
  /** 当前真实支撑面 ID（平面支撑或楼梯 TraversalSurface）。 */
  supportId: string | null;
  /** 当前所在格（由连续位置换算，供建筑阻挡使用）。 */
  readonly cell: Cell;
  /** 当前朝向（弧度，0 = 面向 -Z）。 */
  facingYaw: number;
}

/**
 * 玩家服务。cell 与 state.cell 是同一个对象：玩家移动系统每帧更新它，
 * 建造系统读取到的一定是玩家当前所在格。
 */
export interface PlayerService {
  readonly entity: EntityHandle;
  readonly cell: Cell;
  readonly facing: FacingDirection;
  readonly state: PlayerState;
  /**
   * 读档：把玩家放到存档位置。内部做一次垂直解算（优先按存档 level 找支撑面/楼梯），
   * 找不到可站立面或落点被 blocksPlayer 结构占用时退回出生点并记录 issue。
   */
  restorePosition(raw: unknown): SaveRestoreReport;
}

/**
 * 相机相对移动方向：forward = W(+1)/S(-1)，right = D(+1)/A(-1)。
 * 返回单位化水平方向；相机 yaw=0 时 W 朝 -Z，D 朝 +X。
 */
export function moveVector(
  yaw: number,
  forward: number,
  right: number,
): { readonly x: number; readonly z: number; readonly length: number } {
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const x = forwardX * forward + rightX * right;
  const z = forwardZ * forward + rightZ * right;
  const length = Math.hypot(x, z);
  if (length === 0) return { x: 0, z: 0, length: 0 };
  return { x: x / length, z: z / length, length };
}

/** 把玩家位置夹在地图有效范围内（X/Z 分别夹取，为未来矩形地图留接口）。 */
export function clampPlayerPosition(x: number, z: number): [number, number] {
  return [
    Math.min(PLAYER_BOUNDS_X, Math.max(-PLAYER_BOUNDS_X, x)),
    Math.min(PLAYER_BOUNDS_Z, Math.max(-PLAYER_BOUNDS_Z, z)),
  ];
}

/** 由移动方向求朝向角（模型正面为 -Z）。 */
export function facingYawFor(moveX: number, moveZ: number): number {
  return Math.atan2(-moveX, -moveZ);
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    player: PlayerService;
  }
}
