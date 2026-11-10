import type { UiGoalState } from '../game-ui-bridge/goal-view.ts';
import type {
  TechNodeSnapshot,
  TechNodeStatus,
  TechRoute,
  TechSnapshot,
  TechStage,
  TechUnlock,
} from '../tech/types.ts';
import { TECH_NODES, TECH_ROUTE_LABELS, TECH_STAGE_LABELS, techNodeById } from '../tech/nodes.ts';
import { getItemDefinition, type ItemId } from '../items/items.ts';
import { MACHINE_RECIPES } from '../production/recipes.ts';
import { MECHANICAL_PART_DEFS } from '../mechanical/parts.ts';
import { PORT_MODULES } from '../industrial/port-module.ts';
import type { PartId } from '../mechanical/parts.ts';

/**
 * P2-E2 科技页/追踪卡的纯视图模型（零 DOM，可在 node 环境单测）。
 *
 * 边界（任务书 §三 A2–A4）：
 * - 状态/交付计数/前置/成本/解锁全部来自引擎快照 `tech`，UI 不自己推导进度、不改状态；
 * - 只有「说明/目的」这类静态文案来自 `tech/nodes.ts`（与快照同源，快照本身不带描述字段）；
 * - 解锁目标的中文名来自配方/零件/接口盒目录，不手写真名清单。
 */

export const TECH_STATUS_LABELS: Readonly<Record<TechNodeStatus, string>> = Object.freeze({
  locked: '未解锁',
  available: '可研究',
  researching: '研究中',
  completed: '已完成',
});

/** 四态双编码里的图形编码（颜色之外的第二种编码）。 */
export const TECH_STATUS_ICONS: Readonly<Record<TechNodeStatus, string>> = Object.freeze({
  locked: '—',
  available: '○',
  researching: '◐',
  completed: '✓',
});

export type TechStatusTone = 'muted' | 'info' | 'accent' | 'ok';

export const TECH_STATUS_TONES: Readonly<Record<TechNodeStatus, TechStatusTone>> = Object.freeze({
  locked: 'muted',
  available: 'info',
  researching: 'accent',
  completed: 'ok',
});

const STATUSES: readonly TechNodeStatus[] = ['locked', 'available', 'researching', 'completed'];
const ROUTES: readonly TechRoute[] = ['power', 'industry', 'cross'];
const STAGES: readonly TechStage[] = [1, 2, 3];

export const CAPABILITY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'port-input-install': '输入接口盒安装（T 键）',
  'port-output-install': '输出接口盒安装（O 键）',
  'material-link': '物料连接（J/H 键）',
  'split-merge': '分流/合流盒安装（K/L 键）',
  assembly: '组合机械结构模式（P 键）',
  'line-diagnostics': '产线诊断视图',
});

const UNLOCK_KIND_LABELS: Readonly<Record<TechUnlock['kind'], string>> = Object.freeze({
  recipe: '配方',
  machine: '机器',
  port: '接口盒',
  structure: '结构模块',
  capability: '能力',
  project: '终局项目',
});

const RECIPE_LABELS = new Map<string, string>();
for (const recipes of Object.values(MACHINE_RECIPES)) {
  for (const recipe of recipes ?? []) RECIPE_LABELS.set(recipe.id, recipe.label);
}

const PORT_LABELS = new Map<string, string>(PORT_MODULES.map((module) => [module.id, module.label]));

export interface TechPrereqRow {
  readonly id: string;
  readonly name: string;
  readonly status: TechNodeStatus;
  readonly statusLabel: string;
  readonly ok: boolean;
}

export interface TechMaterialRow {
  readonly itemId: string;
  readonly name: string;
  readonly delivered: number;
  readonly required: number;
  readonly remaining: number;
  /** 当前库存件数（来自背包快照，不是科技状态）。 */
  readonly have: number;
  /** 本次若「全部提交」还缺多少件（仅提示用）。 */
  readonly missing: number;
  readonly canSubmit: boolean;
}

export interface TechUnlockRow {
  readonly kind: TechUnlock['kind'];
  readonly kindLabel: string;
  readonly id: string;
  readonly label: string;
  readonly text: string;
}

export interface TechNodeView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly purpose: string;
  readonly stage: TechStage;
  readonly stageLabel: string;
  readonly route: TechRoute;
  readonly routeLabel: string;
  readonly status: TechNodeStatus;
  readonly statusLabel: string;
  readonly statusIcon: string;
  readonly statusTone: TechStatusTone;
  readonly requires: readonly TechPrereqRow[];
  readonly materials: readonly TechMaterialRow[];
  readonly unlocks: readonly TechUnlockRow[];
  readonly deliveredTotal: number;
  readonly requiredTotal: number;
  readonly progressPercent: number;
  /** 材料已齐但节点仍是 researching（T3.3 等待运行证明）。 */
  readonly awaitingProof: boolean;
  readonly completed: boolean;
  readonly tracked: boolean;
  readonly submitEnabled: boolean;
}

