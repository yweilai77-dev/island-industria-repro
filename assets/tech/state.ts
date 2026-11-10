/**
 * M2.0-P2-E1 科技状态机与交付事务（纯函数，零引擎依赖）。
 *
 * 核心规则（任务书 §二 E1-B）：
 * - 状态全部派生：locked/available/researching/completed 由前置闭包 + 已交付计数算出；
 * - 只持久化 delivered / unlocked / trackedId / mode，不保存冗余状态；
 * - 交付按「单物品整批」原子处理：先全量校验 → 扣库存 → 写进度；
 *   任一失败都不改状态、不扣库存（`submit` 永不半途扣料）；
 * - 已提交材料不可返还；同一材料不超过需求；已完成节点拒绝再次提交。
 */
import { getItemDefinition, type ItemId } from '../items/items.ts';
import { TECH_NODES, TECH_NODE_COUNT, prerequisitesSatisfied, techNodeById } from './nodes.ts';
import type {
  TechCostEntry,
  TechInventoryPort,
  TechNodeDef,
  TechNodeId,
  TechNodeSnapshot,
  TechNodeStatus,
  TechProgressionMode,
  TechProjectCompletionGuard,
  TechSnapshot,
  TechState,
  TechSubmitCode,
  TechSubmitResult,
} from './types.ts';

export const TECH_STATE_VERSION = 1 as const;

/** 新会话默认状态：玩家模式、无交付、无追踪。 */
export function createTechState(mode: TechProgressionMode = 'player'): TechState {
  return Object.freeze({
    version: TECH_STATE_VERSION,
    mode,
    delivered: Object.freeze({}),
    unlocked: Object.freeze([]),
    trackedId: null,
  });
}

export function completedSetOf(state: TechState): ReadonlySet<string> {
  return new Set(state.unlocked);
}

/** 某节点某物品已交付件数。 */
export function deliveredOf(state: TechState, nodeId: string, itemId: string): number {
  return state.delivered[nodeId]?.[itemId] ?? 0;
}

/** 节点状态（派生；不存储）。 */
export function statusOf(node: TechNodeDef, state: TechState): TechNodeStatus {
  const completed = completedSetOf(state);
  if (completed.has(node.id)) return 'completed';
  if (!prerequisitesSatisfied(node, completed)) return 'locked';
  const delivered = state.delivered[node.id] ?? {};
  return Object.values(delivered).some((count) => count > 0) ? 'researching' : 'available';
}

/** 还缺哪些材料、各缺多少（已完成节点返回空数组）。 */
export function remainingOf(node: TechNodeDef, state: TechState): readonly TechCostEntry[] {
  if (completedSetOf(state).has(node.id)) return [];
  const remaining: TechCostEntry[] = [];
  for (const entry of node.cost) {
    const done = deliveredOf(state, node.id, entry.itemId);
    if (done < entry.count) remaining.push({ itemId: entry.itemId, count: entry.count - done });
  }
  return remaining;
}

/** 已交付件数合计（进度条用）。 */
export function deliveredTotalOf(node: TechNodeDef, state: TechState): number {
  let total = 0;
  for (const entry of node.cost) total += Math.min(entry.count, deliveredOf(state, node.id, entry.itemId));
  return total;
}

/** 单个节点的只读快照。 */
export function nodeSnapshotOf(node: TechNodeDef, state: TechState): TechNodeSnapshot {
  const delivered: Record<string, number> = {};
  for (const entry of node.cost) delivered[entry.itemId] = deliveredOf(state, node.id, entry.itemId);
  return {
    id: node.id,
    name: node.name,
    stage: node.stage,
    route: node.route,
    status: statusOf(node, state),
    requires: node.requires,
    cost: node.cost,
    delivered,
    unlocks: node.unlocks,
  };
}

/** 科技系统只读快照（唯一 GameRead 的 tech 字段直接用它）。 */
export function techSnapshotOf(state: TechState): TechSnapshot {
  return {
    mode: state.mode,
    nodes: TECH_NODES.map((node) => nodeSnapshotOf(node, state)),
    unlocked: [...state.unlocked],
    trackedId: state.trackedId,
  };
}

