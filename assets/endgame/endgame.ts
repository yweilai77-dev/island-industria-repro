/**
 * M2.0-P2-E3 终局联合工厂纯逻辑（零引擎依赖、可单测）。
 *
 * 两个独立条件（任务书 §五 C1/C2）：16 件成套交付进入 TechState.delivered；
 * 运行证明要求在观察窗口内看到组合成员核心 `producedTotal` 增量合计 ≥ 12。
 * 本文件只做只读派生与窗口累积，不写完成标记：唯一完成路径是 tech 的 completeProjectNode。
 *
 * 口径（写进测试，避免只凭机器存在判定成功）：
 * - 候选组合：成员核心最多的组合机械（并列取 Assembly ID 最小者）；
 * - 输出盒：成员核心**输出安装位**上装有接口盒；
 * - 组合内连接：`from` 与 `to` 两端都是候选组合成员核心的 active MaterialLink；
 * - powered：成员核心在机械动力快照里 powered = true；
 * - 产出：窗口开始记录每个成员核心 producedTotal 基线，之后只累加增量（历史累计不算）。
 */
import { getItemDefinition } from '../items/items.ts';
import { techNodeById } from '../tech/nodes.ts';
import type { TechNodeDef, TechSnapshot } from '../tech/types.ts';
import type {
  DeliveryEntry,
  EndgameSnapshot,
  ProofCondition,
  ProofSnapshot,
  ProofState,
} from './endgame-types.ts';

/** 终局项目 ID（与 tech 节点 unlocks 中的 id 一致）。 */
export const ENDGAME_PROJECT_ID = 'combined-works';
/** 终局科技节点 ID（T3.3）。 */
export const ENDGAME_NODE_ID = 'tech:combined-works';
/** 观察窗口默认长度（秒）。 */
export const PROOF_DURATION_SECONDS = 60;
/** 窗口内要求的最小产出增量（件）。 */
export const PROOF_MIN_PRODUCED = 12;

/** 一台加工机器的只读视图（来自 goalProgress.observation()）。 */
export interface EndgameMachineView {
  readonly partId: number;
  readonly producedTotal: number;
  readonly powered: boolean;
}

/** 一条物料连接的只读视图（来自 ports.links()）。 */
export interface EndgameLinkView {
  readonly fromPartId: number;
  readonly toPartId: number;
  readonly active: boolean;
}

/** 一个组合机械的只读视图（来自 assembly.snapshot()）。 */
export interface EndgameAssemblyView {
  readonly id: string;
  readonly memberIds: readonly number[];
}

/** 运行证明求值用的世界只读视图（插件从真实服务快照映射，测试可直接构造）。 */
export interface EndgameWorldView {
  readonly assemblies: readonly EndgameAssemblyView[];
  readonly machines: readonly EndgameMachineView[];
  /** 输出安装位上装有接口盒的机器 partId（来自 ports.installedOf）。 */
  readonly outputPortPartIds: readonly number[];
  readonly links: readonly EndgameLinkView[];
}

/** 空科技快照：服务尚未就绪时的安全回退（不虚构任何进度）。 */
export const EMPTY_TECH_SNAPSHOT: TechSnapshot = Object.freeze({
  mode: 'player' as const,
  nodes: Object.freeze([]),
  unlocked: Object.freeze([]),
  trackedId: null,
});

/** 一条运行证明条件的求值。 */
function condition(
  id: string,
  label: string,
  ok: boolean,
  current: string,
  required: string,
): ProofCondition {
  return { id, label, ok, current, required };
}

/** 成员核心最多的候选组合（并列取 ID 最小者，保证确定性）。 */
export function candidateAssemblyOf(view: EndgameWorldView): EndgameAssemblyView | undefined {
  let best: EndgameAssemblyView | undefined;
  for (const assembly of view.assemblies) {
    if (best === undefined) {
      best = assembly;
      continue;
    }
    const size = assembly.memberIds.length;
    const bestSize = best.memberIds.length;
    if (size > bestSize || (size === bestSize && assembly.id < best.id)) best = assembly;
  }
  return best;
}