export interface TechStageGroup {
  readonly stage: TechStage;
  readonly label: string;
  readonly nodes: readonly TechNodeView[];
  readonly completedCount: number;
  readonly total: number;
}

export interface TechView {
  readonly mode: 'player' | 'legacy';
  readonly nodes: readonly TechNodeView[];
  readonly groups: readonly TechStageGroup[];
  readonly tracked: TechNodeView | null;
  readonly unlockedCount: number;
}

export interface TechTrackerMaterialRow {
  readonly itemId: string;
  readonly name: string;
  readonly have: number;
  readonly required: number;
  readonly delivered: number;
  readonly remaining: number;
  readonly complete: boolean;
}

export interface TechTrackerModel {
  readonly nodeId: string;
  readonly name: string;
  readonly status: TechNodeStatus;
  readonly statusLabel: string;
  readonly statusTone: TechStatusTone;
  readonly stageLabel: string;
  readonly routeLabel: string;
  readonly progressPercent: number;
  readonly deliveredTotal: number;
  readonly requiredTotal: number;
  readonly completed: boolean;
  readonly awaitingProof: boolean;
  readonly materials: readonly TechTrackerMaterialRow[];
  /** 未完成的前置节点名（按节点定义顺序）；空数组 = 前置已满足。 */
  readonly blockedBy: readonly string[];
}

export type UiHudMode = 'order' | 'tracker' | 'hint';

/** 订单未完成 → 订单 HUD；订单完成后 → 追踪卡（有追踪目标）或「Tab→科技」提示。 */
export function hudModeFor(goal: UiGoalState | null, view: TechView | null): UiHudMode {
  if (goal === null || goal.complete !== true) return 'order';
  return view?.tracked ? 'tracker' : 'hint';
}

export function itemLabel(itemId: string): string {
  return getItemDefinition(itemId as ItemId)?.name ?? itemId;
}

export function unlockLabel(unlock: TechUnlock): TechUnlockRow {
  const kindLabel = UNLOCK_KIND_LABELS[unlock.kind];
  let label = unlock.id;
  if (unlock.kind === 'recipe') label = RECIPE_LABELS.get(unlock.id) ?? unlock.id;
  else if (unlock.kind === 'machine') label = MECHANICAL_PART_DEFS[unlock.id as PartId]?.label ?? unlock.id;
  else if (unlock.kind === 'port') label = PORT_LABELS.get(unlock.id) ?? unlock.id;
  else if (unlock.kind === 'structure') label = unlock.id === 'structure.frame' ? '结构框架' : unlock.id;
  else if (unlock.kind === 'capability') label = CAPABILITY_LABELS[unlock.id] ?? unlock.id;
  else label = '联合工厂总成（Demo 终局）';
  return { kind: unlock.kind, kindLabel, id: unlock.id, label, text: kindLabel + ' · ' + label };
}