/** 全量校验一次交付请求；返回失败码或可执行计划。 */
function validateSubmit(
  state: TechState,
  nodeId: string,
  itemId: string,
  count: number,
  inventory: TechInventoryPort,
): { ok: true; node: TechNodeDef; remaining: number } | { ok: false; result: TechSubmitResult } {
  const fail = (code: TechSubmitCode): { ok: false; result: TechSubmitResult } => ({
    ok: false,
    result: { ok: false, code, nodeId, itemId },
  });
  const node = techNodeById(nodeId);
  if (node === undefined) return fail('unknown-node');
  const status = statusOf(node, state);
  if (status === 'completed') return fail('completed');
  if (status === 'locked') return fail('locked');
  if (!Number.isInteger(count) || count <= 0) return fail('invalid-count');
  if (getItemDefinition(itemId as ItemId) === undefined) return fail('unknown-item');
  const cost = node.cost.find((entry) => entry.itemId === itemId);
  if (cost === undefined) return fail('not-required');
  const remaining = cost.count - deliveredOf(state, node.id, itemId);
  if (count > remaining) return fail('exceeds-remaining');
  if (!inventory.has(itemId as ItemId, count)) return fail('insufficient-items');
  return { ok: true, node, remaining };
}

/** 该节点是否是「终局项目」节点（unlocks 里含 project）。 */
export function isProjectNode(node: TechNodeDef): boolean {
  return node.unlocks.some((unlock) => unlock.kind === 'project');
}

/** 节点成本项是否已全部交付（只看 TechState.delivered，不动库存）。 */
export function costFullyDelivered(node: TechNodeDef, state: TechState): boolean {
  return node.cost.every((entry) => deliveredOf(state, node.id, entry.itemId) >= entry.count);
}

/** 还差多少件才交齐（人话，供 UI/门控 blockers）。 */
export function missingDeliveryBlockers(node: TechNodeDef, state: TechState): readonly string[] {
  const blockers: string[] = [];
  for (const entry of node.cost) {
    const done = deliveredOf(state, node.id, entry.itemId);
    if (done >= entry.count) continue;
    const name = getItemDefinition(entry.itemId)?.name ?? entry.itemId;
    blockers.push(`缺少 ${name} ×${entry.count - done}`);
  }
  return blockers;
}

/**
 * 把一次交付应用到状态（纯函数；调用方已确认库存可扣）。
 *
 * 终局项目节点**永不**因为材料交齐而直接解锁：它的完成必须由
 * `completeProjectNode` 在「材料已齐 + 完成守卫放行」后显式提交。
 * 这样「运行证明」与「物品交付」是两个独立条件，谁也不能替谁开路。
 */
function applyDelivery(
  state: TechState,
  node: TechNodeDef,
  itemId: string,
  count: number,
): TechState {
  const nodeDelivered: Record<string, number> = { ...(state.delivered[node.id] ?? {}) };
  nodeDelivered[itemId] = (nodeDelivered[itemId] ?? 0) + count;
  const delivered = { ...state.delivered, [node.id]: nodeDelivered };
  const complete = node.cost.every((entry) => (nodeDelivered[entry.itemId] ?? 0) >= entry.count);
  const unlocked = complete && !isProjectNode(node) && !state.unlocked.includes(node.id)
    ? [...state.unlocked, node.id]
    : [...state.unlocked];
  return { ...state, delivered, unlocked };
}

/** 交付结果：材料已交齐但项目节点还需 completeProjectNode（pendingVerification）。 */
function deliveryResultOf(
  node: TechNodeDef,
  state: TechState,
  next: TechState,
  base: TechSubmitResult,
): TechSubmitResult {
  const completedNow = next.unlocked.length > state.unlocked.length;
  if (completedNow) return { ...base, completed: true };
  if (isProjectNode(node) && costFullyDelivered(node, next) && !next.unlocked.includes(node.id)) {
    return { ...base, completed: false, pendingVerification: true };
  }
  return { ...base, completed: false };
}

/**
 * 逐项交付：一次只交一种材料。
 * 现金：全量校验 → `inventory.remove` → 写进度。remove 失败则状态不变。
 */
export function submit(
  state: TechState,
  nodeId: string,
  itemId: string,
  count: number,
  inventory: TechInventoryPort,
): { readonly state: TechState; readonly result: TechSubmitResult } {
  const checked = validateSubmit(state, nodeId, itemId, count, inventory);
  if (!checked.ok) return { state, result: checked.result };
  if (!inventory.remove(itemId as ItemId, count)) {
    return {
      state,
      result: { ok: false, code: 'insufficient-items', nodeId, itemId },
    };
  }
  const next = applyDelivery(state, checked.node, itemId, count);
  return {
    state: next,
    result: deliveryResultOf(checked.node, state, next, { ok: true, code: 'ok', nodeId, itemId, count }),
  };
}