/** 窗口开始时的产出基线：候选组合每个成员核心的 producedTotal。 */
export function baselineOf(view: EndgameWorldView): Readonly<Record<string, number>> {
  const candidate = candidateAssemblyOf(view);
  const byPart = new Map(view.machines.map((machine) => [machine.partId, machine.producedTotal]));
  const baseline: Record<string, number> = {};
  for (const partId of candidate?.memberIds ?? []) {
    const produced = byPart.get(partId);
    if (produced !== undefined) baseline[String(partId)] = produced;
  }
  return baseline;
}

/** 窗口内产出增量：只累加基线上登记的成员核心，成员消失不虚构产出。 */
export function producedDeltaOf(
  view: EndgameWorldView,
  baseline: Readonly<Record<string, number>>,
): number {
  const byPart = new Map(view.machines.map((machine) => [machine.partId, machine.producedTotal]));
  let total = 0;
  for (const [rawPartId, base] of Object.entries(baseline)) {
    const partId = Number(rawPartId);
    const current = byPart.get(partId);
    if (current === undefined) continue;
    total += Math.max(0, current - base);
  }
  return total;
}

/** 五条运行证明条件（实时求值；窗口结束时全部 true 才通过）。 */
export function conditionsOf(
  view: EndgameWorldView,
  produced: number,
  target: number = PROOF_MIN_PRODUCED,
): readonly ProofCondition[] {
  const candidate = candidateAssemblyOf(view);
  const members = candidate?.memberIds ?? [];
  const memberSet = new Set(members);
  const machines = new Map(view.machines.map((machine) => [machine.partId, machine]));
  const outputPorts = new Set(view.outputPortPartIds);
  const outputBoxCount = members.filter((partId) => outputPorts.has(partId)).length;
  const poweredCount = members.filter((partId) => machines.get(partId)?.powered === true).length;
  const internalLinks = view.links.filter(
    (link) => link.active && memberSet.has(link.fromPartId) && memberSet.has(link.toPartId),
  ).length;
  return [
    condition('assembly', '存在 ≥3 台加工核心的组合机械', members.length >= 3, members.length + ' 台核心', '≥3 台核心'),
    condition('output-boxes', '组合内 ≥2 台核心装了输出接口盒', outputBoxCount >= 2, outputBoxCount + ' 台', '≥2 台'),
    condition('active-links', '组合内 ≥2 条物料连接为 active', internalLinks >= 2, internalLinks + ' 条', '≥2 条'),
    condition('powered', '组合内 ≥2 台核心 powered', poweredCount >= 2, poweredCount + ' 台', '≥2 台'),
    condition('produced', '观察窗口内组合成员核心产出增量', produced >= target, produced + ' 件', '≥' + target + ' 件'),
  ];
}

/** 观察窗口「上次结论」（持久化用，不是派生量）。 */
export interface EndgameConclusion {
  readonly at: number;
  readonly passed: boolean;
  readonly produced: number;
  readonly reason: string | null;
}

/** 序列化形状：窗口状态 / 开始时刻 / 已累计 / 基线 / passed / 上次结论。 */
export interface EndgamePersistedState {
  readonly version: 1;
  readonly state: ProofState;
  readonly startedAt: number | null;
  readonly elapsedSeconds: number;
  readonly produced: number;
  readonly baseline: Readonly<Record<string, number>>;
  readonly passed: boolean;
  readonly failureReason: string | null;
  readonly lastConclusion: EndgameConclusion | null;
}

export type ProofBeginCode = 'ok' | 'already-running' | 'already-passed';

export interface ProofTickOutcome {
  /** 窗口状态是否发生变更（供 UI revision 刷新）。 */
  readonly changed: boolean;
  /** 本次 tick 是否刚好从 running 转为 passed（插件据此结算项目节点）。 */
  readonly passedNow: boolean;
}