function clampCount(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function buildNodeView(
  node: TechNodeSnapshot,
  inventory: ReadonlyMap<string, number>,
  byId: ReadonlyMap<string, TechNodeSnapshot>,
  trackedId: string | null,
): TechNodeView {
  const definition = techNodeById(node.id);
  const materials: TechMaterialRow[] = node.cost.map((entry) => {
    const required = entry.count;
    const delivered = clampCount(node.delivered[entry.itemId] ?? 0, 0, required);
    const remaining = Math.max(0, required - delivered);
    const have = Math.max(0, inventory.get(entry.itemId) ?? 0);
    return {
      itemId: entry.itemId,
      name: itemLabel(entry.itemId),
      delivered,
      required,
      remaining,
      have,
      missing: Math.max(0, remaining - have),
      canSubmit: (node.status === 'available' || node.status === 'researching')
        && remaining > 0
        && have > 0,
    };
  });
  const requires: TechPrereqRow[] = node.requires.map((requirementId) => {
    const requirement = byId.get(requirementId);
    const status = requirement?.status ?? 'locked';
    return {
      id: requirementId,
      name: requirement?.name ?? requirementId,
      status,
      statusLabel: TECH_STATUS_LABELS[status],
      ok: status === 'completed',
    };
  });
  const deliveredTotal = materials.reduce((sum, row) => sum + row.delivered, 0);
  const requiredTotal = materials.reduce((sum, row) => sum + row.required, 0);
  const awaitingProof = node.status === 'researching' && requiredTotal > 0 && deliveredTotal >= requiredTotal;
  return {
    id: node.id,
    name: node.name,
    description: definition?.description ?? '',
    purpose: definition?.purpose ?? '',
    stage: node.stage,
    stageLabel: TECH_STAGE_LABELS[node.stage] ?? String(node.stage),
    route: node.route,
    routeLabel: TECH_ROUTE_LABELS[node.route] ?? node.route,
    status: node.status,
    statusLabel: TECH_STATUS_LABELS[node.status],
    statusIcon: TECH_STATUS_ICONS[node.status],
    statusTone: TECH_STATUS_TONES[node.status],
    requires,
    materials,
    unlocks: node.unlocks.map(unlockLabel),
    deliveredTotal,
    requiredTotal,
    progressPercent: requiredTotal > 0 ? Math.round((deliveredTotal / requiredTotal) * 100) : 0,
    awaitingProof,
    completed: node.status === 'completed',
    tracked: trackedId === node.id,
    submitEnabled: node.status === 'available' || node.status === 'researching',
  };
}

/** 引擎 tech 快照 + 背包库存 → 科技页视图；tech 为 null 时返回 null（页面显示初始化态）。 */
export function buildTechView(
  tech: TechSnapshot | null,
  inventory: ReadonlyMap<string, number> = new Map(),
): TechView | null {
  if (!tech) return null;
  const byId = new Map(tech.nodes.map((node) => [node.id, node]));
  const nodes = tech.nodes.map((node) => buildNodeView(node, inventory, byId, tech.trackedId));
  const groups = STAGES.map((stage) => {
    const groupNodes = nodes.filter((node) => node.stage === stage);
    return {
      stage,
      label: TECH_STAGE_LABELS[stage],
      nodes: groupNodes,
      completedCount: groupNodes.filter((node) => node.completed).length,
      total: groupNodes.length,
    };
  });
  const tracked = nodes.find((node) => node.id === tech.trackedId) ?? null;
  return {
    mode: tech.mode,
    nodes,
    groups,
    tracked,
    unlockedCount: nodes.filter((node) => node.completed).length,
  };
}

/** 追踪卡数据；没有追踪目标时返回 null（HUD 显示 Tab 提示）。 */
export function buildTechTracker(view: TechView | null): TechTrackerModel | null {
  const node = view?.tracked;
  if (!view || !node) return null;
  return {
    nodeId: node.id,
    name: node.name,
    status: node.status,
    statusLabel: node.statusLabel,
    statusTone: node.statusTone,
    stageLabel: node.stageLabel,
    routeLabel: node.routeLabel,
    progressPercent: node.progressPercent,
    deliveredTotal: node.deliveredTotal,
    requiredTotal: node.requiredTotal,
    completed: node.completed,
    awaitingProof: node.awaitingProof,
    materials: node.materials.map((row) => ({
      itemId: row.itemId,
      name: row.name,
      have: row.have,
      required: row.required,
      delivered: row.delivered,
      remaining: row.remaining,
      complete: row.remaining === 0,
    })),
    blockedBy: node.requires.filter((row) => !row.ok).map((row) => row.name),
  };
}

export interface TechErrorContext {
  readonly view?: TechView | null;
  readonly inventory?: ReadonlyMap<string, number>;
  readonly nodeId?: string | null;
  readonly itemId?: string | null;
  readonly count?: number | null;
  /** 终局运行证明的阻塞项（来自 EndgameSnapshot.blocks），用于 project-blocked 文案。 */
  readonly projectBlocks?: readonly string[];
  /** 引擎 error 消息原文（仅 command-failed 兜底使用）。 */
  readonly message?: string | null;
}

/** 错误码 → 清晰中文（错误码全部来自 tech 状态机/桥接层，UI 不改语义）。 */
export function describeTechError(code: string, context: TechErrorContext = {}): string {
  const node = context.nodeId ? context.view?.nodes.find((entry) => entry.id === context.nodeId) ?? null : null;
  const material = context.itemId ? node?.materials.find((row) => row.itemId === context.itemId) ?? null : null;
  const nodeName = node?.name ?? context.nodeId ?? '该节点';
  const itemName = material?.name ?? (context.itemId ? itemLabel(context.itemId) : '材料');
  switch (code) {
    case 'insufficient-items': {
      const have = material?.have ?? (context.itemId ? context.inventory?.get(context.itemId) ?? 0 : 0);
      const needed = Math.max(1, Math.floor(context.count ?? material?.remaining ?? 1));
      return '库存不足：' + itemName + ' 还缺 ' + Math.max(0, needed - have) + ' 件（本次需要 '
        + needed + ' 件，库存 ' + have + ' 件）';
    }
    case 'exceeds-remaining': {
      const remaining = material?.remaining ?? 0;
      return '数量超出剩余需求：' + itemName + ' 只需再交 ' + remaining + ' 件';
    }
    case 'locked': {
      const missing = node?.requires.filter((row) => !row.ok).map((row) => row.name) ?? [];
      return missing.length > 0
        ? '前置未完成：请先完成 ' + missing.join('、')
        : '该节点尚未解锁';
    }
    case 'completed':
      return nodeName + ' 已完成，材料不可重复提交';
    case 'not-delivered':
      return '终局交付尚未完成：请先在联合工厂页交齐全部成套设备';
    case 'project-blocked': {
      const blocks = context.projectBlocks?.filter((entry) => entry.length > 0) ?? [];
      return blocks.length > 0
        ? '运行证明未通过：' + blocks.join('；')
        : '运行证明未通过：请到联合工厂页开始并完成运行证明';
    }
    case 'unknown-node':
      return '未知科技节点：' + String(context.nodeId ?? '');
    case 'unknown-item':
      return '未知材料：' + String(context.itemId ?? '');
    case 'not-required':
      return itemName + ' 不是 ' + nodeName + ' 需要的材料';
    case 'invalid-count':
      return '提交数量不合法';
    case 'tech-unavailable':
      return '科技服务尚未就绪，请稍后再试';
    case 'project-unavailable':
      return '终局服务尚未就绪';
    case 'save-unavailable':
      return '存档服务尚未就绪';
    case 'unknown-command':
      return '界面与游戏版本不匹配（未知命令）';
    case 'command-failed':
      return '提交失败：' + (context.message ?? '未知错误');
    default:
      return '提交失败（' + code + '）';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseUnlock(raw: unknown): TechUnlock | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  const kinds: readonly TechUnlock['kind'][] = ['recipe', 'machine', 'port', 'structure', 'capability', 'project'];
  if (typeof raw.kind !== 'string' || !kinds.includes(raw.kind as TechUnlock['kind'])) return null;
  return { kind: raw.kind as TechUnlock['kind'], id: raw.id } as TechUnlock;
}

/** 前端防御式解析：任何结构不合法都返回 null（该字段回退为「服务未就绪」），不整包丢弃。 */
export function parseTechSnapshot(raw: unknown): TechSnapshot | null {
  if (!isRecord(raw)) return null;
  if (raw.mode !== 'player' && raw.mode !== 'legacy') return null;
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0 || raw.nodes.length > 32) return null;
  const nodes: TechNodeSnapshot[] = [];
  for (const rawNode of raw.nodes) {
    if (!isRecord(rawNode)) return null;
    if (typeof rawNode.id !== 'string' || typeof rawNode.name !== 'string') return null;
    if (!STAGES.includes(rawNode.stage as TechStage)) return null;
    if (!ROUTES.includes(rawNode.route as TechRoute)) return null;
    if (!STATUSES.includes(rawNode.status as TechNodeStatus)) return null;
    if (!Array.isArray(rawNode.requires) || !rawNode.requires.every((id) => typeof id === 'string')) return null;
    if (!Array.isArray(rawNode.cost)) return null;
    const cost: { itemId: ItemId; count: number }[] = [];
    for (const entry of rawNode.cost) {
      if (!isRecord(entry) || typeof entry.itemId !== 'string') return null;
      if (typeof entry.count !== 'number' || !Number.isFinite(entry.count) || entry.count <= 0) return null;
      cost.push({ itemId: entry.itemId as ItemId, count: Math.floor(entry.count) });
    }
    if (!isRecord(rawNode.delivered)) return null;
    const delivered: Record<string, number> = {};
    for (const [itemId, value] of Object.entries(rawNode.delivered)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
      delivered[itemId] = Math.floor(value);
    }
    if (!Array.isArray(rawNode.unlocks)) return null;
    const unlocks: TechUnlock[] = [];
    for (const rawUnlock of rawNode.unlocks) {
      const unlock = parseUnlock(rawUnlock);
      if (!unlock) return null;
      unlocks.push(unlock);
    }
    nodes.push({
      id: rawNode.id as TechNodeSnapshot['id'],
      name: rawNode.name,
      stage: rawNode.stage as TechStage,
      route: rawNode.route as TechRoute,
      status: rawNode.status as TechNodeStatus,
      requires: rawNode.requires as TechNodeSnapshot['requires'],
      cost,
      delivered,
      unlocks,
    });
  }
  const rawUnlocked = Array.isArray(raw.unlocked) ? raw.unlocked : [];
  const unlocked: TechNodeSnapshot['id'][] = [];
  for (const id of rawUnlocked) {
    if (typeof id === 'string') unlocked.push(id as TechNodeSnapshot['id']);
  }
  const trackedId = typeof raw.trackedId === 'string' ? raw.trackedId as TechNodeSnapshot['id'] : null;
  return { mode: raw.mode, nodes, unlocked, trackedId };
}

/** 科技数据的静态节点数量（UI「12 项科技」文案与自检用）。 */
export const STATIC_TECH_NODE_COUNT = TECH_NODES.length;