/**
 * 一键交齐：多物品补偿事务。
 * 先逐项 `has` 预检，再逐项 `remove`；任一步失败按逆序 `add` 回滚，状态不变。
 */
export function submitAll(
  state: TechState,
  nodeId: string,
  inventory: TechInventoryPort,
): { readonly state: TechState; readonly result: TechSubmitResult; readonly submitted: readonly TechCostEntry[] } {
  const node = techNodeById(nodeId);
  const fail = (code: TechSubmitCode): { state: TechState; result: TechSubmitResult; submitted: readonly TechCostEntry[] } => ({
    state,
    result: { ok: false, code, nodeId },
    submitted: [],
  });
  if (node === undefined) return fail('unknown-node');
  const status = statusOf(node, state);
  if (status === 'completed') return fail('completed');
  if (status === 'locked') return fail('locked');
  const todo = remainingOf(node, state);
  if (todo.length === 0) {
    // 项目节点：材料已交齐但未完成 → 交给 completeProjectNode（幂等告知，不重复扣料）。
    if (isProjectNode(node) && costFullyDelivered(node, state) && !state.unlocked.includes(node.id)) {
      return { state, result: { ok: true, code: 'ok', nodeId, pendingVerification: true }, submitted: [] };
    }
    return fail('completed');
  }
  for (const entry of todo) {
    if (!inventory.has(entry.itemId, entry.count)) return fail('insufficient-items');
  }
  const removed: TechCostEntry[] = [];
  for (const entry of todo) {
    if (!inventory.remove(entry.itemId, entry.count)) {
      for (let index = removed.length - 1; index >= 0; index -= 1) {
        inventory.add(removed[index].itemId, removed[index].count);
      }
      return fail('insufficient-items');
    }
    removed.push(entry);
  }
  let next = state;
  for (const entry of todo) next = applyDelivery(next, node, entry.itemId, entry.count);
  return {
    state: next,
    result: deliveryResultOf(node, state, next, { ok: true, code: 'ok', nodeId }),
    submitted: todo,
  };
}

/**
 * 终局项目节点的**唯一**完成路径（任务书 §五 C3）。
 *
 * 要求三件事同时成立，否则返回错误码且状态不变：
 * 1. 该节点确实解锁 `{ kind: 'project' }`（不是项目节点返回 not-required）；
 * 2. 全部成本项 `delivered >= count`（只看 TechState.delivered，**绝不动库存**）；
 * 3. 完成守卫放行（guard 返回 null；未设置 guard 视为放行）。
 *
 * 幂等：节点已完成时直接返回 `{ ok: true, completed: true }`，不重复追加 unlocked、不扣任何材料。
 */
export function completeProjectNode(
  state: TechState,
  nodeId: string,
  guard: TechProjectCompletionGuard | null = null,
): { readonly state: TechState; readonly result: TechSubmitResult } {
  const fail = (code: TechSubmitCode, blockers?: readonly string[]): { state: TechState; result: TechSubmitResult } => ({
    state,
    result: { ok: false, code, nodeId, ...(blockers === undefined ? {} : { blockers }) },
  });
  const node = techNodeById(nodeId);
  if (node === undefined) return fail('unknown-node');
  if (!isProjectNode(node)) return fail('not-required');
  if (state.unlocked.includes(node.id)) {
    return { state, result: { ok: true, code: 'ok', nodeId, completed: true } };
  }
  if (statusOf(node, state) === 'locked') return fail('locked');
  if (!costFullyDelivered(node, state)) return fail('not-delivered', missingDeliveryBlockers(node, state));
  const blockers: string[] = [];
  if (guard !== null) {
    for (const unlock of node.unlocks) {
      if (unlock.kind !== 'project') continue;
      let reason: string | null = null;
      try {
        reason = guard(unlock.id);
      } catch (error) {
        reason = '完成守卫异常：' + (error instanceof Error ? error.message : String(error));
      }
      if (reason !== null) blockers.push(reason);
    }
  }
  if (blockers.length > 0) return fail('project-blocked', blockers);
  return {
    state: { ...state, unlocked: [...state.unlocked, node.id] },
    result: { ok: true, code: 'ok', nodeId, completed: true },
  };
}

