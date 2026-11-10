import type { EntityHandle } from '@forgeax/engine/ecs';
import {
  cellsOf,
  createPlacement,
  type Cell,
  type Placement,
} from '../grid/grid.ts';

/** 首期只有铁矿石一种资源。 */
export type ResourceType = 'iron-ore';

/**
 * 每个矿点的初始储量；四处共 240（M2.0-P2-E3 资源平衡）。
 *
 * 来源：docs/m20/P2-E0-DEMO-PROGRESSION.md §10.2 的供给结论（原 4×20=80 不足，
 * 完整生产链需要约 170–210 铁锭当量）。实际核算见 P2-E3 平衡报告：
 * 科技交付 106 + 自建设备 ≈50 + 容错 ≈15 ≈ 171 铁锭当量（含起步包抵扣）。
 * 240 > 171 留约 40% 余量，且单矿点 60 仍低于 3D 两位数字 HUD 的 99 上限。
 */
export const IRON_ORE_MAX_AMOUNT = 60;

/** 资源节点的静态定义（锚点是最小角整数格）。 */
export interface ResourceNodeSpec {
  readonly id: number;
  readonly type: ResourceType;
  readonly displayName: string;
  readonly gx: number;
  readonly gz: number;
  readonly w: number;
  readonly d: number;
}

/**
 * 四处铁矿露头（2×2 格）：
 * - A、B 保留 M1.5 原坐标与行为；
 * - C、D 位于 M1.6 新增区域（旧 20×20 之外），四象限各一处；
 * - 均避开玩家出生格 (-2,2)、固定平台 x[0,8)/z[2,8) 与楼梯 x[-4,0)/z[3,4)；
 * - 彼此不重叠，总储量 4×60=240（M2.0-P2-E3 平衡调整），单点 60 仍低于 3D HUD
 *   两位数字上限 99。
 */
export const IRON_ORE_NODES: readonly ResourceNodeSpec[] = [
  { id: 1, type: 'iron-ore', displayName: 'Iron Ore Node A', gx: -5, gz: 4, w: 2, d: 2 },
  { id: 2, type: 'iron-ore', displayName: 'Iron Ore Node B', gx: 4, gz: -5, w: 2, d: 2 },
  { id: 3, type: 'iron-ore', displayName: 'Iron Ore Node C', gx: -13, gz: -7, w: 2, d: 2 },
  { id: 4, type: 'iron-ore', displayName: 'Iron Ore Node D', gx: 10, gz: 10, w: 2, d: 2 },
];

/** 节点在网格上的 Placement（rotation 固定 0，资源节点不旋转）。 */
export function nodePlacement(node: ResourceNodeSpec): Placement {
  return createPlacement(node.gx, node.gz, node.w, node.d, 0);
}

/** 某格是否落在节点占地内（不看枯竭状态）。 */
export function nodeContainsCell(
  node: { readonly gx: number; readonly gz: number; readonly w: number; readonly d: number },
  cell: Cell,
): boolean {
  return cell.gx >= node.gx && cell.gx < node.gx + node.w
    && cell.gz >= node.gz && cell.gz < node.gz + node.d;
}

/** 节点是否仍然阻挡建筑：未枯竭且格在占地内。 */
export function nodeBlocksCell(
  node: { readonly gx: number; readonly gz: number; readonly w: number; readonly d: number; readonly depleted?: boolean },
  cell: Cell,
): boolean {
  return !(node.depleted ?? false) && nodeContainsCell(node, cell);
}

/** 是否被任一“未枯竭”资源节点阻挡（纯函数，供运行时与测试共用）。 */
export function isCellBlockedBy(
  nodes: readonly { readonly gx: number; readonly gz: number; readonly w: number; readonly d: number; readonly depleted?: boolean }[],
  cell: Cell,
): boolean {
  return nodes.some((node) => nodeBlocksCell(node, cell));
}

/** 收集所有未枯竭节点占据的格（用于初始化/测试；运行时用 isCellBlockedBy 动态判断）。 */
export function resourceBlockedCells(
  nodes: readonly { readonly gx: number; readonly gz: number; readonly w: number; readonly d: number; readonly depleted?: boolean }[] = IRON_ORE_NODES,
): ReadonlySet<string> {
  const cells = new Set<string>();
  for (const node of nodes) {
    if (node.depleted) continue;
    for (const cell of cellsOf(nodePlacement(node as ResourceNodeSpec))) {
      cells.add(`${cell.gx},${cell.gz}`);
    }
  }
  return cells;
}

/** 运行期节点：储量、枯竭状态与实体句柄。 */
export interface ResourceNode extends ResourceNodeSpec {
  readonly entity: EntityHandle;
  amount: number;
  depleted: boolean;
}

/** 一次采集扣除的明确结果：实际扣了多少、剩多少。 */
export interface HarvestResult {
  readonly deducted: number;
  readonly remaining: number;
}

/** 资源节点服务：资源层与建造/采集层之间的唯一接口。 */
export interface ResourceNodesService {
  readonly nodes: readonly ResourceNode[];
  /** 该格是否被未枯竭的矿点阻挡（枯竭后立即解除）。 */
  isCellBlocked(cell: Cell): boolean;
  /** 未被枯竭、覆盖该格的节点。 */
  nodeAtCell(cell: Cell): ResourceNode | undefined;
  /** 扣减储量并返回明确的扣除结果；节点已枯竭/不存在时返回 undefined。 */
  harvest(nodeId: number, amount?: number): HarvestResult | undefined;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    resourceNodes: ResourceNodesService;
  }
}