/**
 * 运行证明观察窗口（纯状态机：时间由调用方以 deltaSeconds 注入，可确定性单测）。
 *
 * 不满足时只写 failureReason，不产生任何副作用；pass 只在窗口结束且五条条件全满足时发生，
 * 且 pass 之后不可回退（`cancelProof` 也不能取消已通过的证明）。
 */
export class EndgameProof {
  readonly durationSeconds: number;
  readonly targetProduced: number;
  private proofState: ProofState = 'idle';
  /** 引擎累计时钟（秒），只用于记录 startedAt，不参与窗口计时。 */
  private clock = 0;
  private startedAt: number | null = null;
  private elapsed = 0;
  private producedCount = 0;
  private baseline: Record<string, number> = {};
  private passedFlag = false;
  private failureReason: string | null = null;
  private lastConclusion: EndgameConclusion | null = null;

  constructor(durationSeconds: number = PROOF_DURATION_SECONDS, targetProduced: number = PROOF_MIN_PRODUCED) {
    this.durationSeconds = durationSeconds > 0 ? durationSeconds : PROOF_DURATION_SECONDS;
    this.targetProduced = targetProduced > 0 ? targetProduced : PROOF_MIN_PRODUCED;
  }

  state(): ProofState {
    return this.proofState;
  }

  passed(): boolean {
    return this.passedFlag;
  }

  /** 开始窗口：不扣材料、不写完成标记；failed 之后允许重来。 */
  begin(view: EndgameWorldView): ProofBeginCode {
    if (this.proofState === 'running') return 'already-running';
    if (this.passedFlag) return 'already-passed';
    this.proofState = 'running';
    this.startedAt = this.clock;
    this.elapsed = 0;
    this.producedCount = 0;
    this.baseline = { ...baselineOf(view) };
    this.failureReason = null;
    return 'ok';
  }

  /** 中止进行中的窗口（已通过/已失败不受影响）；返回是否真的中止了。 */
  cancel(): boolean {
    if (this.proofState !== 'running') return false;
    this.proofState = 'idle';
    this.startedAt = null;
    this.elapsed = 0;
    this.producedCount = 0;
    this.baseline = {};
    this.failureReason = null;
    return true;
  }

  /** 推进一帧：running 时累积产出增量，到时长后做出唯一一次结论。 */
  tick(deltaSeconds: number, view: EndgameWorldView): ProofTickOutcome {
    const step = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    this.clock += step;
    if (this.proofState !== 'running') return { changed: false, passedNow: false };
    this.elapsed += step;
    this.producedCount = producedDeltaOf(view, this.baseline);
    const conditions = conditionsOf(view, this.producedCount, this.targetProduced);
    if (this.elapsed + 1e-9 < this.durationSeconds) return { changed: false, passedNow: false };
    this.elapsed = this.durationSeconds;
    const failed = conditions.filter((entry) => !entry.ok);
    if (failed.length === 0) {
      this.proofState = 'passed';
      this.passedFlag = true;
      this.failureReason = null;
      this.lastConclusion = {
        at: this.clock,
        passed: true,
        produced: this.producedCount,
        reason: null,
      };
      return { changed: true, passedNow: true };
    }
    const reason = '运行证明未通过：' + failed.map((entry) => entry.label).join('；');
    this.proofState = 'failed';
    this.failureReason = reason;
    this.lastConclusion = {
      at: this.clock,
      passed: false,
      produced: this.producedCount,
      reason,
    };
    return { changed: true, passedNow: false };
  }

  /** 实时只读快照（条件始终按当前世界状态求值）。 */
  snapshotOf(view: EndgameWorldView): ProofSnapshot {
    const liveProduced = this.proofState === 'running'
      ? producedDeltaOf(view, this.baseline)
      : this.producedCount;
    return {
      state: this.proofState,
      elapsedSeconds: this.elapsed,
      durationSeconds: this.durationSeconds,
      produced: liveProduced,
      target: this.targetProduced,
      conditions: conditionsOf(view, liveProduced, this.targetProduced),
      failureReason: this.failureReason,
    };
  }

