import { CELL_SIZE, type Placement } from '../grid/grid.ts';
import type { ItemId } from '../items/items.ts';
import { levelBaseY } from '../spatial/space.ts';

/**
 * M1.8-D 重力溜槽（纯逻辑、零引擎依赖）。
 *
 * 模型（刻意保持最小，只证明自动生产闭环）：
 * - 每格溜槽同一时刻最多承载 1 件物品，物品有真实位置 `t ∈ [0,1]`（沿本格朝向）；
 * - 物品匀速下滑（1.2 m/s），到达 `t = 1` 后尝试交给下一格；
 * - 下一格不可接收（溜槽已占用 / 机器输入满 / 前方没东西）时物品停在 `0.92` 等待，
 *   **不复制、不消失**；上游因此自然被堵住，机器输出缓冲会满 → 加工暂停（可观察、可恢复）；
 * - 「储存位置」＝玩家库存：溜槽末端没有下一格时把物品交给库存，这是本作唯一的仓储系统。
 */

/** 溜槽下滑速度（米/秒）。 */
export const CHUTE_SPEED = 1.2;
/** 下游堵塞时物品停在的进度（留一点余量，视觉上停在槽口）。 */
export const CHUTE_BLOCKED_PROGRESS = 0.92;
/** 物品在槽面上的视觉高度（相对层底）。 */
export const CHUTE_ITEM_HEIGHT = 0.34;

export interface ChuteItem {
  readonly itemId: ItemId;
  t: number;
  blocked: boolean;
}

export interface ChuteState {
  item: ChuteItem | null;
  /** 历史累计交出件数（读数用）。 */
  delivered: number;
}

export function createChuteState(): ChuteState {
  return { item: null, delivered: 0 };
}

/** 溜槽朝向：本地 +X 经 rotation 旋转后的世界方向，与机械端口同一约定。 */
export function chuteDirectionOf(rotation: number): { readonly dx: number; readonly dz: number } {
  switch (rotation) {
    case 0: return { dx: 1, dz: 0 };
    case 90: return { dx: 0, dz: -1 };
    case 180: return { dx: -1, dz: 0 };
    case 270: return { dx: 0, dz: 1 };
    default: return { dx: 1, dz: 0 };
  }
}

/** 溜槽末端指向的下一格（格坐标）。 */
export function chuteNextCell(placement: Placement): { readonly gx: number; readonly gz: number } {
  const dir = chuteDirectionOf(placement.rotation);
  return { gx: placement.gx + dir.dx, gz: placement.gz + dir.dz };
}

/** 物品世界位置：从本格入口边滑到出口边。 */
export function chuteItemWorldPosition(
  placement: Placement,
  t: number,
): [number, number, number] {
  const dir = chuteDirectionOf(placement.rotation);
  const centerX = placement.gx + 0.5;
  const centerZ = placement.gz + 0.5;
  const clamped = Math.min(1, Math.max(0, t));
  return [
    centerX - dir.dx * 0.5 + dir.dx * clamped,
    levelBaseY(placement.level) + CHUTE_ITEM_HEIGHT,
    centerZ - dir.dz * 0.5 + dir.dz * clamped,
  ];
}

/** 推进在途物品；到达 1 之后不再前进（等待交接）。 */
export function advanceChute(state: ChuteState, delta: number): void {
  const item = state.item;
  if (!item) return;
  const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.25)) : 0;
  if (item.blocked) {
    item.t = Math.min(CHUTE_BLOCKED_PROGRESS, item.t);
    return;
  }
  item.t = Math.min(1, item.t + (CHUTE_SPEED * dt) / CELL_SIZE);
}

/** 是否已到槽口、可以尝试交出。 */
export function readyForHandoff(state: ChuteState): boolean {
  return state.item !== null && !state.item.blocked && state.item.t >= 1;
}

/** 下游不可接收：停在槽口等待（不丢物品）。 */
export function markBlocked(state: ChuteState): void {
  if (!state.item) return;
  state.item.blocked = true;
  state.item.t = Math.min(state.item.t, CHUTE_BLOCKED_PROGRESS);
}

/** 下游恢复后解除堵塞，重新尝试交出。 */
export function unblock(state: ChuteState): void {
  if (!state.item) return;
  state.item.blocked = false;
}

/** 上游把物品放进本格溜槽（入口）。占用时返回 false。 */
export function acceptItem(state: ChuteState, itemId: ItemId): boolean {
  if (state.item !== null) return false;
  state.item = { itemId, t: 0, blocked: false };
  return true;
}

/** 交接成功：清空本格并计入交付数，返回交出去的物品。 */
export function releaseItem(state: ChuteState): ChuteItem | undefined {
  const item = state.item;
  if (!item) return undefined;
  state.item = null;
  state.delivered += 1;
  return item;
}

/** 拆除溜槽时把在途物品交出来（防止物品消失）。 */
export function flushChute(state: ChuteState): ChuteItem | undefined {
  return releaseItem(state);
}
