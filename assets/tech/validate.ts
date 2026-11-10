/**
 * M2.0-P2-E1 科技树数据校验器（纯函数，零引擎依赖）。
 *
 * 校验内容（任务书 §二 E1-A）：
 * - 稳定 ID 格式与唯一性；
 * - 前置存在、无自依赖、无循环依赖；
 * - 阶段不跳跃（阶段 N 的前置只能是阶段 N-1 或 N）；
 * - 交付物品存在、数量为正整数、同一节点不重复计同一种物品；
 * - 解锁目标存在（配方/机器/接口盒/结构模块），且同一目标不被两个节点重复解锁；
 * - 节点数量与 E0 设计一致（12）。
 */
import type { TechNodeDef } from './types.ts';
import { TECH_ID_PATTERN } from './types.ts';

export type TechValidationCode =
  | 'invalid-id'
  | 'duplicate-id'
  | 'node-count'
  | 'missing-stage'
  | 'unknown-precondition'
  | 'self-dependency'
  | 'dependency-cycle'
  | 'stage-jump'
  | 'invalid-cost'
  | 'unknown-item'
  | 'duplicate-cost-item'
  | 'duplicate-unlock'
  | 'unknown-unlock';

export interface TechValidationIssue {
  readonly code: TechValidationCode;
  readonly nodeId?: string;
  readonly detail: string;
}

/** 校验器需要问外部世界的存在性问题（不 import 引擎，便于单测注入假数据）。 */
export interface TechValidationResolvers {
  itemExists(id: string): boolean;
  recipeExists(id: string): boolean;
  partExists(id: string): boolean;
  portExists(id: string): boolean;
  structureExists(id: string): boolean;
}

/** 校验科技树；返回空数组表示通过。 */
export function validateTechTree(
  nodes: readonly TechNodeDef[],
  resolvers: TechValidationResolvers,
  expectedCount = 12,
): readonly TechValidationIssue[] {
  const issues: TechValidationIssue[] = [];
  const byId = new Map<string, TechNodeDef>();
  const seenUnlocks = new Map<string, string>();

  if (nodes.length !== expectedCount) {
    issues.push({
      code: 'node-count',
      detail: `expected ${expectedCount} nodes, received ${nodes.length}`,
    });
  }

  const stages = new Set<number>();
  for (const node of nodes) {
    stages.add(node.stage);
    if (!TECH_ID_PATTERN.test(node.id)) {
      issues.push({ code: 'invalid-id', nodeId: node.id, detail: `id does not match TECH_ID_PATTERN: ${node.id}` });
    }
    if (byId.has(node.id)) {
      issues.push({ code: 'duplicate-id', nodeId: node.id, detail: `duplicate tech node id: ${node.id}` });
      continue;
    }
    byId.set(node.id, node);
  }
  for (const stage of [1, 2, 3] as const) {
    if (!stages.has(stage)) {
      issues.push({ code: 'missing-stage', detail: `stage ${stage} has no tech node` });
    }
  }

  for (const node of nodes) {
    // 前置：存在、非自依赖、阶段不跳跃
    const seenRequirements = new Set<string>();
    for (const requirement of node.requires) {
      if (requirement === node.id) {
        issues.push({ code: 'self-dependency', nodeId: node.id, detail: 'node requires itself' });
        continue;
      }
      if (seenRequirements.has(requirement)) {
        issues.push({ code: 'unknown-precondition', nodeId: node.id, detail: `duplicate prerequisite: ${requirement}` });
      }
      seenRequirements.add(requirement);
      const target = byId.get(requirement);
      if (target === undefined) {
        issues.push({ code: 'unknown-precondition', nodeId: node.id, detail: `unknown prerequisite: ${requirement}` });
        continue;
      }
      const allowed = node.stage === 1 ? [1] : [node.stage - 1, node.stage];
      if (!allowed.includes(target.stage)) {
        issues.push({
          code: 'stage-jump',
          nodeId: node.id,
          detail: `stage ${node.stage} node requires stage ${target.stage} node ${target.id}`,
        });
      }
    }

    // 交付材料
    const seenItems = new Set<string>();
    for (const entry of node.cost) {
      if (!Number.isInteger(entry.count) || entry.count <= 0) {
        issues.push({ code: 'invalid-cost', nodeId: node.id, detail: `invalid count for ${entry.itemId}: ${entry.count}` });
      }
      if (seenItems.has(entry.itemId)) {
        issues.push({ code: 'duplicate-cost-item', nodeId: node.id, detail: `item listed twice: ${entry.itemId}` });
      }
      seenItems.add(entry.itemId);
      if (!resolvers.itemExists(entry.itemId)) {
        issues.push({ code: 'unknown-item', nodeId: node.id, detail: `unknown item id: ${entry.itemId}` });
      }
    }

    // 解锁目标
    for (const unlock of node.unlocks) {
      const key = `${unlock.kind}:${unlock.id}`;
      if (seenUnlocks.has(key)) {
        issues.push({
          code: 'duplicate-unlock',
          nodeId: node.id,
          detail: `${key} already unlocked by ${seenUnlocks.get(key)}`,
        });
      }
      seenUnlocks.set(key, node.id);
      const exists = unlock.kind === 'recipe' ? resolvers.recipeExists(unlock.id)
        : unlock.kind === 'machine' ? resolvers.partExists(unlock.id)
          : unlock.kind === 'port' ? resolvers.portExists(unlock.id)
            : unlock.kind === 'structure' ? resolvers.structureExists(unlock.id)
              : true;
      if (!exists) {
        issues.push({ code: 'unknown-unlock', nodeId: node.id, detail: `unknown ${unlock.kind} target: ${unlock.id}` });
      }
    }
  }

  issues.push(...detectCycles(nodes, byId));
  return issues;
}

/** 深度优先找环；每个环只报一次（按环上最小 ID 记录）。 */
function detectCycles(
  nodes: readonly TechNodeDef[],
  byId: ReadonlyMap<string, TechNodeDef>,
): readonly TechValidationIssue[] {
  const issues: TechValidationIssue[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const reported = new Set<string>();

  const visit = (id: string, path: readonly string[]): void => {
    const node = byId.get(id);
    if (node === undefined) return;
    const current = state.get(id);
    if (current === 'done') return;
    if (current === 'visiting') {
      const cycle = [...path.slice(path.indexOf(id)), id];
      const key = [...new Set(cycle)].sort().join('|');
      if (!reported.has(key)) {
        reported.add(key);
        issues.push({ code: 'dependency-cycle', nodeId: id, detail: `cycle: ${cycle.join(' -> ')}` });
      }
      return;
    }
    state.set(id, 'visiting');
    for (const requirement of node.requires) visit(requirement, [...path, id]);
    state.set(id, 'done');
  };

  for (const node of nodes) visit(node.id, []);
  return issues;
}

/** 断言校验通过；失败抛 RangeError（与工业层 assertStableId 的编程错误风格一致）。 */
export function assertValidTechTree(
  nodes: readonly TechNodeDef[],
  resolvers: TechValidationResolvers,
  expectedCount = 12,
): void {
  const issues = validateTechTree(nodes, resolvers, expectedCount);
  if (issues.length > 0) {
    throw new RangeError(`tech tree validation failed (\n${issues.map((issue) => `  [${issue.code}] ${issue.nodeId ?? '-'}: ${issue.detail}`).join('\n')}\n)`);
  }
}
