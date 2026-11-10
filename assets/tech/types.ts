/**
 * M2.0-P2-E1 科技树类型定义（纯类型 + 纯数据，零引擎依赖）。
 *
 * 设计来源：docs/m20/P2-E0-TECH-TREE-DESIGN.md（12 个节点、3 阶段、两条路线）。
 * 稳定 ID 规范：`tech:<kebab-slug>`，一经发布只追加、不改名。
 * 注意：现有 `assertStableId`（industrial/ids.ts）只接受 `.`/`-`，
 * 科技 ID 使用本文件声明的 `TECH_ID_PATTERN`，不走 assertStableId。
 */
import type { ItemId } from '../items/items.ts';
import type { PartId } from '../mechanical/parts.ts';
import type { PortModuleId, RecipeId, StructureModuleId } from '../industrial/ids.ts';

/** 科技 ID 的稳定格式：`tech:<kebab-slug>`。 */
export const TECH_ID_PATTERN = /^tech:[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** 科技阶段：1 基础工业 / 2 机械化生产 / 3 初级自动化工业。 */
export type TechStage = 1 | 2 | 3;

/** 技术路线：机械动力 / 工业制造 / 交叉。 */
export type TechRoute = 'power' | 'industry' | 'cross';

/** 科技节点 ID。 */
export type TechNodeId = `tech:${string}`;

/** 可解锁的交互能力（能力门控的稳定 ID）。 */
export type TechCapabilityId =
  | 'port-input-install'
  | 'port-output-install'
  | 'material-link'
  | 'split-merge'
  | 'assembly'
  | 'line-diagnostics';

/** 终局项目 ID（E1 只登记，不实现结算）。 */
export type TechProjectId = 'combined-works';

/** 交付材料条目。 */
export interface TechCostEntry {
  readonly itemId: ItemId;
  readonly count: number;
}

/** 解锁目标（五类：配方 / 机器 / 接口盒 / 结构模块 / 能力 + 终局项目）。 */
export type TechUnlock =
  | { readonly kind: 'recipe'; readonly id: RecipeId }
  | { readonly kind: 'machine'; readonly id: PartId }
  | { readonly kind: 'port'; readonly id: PortModuleId }
  | { readonly kind: 'structure'; readonly id: StructureModuleId }
  | { readonly kind: 'capability'; readonly id: TechCapabilityId }
  | { readonly kind: 'project'; readonly id: TechProjectId };

/** 单条科技节点定义。 */
export interface TechNodeDef {
  readonly id: TechNodeId;
  readonly name: string;
  readonly description: string;
  readonly stage: TechStage;
  readonly route: TechRoute;
  /** 玩法目的（一句话，UI 详情用）。 */
  readonly purpose: string;
  /** 前置节点（必须全部 completed 才能进入 available）。 */
  readonly requires: readonly TechNodeId[];
  /** 交付材料。 */
  readonly cost: readonly TechCostEntry[];
  /** 解锁内容。 */
  readonly unlocks: readonly TechUnlock[];
}

/** 节点状态（派生，不存冗余状态）。 */
export type TechNodeStatus = 'locked' | 'available' | 'researching' | 'completed';

/** 进度模式：玩家正式流程 / 旧脚本兼容模式。 */
export type TechProgressionMode = 'player' | 'legacy';

/** 持久化的科技进度（纯 JSON，可序列化）。 */
export interface TechState {
  readonly version: 1;
  readonly mode: TechProgressionMode;
  /** nodeId -> itemId -> 已交付件数。 */
  readonly delivered: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** 已完成节点（派生可算，但显式保存便于校验与幂等恢复）。 */
  readonly unlocked: readonly TechNodeId[];
  readonly trackedId: TechNodeId | null;
}

/** 单个节点的只读快照（GameRead / UI 用）。 */
export interface TechNodeSnapshot {
  readonly id: TechNodeId;
  readonly name: string;
  readonly stage: TechStage;
  readonly route: TechRoute;
  readonly status: TechNodeStatus;
  readonly requires: readonly TechNodeId[];
  readonly cost: readonly TechCostEntry[];
  readonly delivered: Readonly<Record<string, number>>;
  readonly unlocks: readonly TechUnlock[];
}

/** 科技系统只读快照。 */
export interface TechSnapshot {
  readonly mode: TechProgressionMode;
  readonly nodes: readonly TechNodeSnapshot[];
  readonly unlocked: readonly TechNodeId[];
  readonly trackedId: TechNodeId | null;
}

/** 交付结果码（错误也都是数据，便于 UI 与测试断言）。 */
export type TechSubmitCode =
  | 'ok'
  | 'unknown-node'
  | 'locked'
  | 'completed'
  | 'unknown-item'
  | 'not-required'
  | 'invalid-count'
  | 'exceeds-remaining'
  | 'insufficient-items'
  /** 终局项目节点：交付已齐但运行证明未通过（只有 completeProjectNode 能解锁）。 */
  | 'not-delivered'
  /** 终局项目节点：完成守卫拒绝（运行证明未通过 / 其它前置条件未满足）。 */
  | 'project-blocked';

/**
 * 项目完成守卫：返回阻塞原因（非 null）表示不允许完成。
 * 只在 `completeProjectNode` 里使用——普通材料交付永远不受它影响。
 */
export type TechProjectCompletionGuard = (projectId: string) => string | null;

/** 交付结果。 */
export interface TechSubmitResult {
  readonly ok: boolean;
  readonly code: TechSubmitCode;
  readonly nodeId: string;
  readonly itemId?: string;
  readonly count?: number;
  /** 本次交付是否让节点变成 completed。 */
  readonly completed?: boolean;
  /**
   * 材料已交齐但节点尚未完成（终局项目节点：等待运行证明 / 完成守卫）。
   * 与 `completed` 互斥；节点状态保持 researching。
   */
  readonly pendingVerification?: boolean;
  /** 拒绝完成时的人话阻塞原因（按优先级）。 */
  readonly blockers?: readonly string[];
}

/** 库存窄接口：科技交付只依赖这三件事，不建立第二套库存。 */
export interface TechInventoryPort {
  has(itemId: ItemId, count: number): boolean;
  remove(itemId: ItemId, count: number): boolean;
  add(itemId: ItemId, count: number): void;
}