  /** tech 完成守卫：未通过证明时返回阻塞原因，通过后放行。 */
  completionBlocker(): string | null {
    if (this.passedFlag) return null;
    if (this.proofState === 'failed') {
      return '运行证明未通过，请修复产线后重新开始 60 秒观察窗口';
    }
    if (this.proofState === 'running') return '运行证明进行中，等待观察窗口结束';
    return '运行证明尚未通过：请先完成 60 秒观察窗口';
  }

  /** 序列化（纯 JSON；不存派生量：条件、实时产出都由快照重新计算）。 */
  serialize(): EndgamePersistedState {
    return {
      version: 1,
      state: this.proofState,
      startedAt: this.startedAt,
      elapsedSeconds: this.elapsed,
      produced: this.producedCount,
      baseline: { ...this.baseline },
      passed: this.passedFlag,
      failureReason: this.failureReason,
      lastConclusion: this.lastConclusion === null ? null : { ...this.lastConclusion },
    };
  }

  /** 从不可信数据恢复（幂等；损坏字段逐条修复并上报，不进入半坏状态）。 */
  restore(raw: unknown): { readonly repaired: boolean; readonly issues: readonly string[] } {
    const issues: string[] = [];
    const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    if (source.version !== 1) issues.push('unsupported endgame state version: ' + String(source.version));

    const validStates: readonly ProofState[] = ['idle', 'running', 'passed', 'failed'];
    const rawState = source.state;
    let state: ProofState = 'idle';
    if (validStates.includes(rawState as ProofState)) state = rawState as ProofState;
    else if (rawState !== undefined) issues.push('unknown proof state: ' + String(rawState));

    const passed = source.passed === true;
    if (passed && state !== 'passed') {
      state = 'passed';
      issues.push('passed flag repaired proof state to passed');
    }

    const rawElapsed = typeof source.elapsedSeconds === 'number' && Number.isFinite(source.elapsedSeconds)
      ? source.elapsedSeconds : 0;
    const elapsed = Math.max(0, Math.min(this.durationSeconds, rawElapsed));
    if (elapsed !== rawElapsed) issues.push('clamped elapsedSeconds: ' + String(source.elapsedSeconds) + ' -> ' + elapsed);

    const rawProduced = typeof source.produced === 'number' && Number.isFinite(source.produced)
      ? source.produced : 0;
    const produced = Math.max(0, Math.floor(rawProduced));
    if (produced !== rawProduced) issues.push('clamped produced: ' + String(source.produced) + ' -> ' + produced);

    const baseline: Record<string, number> = {};
    const rawBaseline = (typeof source.baseline === 'object' && source.baseline !== null
      ? source.baseline : {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(rawBaseline)) {
      const partId = Number(key);
      if (!Number.isInteger(partId) || partId < 0 || typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        issues.push('dropped invalid baseline entry: ' + key);
        continue;
      }
      baseline[key] = Math.floor(value);
    }

    let startedAt: number | null = typeof source.startedAt === 'number' && Number.isFinite(source.startedAt)
      ? source.startedAt : null;
    if (state === 'running' && startedAt === null) {
      startedAt = 0;
      issues.push('running window without startedAt repaired to 0');
    }

    const rawReason = source.failureReason;
    const failureReason = typeof rawReason === 'string' ? rawReason : null;
    if (state !== 'failed' && failureReason !== null) {
      issues.push('failureReason dropped outside failed state');
    }

    let lastConclusion: EndgameConclusion | null = null;
    const rawConclusion = source.lastConclusion;
    if (typeof rawConclusion === 'object' && rawConclusion !== null) {
      const entry = rawConclusion as Record<string, unknown>;
      if (typeof entry.at === 'number' && Number.isFinite(entry.at)
        && typeof entry.produced === 'number' && Number.isFinite(entry.produced)
        && typeof entry.passed === 'boolean') {
        lastConclusion = {
          at: entry.at,
          passed: entry.passed,
          produced: Math.max(0, Math.floor(entry.produced)),
          reason: typeof entry.reason === 'string' ? entry.reason : null,
        };
      } else {
        issues.push('dropped invalid lastConclusion');
      }
    }

    this.proofState = state;
    this.passedFlag = passed || state === 'passed';
    this.startedAt = startedAt;
    this.elapsed = state === 'idle' ? 0 : elapsed;
    this.producedCount = state === 'idle' ? 0 : produced;
    this.baseline = state === 'idle' ? {} : baseline;
    this.failureReason = state === 'failed' ? failureReason : null;
    this.lastConclusion = lastConclusion;
    return { repaired: issues.length > 0, issues };
  }
}

/** 成套交付项（来自 tech 快照；已交付计数按需求上限 clamp）。 */
export function deliveryEntriesOf(tech: TechSnapshot): readonly DeliveryEntry[] {
  const node = tech.nodes.find((entry) => entry.id === ENDGAME_NODE_ID);
  if (node === undefined) return [];
  return node.cost.map((entry) => ({
    itemId: entry.itemId,
    name: getItemDefinition(entry.itemId)?.name ?? entry.itemId,
    required: entry.count,
    delivered: Math.max(0, Math.min(entry.count, node.delivered[entry.itemId] ?? 0)),
  }));
}

/** 成套交付进度汇总。 */
export function deliveryOf(tech: TechSnapshot): EndgameSnapshot['delivery'] {
  const entries = deliveryEntriesOf(tech);
  let totalRequired = 0;
  let totalDelivered = 0;
  for (const entry of entries) {
    totalRequired += entry.required;
    totalDelivered += entry.delivered;
  }
  return {
    entries,
    totalRequired,
    totalDelivered,
    complete: entries.length > 0 && entries.every((entry) => entry.delivered >= entry.required),
  };
}

/** 终局节点定义（缺数据时为 undefined）。 */
export function endgameNodeOf(): TechNodeDef | undefined {
  return techNodeById(ENDGAME_NODE_ID);
}

function missingSummary(entries: readonly DeliveryEntry[]): string {
  return entries
    .filter((entry) => entry.delivered < entry.required)
    .map((entry) => entry.name + ' ×' + (entry.required - entry.delivered))
    .join('、');
}

/** 当前还差什么（人话，按优先级：解锁 → 交付 → 运行证明）。 */
export function blocksOf(
  node: TechSnapshot['nodes'][number] | undefined,
  delivery: EndgameSnapshot['delivery'],
  proof: ProofSnapshot,
): readonly string[] {
  if (node === undefined) return ['科技数据缺失：' + ENDGAME_NODE_ID];
  if (node.status === 'completed') return [];
  const blocks: string[] = [];
  if (node.status === 'locked') {
    blocks.push('需要先完成前置科技：' + node.requires.join('、'));
  }
  if (!delivery.complete) {
    blocks.push('成套设备还差 ' + (delivery.totalRequired - delivery.totalDelivered) + ' 件：' + missingSummary(delivery.entries));
  }
  if (proof.state !== 'passed') {
    blocks.push(proof.state === 'failed'
      ? (proof.failureReason ?? '运行证明未通过')
      : '运行证明尚未完成（' + proof.state + '，' + proof.durationSeconds + ' 秒观察窗口）');
  }
  return blocks;
}

/** 终局只读快照（UI 终局面板与验收脚本共用；completed 来自 tech 真实节点状态）。 */
export function buildEndgameSnapshot(tech: TechSnapshot, proof: ProofSnapshot): EndgameSnapshot {
  const node = tech.nodes.find((entry) => entry.id === ENDGAME_NODE_ID);
  const delivery = deliveryOf(tech);
  return {
    projectId: ENDGAME_PROJECT_ID,
    completed: node?.status === 'completed',
    unlocked: node !== undefined && node.status !== 'locked',
    delivery,
    proof,
    blocks: blocksOf(node, delivery, proof),
  };
}
