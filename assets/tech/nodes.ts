/**
 * M2.0-P2-E1 科技树聚合数据与只读索引（纯数据，零引擎依赖）。
 *
 * 唯一数据源：nodes-stage1/2/3。禁止在别处复制节点/前置/交付表。
 */
import { TECH_NODES_STAGE1 } from './nodes-stage1.ts';
import { TECH_NODES_STAGE2 } from './nodes-stage2.ts';
import { TECH_NODES_STAGE3 } from './nodes-stage3.ts';
import type {
  TechCapabilityId,
  TechNodeDef,
  TechNodeId,
  TechRoute,
  TechStage,
} from './types.ts';

/** E0 设计确定的正式节点数量（数据完整性测试用）。 */
export const TECH_NODE_COUNT = 12;

export const TECH_STAGE_LABELS: Readonly<Record<TechStage, string>> = Object.freeze({
  1: '基础工业',
  2: '机械化生产',
  3: '初级自动化工业',
});

export const TECH_ROUTE_LABELS: Readonly<Record<TechRoute, string>> = Object.freeze({
  power: '机械动力',
  industry: '工业制造',
  cross: '交叉技术',
});

/** 全部正式节点（顺序 = UI 展示顺序：阶段 1 → 2 → 3）。 */
export const TECH_NODES: readonly TechNodeDef[] = Object.freeze([
  ...TECH_NODES_STAGE1,
  ...TECH_NODES_STAGE2,
  ...TECH_NODES_STAGE3,
]);

const BY_ID = new Map<string, TechNodeDef>();
for (const node of TECH_NODES) BY_ID.set(node.id, node);

/** 按 ID 取节点；未知返回 undefined。 */
export function techNodeById(id: string): TechNodeDef | undefined {
  return BY_ID.get(id);
}

/** 全部节点 ID（稳定顺序）。 */
export function techNodeIds(): readonly TechNodeId[] {
  return TECH_NODES.map((node) => node.id);
}

/** 某节点的直接后继（谁以它为前置）。 */
export function techChildrenOf(id: string): readonly TechNodeDef[] {
  return TECH_NODES.filter((node) => node.requires.includes(id as TechNodeId));
}

/** 是否满足全部前置（前置集合中每个节点都已完成）。 */
export function prerequisitesSatisfied(
  node: TechNodeDef,
  completed: ReadonlySet<string>,
): boolean {
  return node.requires.every((requirement) => completed.has(requirement));
}

/** 前置闭包（含自身），用于 UI 展示与环检测辅助。 */
export function techClosureOf(id: string): readonly TechNodeId[] {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const requirement of BY_ID.get(current)?.requires ?? []) stack.push(requirement);
  }
  return [...seen] as TechNodeId[];
}

/** 交付材料总量（件），用于 UI 进度条。 */
export function totalCostCount(node: TechNodeDef): number {
  return node.cost.reduce((sum, entry) => sum + entry.count, 0);
}

/** 节点解锁的能力 ID 列表（只读派生）。 */
export function capabilitiesOf(nodes: readonly TechNodeDef[] = TECH_NODES): readonly TechCapabilityId[] {
  const ids: TechCapabilityId[] = [];
  for (const node of nodes) {
    for (const unlock of node.unlocks) {
      if (unlock.kind === 'capability') ids.push(unlock.id);
    }
  }
  return ids;
}