/** 设置/清除追踪目标；未知节点返回 false。 */
export function trackNode(state: TechState, nodeId: string | null): { readonly state: TechState; readonly ok: boolean } {
  if (nodeId !== null && techNodeById(nodeId) === undefined) return { state, ok: false };
  return { state: { ...state, trackedId: nodeId as TechNodeId | null }, ok: true };
}

/** 序列化（纯 JSON；这里做防御性拷贝，防止外部改到内部结构）。 */
export function serializeTechState(state: TechState): TechState {
  const delivered: Record<string, Record<string, number>> = {};
  for (const [nodeId, entries] of Object.entries(state.delivered)) {
    delivered[nodeId] = { ...entries };
  }
  return {
    version: TECH_STATE_VERSION,
    mode: state.mode,
    delivered,
    unlocked: [...state.unlocked],
    trackedId: state.trackedId,
  };
}

export interface TechRestoreResult {
  readonly state: TechState;
  readonly repaired: boolean;
  readonly issues: readonly string[];
}

/**
 * 从不可信数据恢复状态（存档/测试）：
 * - 未知节点、未知物品、非正数、超出需求的计数逐条丢弃并记录；
 * - 已解锁集合按「前置闭包」修复：前置未完成的节点会被降级（记录修复）；
 * - 版本不符时只保留可识别字段。
 */
export function restoreTechState(raw: unknown): TechRestoreResult {
  const issues: string[] = [];
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const mode: TechProgressionMode = source.mode === 'legacy' ? 'legacy' : 'player';
  if (source.version !== TECH_STATE_VERSION) issues.push(`unsupported state version: ${String(source.version)}`);

  const delivered: Record<string, Record<string, number>> = {};
  const rawDelivered = (typeof source.delivered === 'object' && source.delivered !== null
    ? source.delivered : {}) as Record<string, unknown>;
  for (const [nodeId, rawEntries] of Object.entries(rawDelivered)) {
    const node = techNodeById(nodeId);
    if (node === undefined) { issues.push(`unknown node in save: ${nodeId}`); continue; }
    if (typeof rawEntries !== 'object' || rawEntries === null) { issues.push(`invalid delivered entry: ${nodeId}`); continue; }
    const entries: Record<string, number> = {};
    for (const [itemId, rawCount] of Object.entries(rawEntries as Record<string, unknown>)) {
      const cost = node.cost.find((entry) => entry.itemId === itemId);
      if (cost === undefined) { issues.push(`unknown cost item ${itemId} in ${nodeId}`); continue; }
      const count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? Math.floor(rawCount) : 0;
      const clamped = Math.max(0, Math.min(cost.count, count));
      if (clamped !== count) issues.push(`clamped ${nodeId}/${itemId}: ${String(rawCount)} -> ${clamped}`);
      if (clamped > 0) entries[itemId] = clamped;
    }
    if (Object.keys(entries).length > 0) delivered[nodeId] = entries;
  }

  const rawUnlocked = Array.isArray(source.unlocked) ? source.unlocked : [];
  const unlocked: string[] = [];
  for (const id of rawUnlocked) {
    if (typeof id !== 'string' || techNodeById(id) === undefined) { issues.push(`unknown unlocked node: ${String(id)}`); continue; }
    if (!unlocked.includes(id)) unlocked.push(id);
  }

  // 前置闭包修复：反复剔除「前置未完成」的已解锁节点，直到稳定。
  let changed = true;
  while (changed) {
    changed = false;
    const completed = new Set(unlocked);
    for (const node of TECH_NODES) {
      if (!completed.has(node.id)) continue;
      if (node.requires.every((requirement) => completed.has(requirement))) continue;
      unlocked.splice(unlocked.indexOf(node.id), 1);
      issues.push(`locked node without prerequisites removed: ${node.id}`);
      changed = true;
      break;
    }
  }

  const tracked = typeof source.trackedId === 'string' && techNodeById(source.trackedId) !== undefined
    ? source.trackedId as TechNodeId : null;
  if (source.trackedId !== undefined && source.trackedId !== null && tracked === null) {
    issues.push(`unknown tracked node: ${String(source.trackedId)}`);
  }

  const state: TechState = {
    version: TECH_STATE_VERSION,
    mode,
    delivered,
    unlocked: unlocked as TechNodeId[],
    trackedId: tracked,
  };
  return { state, repaired: issues.length > 0, issues };
}

/** 数据完整性的入口（tech.pack 启动时调用；测试可直接复用）。 */
export function techNodeCount(): number {
  return TECH_NODE_COUNT;
}
