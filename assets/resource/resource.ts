import type { EntityHandle } from '@forgeax/engine/ecs';
import {
  cellsOf,
  createPlacement,
  type Cell,
  type Placement,
} from '../grid/grid.ts';

/** 首期只有铁矿石一种资源。 */
export type ResourceType = 'iron-ore';

/** 每个矿点的初始储量；两处共 40。 */
export const IRON_ORE_MAX_AMOUNT = 20;

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
 * 两处铁矿露头（2×2 格），都在初始相机视野内、避开玩家出生格 (-2,2)、
 * 彼此不重叠，并给中央建造演示区留出空间。
 */
export const IRON_ORE_NODES: readonly ResourceNodeSpec[] = [
  { id: 1, type: 'iron-ore', displayName: 'Iron Ore Node A', gx: -5, gz: 4, w: 2, d: 2 },
  { id: 2, type: 'iron-ore', displayName: 'Iron Ore Node B', gx: 4, gz: -5, w: 2, d: 2 },
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