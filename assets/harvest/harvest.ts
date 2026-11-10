import { ITEM_IDS } from '../items/items.ts';
import type { InventoryService } from '../inventory/inventory.ts';
import type { HarvestResult, ResourceNode } from '../resource/resource.ts';

/** 采集范围：玩家到矿点 AABB 边缘的水平距离（米）。 */
export const HARVEST_RANGE = 1.5;
/**
 * 单次采集耗时（秒）。
 *
 * P2-E3 兼容性修复：原 3.0 s 与验收脚本的 "press F -> advance(3.4 s)" 只差 0.4 s 余量，
 * 输入事件落帧稍晚就会让一次采集跨过下一个 advance 边界，表现为「按 N 次只得到 N-1~N-2 个矿」
 * （E1 已记录为采集时序 flaky）。改为 2.5 s，给输入落帧留 0.9 s 余量，
 * 同时缩短采矿劳动（配合资源平衡「采矿不应成为主要劳动」的目标）。
 * 采集产出/范围/状态机语义不变。
 */
export const HARVEST_DURATION = 2.5;
/** 单次采集产出。 */
export const HARVEST_YIELD = 1;

export interface HarvestableNode {
  readonly id: number;
  readonly gx: number;
  readonly gz: number;
  readonly w: number;
  readonly d: number;
  readonly amount: number;
  readonly depleted: boolean;
}

/** 点到节点 AABB 的水平距离；在格子内为 0。 */
export function distanceToNodeAabb(x: number, z: number, node: HarvestableNode): number {
  const minX = node.gx;
  const maxX = node.gx + node.w;
  const minZ = node.gz;
  const maxZ = node.gz + node.d;
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
  return Math.hypot(dx, dz);
}

/** 找最近的、在采集范围内且未枯竭的节点。 */
export function findHarvestTarget(
  x: number,
  z: number,
  nodes: readonly HarvestableNode[],
  range = HARVEST_RANGE,
): HarvestableNode | undefined {
  let best: HarvestableNode | undefined;
  let bestDistance = Infinity;
  for (const node of nodes) {
    if (node.depleted || node.amount <= 0) continue;
    const distance = distanceToNodeAabb(x, z, node);
    if (distance <= range && distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best;
}

/** 采集中间状态：锁定一个节点后不会自动切换。 */
export interface HarvestState {
  nodeId: number | null;
  elapsed: number;
}

export interface HarvestTick {
  readonly status: 'idle' | 'progress' | 'completed' | 'cancelled';
  readonly progress: number;
}

export function createHarvestState(): HarvestState {
  return { nodeId: null, elapsed: 0 };
}

/** 开始采集（锁定目标）。 */
export function startHarvest(state: HarvestState, nodeId: number): void {
  state.nodeId = nodeId;
  state.elapsed = 0;
}

/**
 * 推进采集：
 * - 不在范围内或节点不可用 => 取消（不产出）；
 * - 计时到 HARVEST_DURATION => 完成；
 * - 期间不会切换节点。
 */
export function advanceHarvest(
  state: HarvestState,
  delta: number,
  stillInRange: boolean,
  nodeAlive: boolean,
): HarvestTick {
  if (state.nodeId === null) return { status: 'idle', progress: 0 };
  if (!stillInRange || !nodeAlive) {
    state.nodeId = null;
    state.elapsed = 0;
    return { status: 'cancelled', progress: 0 };
  }
  state.elapsed += Math.max(0, delta);
  if (state.elapsed >= HARVEST_DURATION) {
    state.nodeId = null;
    state.elapsed = 0;
    return { status: 'completed', progress: 1 };
  }
  return { status: 'progress', progress: state.elapsed / HARVEST_DURATION };
}

/** 与运行时节点结构兼容的类型别名。 */
export type RuntimeHarvestNode = ResourceNode;
/**
 * 采集发放的唯一入口：只发放资源系统实际扣除的数量。
 * 未成功扣除（undefined 或 deducted <= 0）时返回 0，不改变库存。
 */
export function awardHarvest(
  inventory: InventoryService,
  result: HarvestResult | undefined,
): number {
  if (result === undefined || result.deducted <= 0) return 0;
  return inventory.add(ITEM_IDS.IRON_ORE, result.deducted);
}
