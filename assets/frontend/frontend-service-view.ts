import type {
  DeliveryEntry,
  EndgameSnapshot,
  ProofCondition,
  ProofSnapshot,
  ProofState,
} from '../endgame/endgame-types.ts';
import type {
  DiagnosticsBottleneck,
  DiagnosticsSeverity,
  DiagnosticsSnapshot,
  LinkDiagnostic,
  MachineDiagnostic,
} from '../diagnostics/diagnostics-types.ts';
import type { PersistenceSnapshot } from '../save/persistence.pack.ts';
import { getItemDefinition, type ItemId } from '../items/items.ts';

/**
 * P2-E2 服务面板（联合工厂 / 产线诊断 / 存档状态）的纯视图模型与防御式解析。
 *
 * 契约来源：`assets/endgame/endgame-types.ts`、`assets/diagnostics/diagnostics-types.ts`、
 * `assets/save/persistence.pack.ts`。这里只做「快照 → 可渲染数据」的映射，
 * 不推断、不缓存、不修改任何服务状态；结构不合法时整体回退为 null（页面显示未就绪），
 * 不拖垮背包/快捷栏/科技页。
 */

const PROOF_STATE_LABELS: Readonly<Record<ProofState, string>> = Object.freeze({
  idle: '未开始',
  running: '观察中',
  passed: '已通过',
  failed: '未通过',
});

const PROOF_STATE_TONES: Readonly<Record<ProofState, 'muted' | 'accent' | 'ok' | 'danger'>> = Object.freeze({
  idle: 'muted',
  running: 'accent',
  passed: 'ok',
  failed: 'danger',
});

const BLOCK_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ok: '正常',
  'no-power': '没有动力',
  'no-input': '缺少原料',
  'output-full': '产物已满',
  'no-recipe': '没有可用配方',
});

export type ViewTone = 'muted' | 'info' | 'accent' | 'ok' | 'warn' | 'danger';

export interface ProjectDeliveryRow {
  readonly itemId: string;
  readonly name: string;
  readonly required: number;
  readonly delivered: number;
  readonly have: number;
  readonly complete: boolean;
}

export interface ProjectConditionRow {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly current: string;
  readonly required: string;
}

export interface ProjectProofView {
  readonly state: ProofState;
  readonly stateLabel: string;
  readonly stateTone: ViewTone;
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  readonly remainingSeconds: number;
  readonly produced: number;
  readonly target: number;
  readonly progressPercent: number;
  readonly conditions: readonly ProjectConditionRow[];
  readonly failureReason: string | null;
}

export interface ProjectView {
  readonly projectId: string;
  readonly completed: boolean;
  readonly unlocked: boolean;
  readonly deliveryRows: readonly ProjectDeliveryRow[];
  readonly totalRequired: number;
  readonly totalDelivered: number;
  readonly deliveryComplete: boolean;
  readonly proof: ProjectProofView;
  readonly blocks: readonly string[];
  readonly canBegin: boolean;
  readonly canCancel: boolean;
  /** 通关横幅文案（completed 时非 null）。 */
  readonly banner: string | null;
}

export interface DiagnosticsMachineRow {
  readonly partId: number;
  readonly coreId: string;
  readonly label: string;
  readonly powered: boolean;
  readonly running: boolean;
  readonly block: string;
  readonly blockLabel: string;
  readonly recipeLabel: string | null;
  readonly progressPercent: number;
  readonly inputText: string;
  readonly outputText: string;
  readonly inputPortFull: boolean;
  readonly outputPortFull: boolean;
  readonly blockedLinkId: string | null;
  /** P2-E2 追加：每台机器逐项检查（动力/原料/输出空间/输入接口盒/物料连接），可选。 */
  readonly conditions: readonly { readonly id: string; readonly label: string; readonly ok: boolean; readonly detail: string }[];
  readonly severity: DiagnosticsSeverity;
  readonly message: string;
}

export interface DiagnosticsLinkRow {
  readonly id: string;
  readonly fromCoreId: string;
  readonly toCoreId: string;
  readonly state: string;
  readonly stateLabel: string;
  readonly transferred: number;
  readonly blocked: boolean;
  readonly severity: DiagnosticsSeverity;
  readonly message: string;
}

export interface DiagnosticsBottleneckRow {
  readonly kind: DiagnosticsBottleneck['kind'];
  readonly label: string;
  readonly detail: string;
}

export interface DiagnosticsView {
  readonly locked: boolean;
  /** 未解锁时的中文提示；已解锁为 null。 */
  readonly lockedText: string | null;
  readonly machines: readonly DiagnosticsMachineRow[];
  readonly links: readonly DiagnosticsLinkRow[];
  readonly bottleneck: DiagnosticsBottleneckRow | null;
  readonly summary: {
    readonly total: number;
    readonly running: number;
    readonly idle: number;
    readonly blocked: number;
    readonly powered: number;
  };
  readonly hasError: boolean;
}

export interface SaveView {
  readonly available: boolean;
  readonly text: string;
  readonly tone: ViewTone;
  readonly hasSave: boolean;
  readonly savedAt: string | null;
}

export function itemLabelOf(itemId: string): string {
  return getItemDefinition(itemId as ItemId)?.name ?? itemId;
}

export function blockLabelOf(block: string): string {
  return BLOCK_LABELS[block] ?? block;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function intOf(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
}

function numOf(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseDeliveryEntry(raw: unknown): DeliveryEntry | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.itemId !== 'string') return null;
  return {
    itemId: raw.itemId,
    name: typeof raw.name === 'string' ? raw.name : itemLabelOf(raw.itemId),
    required: Math.max(0, intOf(raw.required)),
    delivered: Math.max(0, intOf(raw.delivered)),
  };
}

function parseProofCondition(raw: unknown): ProofCondition | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.label !== 'string') return null;
  return {
    id: raw.id,
    label: raw.label,
    ok: raw.ok === true,
    current: typeof raw.current === 'string' ? raw.current : String(raw.current ?? ''),
    required: typeof raw.required === 'string' ? raw.required : String(raw.required ?? ''),
  };
}

function parseProof(raw: unknown): ProofSnapshot | null {
  if (!isRecord(raw)) return null;
  const states: readonly ProofState[] = ['idle', 'running', 'passed', 'failed'];
  if (typeof raw.state !== 'string' || !states.includes(raw.state as ProofState)) return null;
  if (!Array.isArray(raw.conditions)) return null;
  const conditions: ProofCondition[] = [];
  for (const entry of raw.conditions) {
    const condition = parseProofCondition(entry);
    if (!condition) return null;
    conditions.push(condition);
  }
  return {
    state: raw.state as ProofState,
    elapsedSeconds: Math.max(0, numOf(raw.elapsedSeconds)),
    durationSeconds: Math.max(0, numOf(raw.durationSeconds)),
    produced: Math.max(0, intOf(raw.produced)),
    target: Math.max(0, intOf(raw.target)),
    conditions,
    failureReason: typeof raw.failureReason === 'string' ? raw.failureReason : null,
  };
}

/** 前端防御式解析 EndgameSnapshot；不合法返回 null。 */
export function parseEndgameSnapshot(raw: unknown): EndgameSnapshot | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.projectId !== 'string') return null;
  if (!isRecord(raw.delivery) || !Array.isArray(raw.delivery.entries)) return null;
  const entries: DeliveryEntry[] = [];
  for (const entry of raw.delivery.entries) {
    const parsed = parseDeliveryEntry(entry);
    if (!parsed) return null;
    entries.push(parsed);
  }
  const proof = parseProof(raw.proof);
  if (!proof) return null;
  const blocks: string[] = [];
  if (Array.isArray(raw.blocks)) {
    for (const block of raw.blocks) if (typeof block === 'string') blocks.push(block);
  }
  return {
    projectId: raw.projectId,
    completed: raw.completed === true,
    unlocked: raw.unlocked === true,
    delivery: {
      entries,
      totalRequired: Math.max(0, intOf(raw.delivery.totalRequired)),
      totalDelivered: Math.max(0, intOf(raw.delivery.totalDelivered)),
      complete: raw.delivery.complete === true,
    },
    proof,
    blocks,
  };
}

/** 联合工厂页视图：交付清单 + 运行证明 + 阻塞项 + 通关横幅。 */
export function buildProjectView(
  project: EndgameSnapshot | null,
  inventory: ReadonlyMap<string, number> = new Map(),
): ProjectView | null {
  if (!project) return null;
  const deliveryRows: ProjectDeliveryRow[] = project.delivery.entries.map((entry) => ({
    itemId: entry.itemId,
    name: entry.name || itemLabelOf(entry.itemId),
    required: entry.required,
    delivered: Math.min(entry.required, entry.delivered),
    have: Math.max(0, inventory.get(entry.itemId) ?? 0),
    complete: entry.delivered >= entry.required,
  }));
  const proof = project.proof;
  const progressPercent = proof.target > 0
    ? Math.min(100, Math.round((proof.produced / proof.target) * 100))
    : 0;
  return {
    projectId: project.projectId,
    completed: project.completed,
    unlocked: project.unlocked,
    deliveryRows,
    totalRequired: project.delivery.totalRequired,
    totalDelivered: project.delivery.totalDelivered,
    deliveryComplete: project.delivery.complete,
    proof: {
      state: proof.state,
      stateLabel: PROOF_STATE_LABELS[proof.state],
      stateTone: PROOF_STATE_TONES[proof.state],
      elapsedSeconds: proof.elapsedSeconds,
      durationSeconds: proof.durationSeconds,
      remainingSeconds: Math.max(0, Math.ceil(proof.durationSeconds - proof.elapsedSeconds)),
      produced: proof.produced,
      target: proof.target,
      progressPercent,
      conditions: proof.conditions.map((condition) => ({
        id: condition.id,
        label: condition.label,
        ok: condition.ok,
        current: condition.current,
        required: condition.required,
      })),
      failureReason: proof.failureReason,
    },
    blocks: project.blocks,
    // 运行证明与成套交付是两个独立条件（任务书 §五 C2）：交付未齐也允许先跑证明，
    // 完成终局仍要求两者都满足。未解锁 / 已在窗口内 / 已完成时不能开始。
    canBegin: !project.completed && project.unlocked && proof.state !== 'running',
    canCancel: proof.state === 'running',
    banner: project.completed
      ? 'Demo 通关：成套设备已交付 ' + project.delivery.totalDelivered + '/'
        + project.delivery.totalRequired + ' 件，运行证明已通过。'
      : null,
  };
}

function parseMachine(raw: unknown): MachineDiagnostic | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.coreId !== 'string' || typeof raw.label !== 'string') return null;
  const severities: readonly DiagnosticsSeverity[] = ['ok', 'warn', 'error'];
  if (typeof raw.severity !== 'string' || !severities.includes(raw.severity as DiagnosticsSeverity)) return null;
  return {
    partId: intOf(raw.partId),
    coreId: raw.coreId,
    label: raw.label,
    powered: raw.powered === true,
    running: raw.running === true,
    block: typeof raw.block === 'string' ? raw.block : 'ok',
    recipeId: typeof raw.recipeId === 'string' ? raw.recipeId : null,
    recipeLabel: typeof raw.recipeLabel === 'string' ? raw.recipeLabel : null,
    progress: numOf(raw.progress),
    inputItem: typeof raw.inputItem === 'string' ? raw.inputItem : null,
    inputCount: Math.max(0, intOf(raw.inputCount)),
    outputItem: typeof raw.outputItem === 'string' ? raw.outputItem : null,
    outputCount: Math.max(0, intOf(raw.outputCount)),
    inputPortFull: raw.inputPortFull === true,
    outputPortFull: raw.outputPortFull === true,
    blockedLinkId: typeof raw.blockedLinkId === 'string' ? raw.blockedLinkId : null,
    ...(Array.isArray(raw.conditions) ? { conditions: raw.conditions.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.label !== 'string') return [];
      return [{
        id: entry.id,
        label: entry.label,
        ok: entry.ok === true,
        detail: typeof entry.detail === 'string' ? entry.detail : '',
      }];
    }) } : {}),
    severity: raw.severity as DiagnosticsSeverity,
    message: typeof raw.message === 'string' ? raw.message : '',
  };
}

function parseLink(raw: unknown): LinkDiagnostic | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string') return null;
  const severities: readonly DiagnosticsSeverity[] = ['ok', 'warn', 'error'];
  if (typeof raw.severity !== 'string' || !severities.includes(raw.severity as DiagnosticsSeverity)) return null;
  return {
    id: raw.id,
    fromCoreId: typeof raw.fromCoreId === 'string' ? raw.fromCoreId : '',
    toCoreId: typeof raw.toCoreId === 'string' ? raw.toCoreId : '',
    state: typeof raw.state === 'string' ? raw.state : 'unknown',
    transferred: Math.max(0, intOf(raw.transferred)),
    blocked: raw.blocked === true,
    severity: raw.severity as DiagnosticsSeverity,
    message: typeof raw.message === 'string' ? raw.message : '',
  };
}

function parseBottleneck(raw: unknown): DiagnosticsBottleneck | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.kind !== 'string') return null;
  return {
    kind: raw.kind as DiagnosticsBottleneck['kind'],
    label: typeof raw.label === 'string' ? raw.label : '',
    detail: typeof raw.detail === 'string' ? raw.detail : '',
    ...(typeof raw.partId === 'number' ? { partId: raw.partId } : {}),
    ...(typeof raw.linkId === 'string' ? { linkId: raw.linkId } : {}),
  } as DiagnosticsBottleneck;
}

/** 前端防御式解析 DiagnosticsSnapshot；不合法返回 null（页面显示未解锁/未就绪）。 */
export function parseDiagnosticsSnapshot(raw: unknown): DiagnosticsSnapshot | null {
  if (!isRecord(raw)) return null;
  if (raw.unlocked !== true) return null;
  if (!Array.isArray(raw.machines) || !Array.isArray(raw.links)) return null;
  const machines: MachineDiagnostic[] = [];
  for (const entry of raw.machines) {
    const machine = parseMachine(entry);
    if (!machine) return null;
    machines.push(machine);
  }
  const links: LinkDiagnostic[] = [];
  for (const entry of raw.links) {
    const link = parseLink(entry);
    if (!link) return null;
    links.push(link);
  }
  if (!isRecord(raw.summary)) return null;
  return {
    unlocked: true,
    machines,
    links,
    bottleneck: parseBottleneck(raw.bottleneck),
    summary: {
      total: Math.max(0, intOf(raw.summary.total)),
      running: Math.max(0, intOf(raw.summary.running)),
      idle: Math.max(0, intOf(raw.summary.idle)),
      blocked: Math.max(0, intOf(raw.summary.blocked)),
      powered: Math.max(0, intOf(raw.summary.powered)),
    },
    hasError: raw.hasError === true,
  };
}

/** 诊断页视图；diagnostics 为 null 时是「未解锁」页面（不是错误页）。 */
export function buildDiagnosticsView(diagnostics: DiagnosticsSnapshot | null): DiagnosticsView {
  if (!diagnostics) {
    return {
      locked: true,
      lockedText: '完成 T3.2 多级产线整合后解锁',
      machines: [],
      links: [],
      bottleneck: null,
      summary: { total: 0, running: 0, idle: 0, blocked: 0, powered: 0 },
      hasError: false,
    };
  }
  return {
    locked: false,
    lockedText: null,
    machines: diagnostics.machines.map((machine) => {
      const inputItem = machine.inputItem ? itemLabelOf(machine.inputItem) : null;
      const outputItem = machine.outputItem ? itemLabelOf(machine.outputItem) : null;
      return {
        partId: machine.partId,
        coreId: machine.coreId,
        label: machine.label,
        powered: machine.powered,
        running: machine.running,
        block: machine.block,
        blockLabel: blockLabelOf(machine.block),
        recipeLabel: machine.recipeLabel,
        progressPercent: Math.min(100, Math.round(machine.progress * 100)),
        inputText: (inputItem ? inputItem : '空') + ' ' + machine.inputCount,
        outputText: (outputItem ? outputItem : '空') + ' ' + machine.outputCount,
        inputPortFull: machine.inputPortFull,
        outputPortFull: machine.outputPortFull,
        blockedLinkId: machine.blockedLinkId,
        conditions: (machine.conditions ?? []).map((condition) => ({
          id: condition.id,
          label: condition.label,
          ok: condition.ok,
          detail: condition.detail,
        })),
        severity: machine.severity,
        message: machine.message,
      };
    }),
    links: diagnostics.links.map((link) => ({
      id: link.id,
      fromCoreId: link.fromCoreId,
      toCoreId: link.toCoreId,
      state: link.state,
      stateLabel: link.state === 'active' ? '传输中' : link.state,
      transferred: link.transferred,
      blocked: link.blocked,
      severity: link.severity,
      message: link.message,
    })),
    bottleneck: diagnostics.bottleneck
      ? {
        kind: diagnostics.bottleneck.kind,
        label: diagnostics.bottleneck.label,
        detail: diagnostics.bottleneck.detail,
      }
      : null,
    summary: {
      total: diagnostics.summary.total,
      running: diagnostics.summary.running,
      idle: diagnostics.summary.idle,
      blocked: diagnostics.summary.blocked,
      powered: diagnostics.summary.powered,
    },
    hasError: diagnostics.hasError,
  };
}

/** 前端防御式解析 PersistenceSnapshot；字段缺失返回 null。 */
export function parseSaveSnapshot(raw: unknown): PersistenceSnapshot | null {
  if (!isRecord(raw)) return null;
  const statuses = ['idle', 'busy', 'saved', 'restored', 'error'];
  if (typeof raw.status !== 'string' || !statuses.includes(raw.status)) return null;
  return {
    status: raw.status as PersistenceSnapshot['status'],
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : null,
    message: typeof raw.message === 'string' ? raw.message : null,
    version: Math.max(0, intOf(raw.version)),
    hasSave: raw.hasSave === true,
  };
}

/** ISO 时间 → 本地 HH:MM（无效时间返回 null，不猜）。 */
export function formatSavedAt(savedAt: string | null): string | null {
  if (!savedAt) return null;
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return null;
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return hours + ':' + minutes;
}

/** 页脚存档状态文案（中文；不暴露存储实现细节）。 */
export function buildSaveView(save: PersistenceSnapshot | null): SaveView {
  if (!save) {
    return { available: false, text: '存档服务未就绪', tone: 'muted', hasSave: false, savedAt: null };
  }
  const savedAt = formatSavedAt(save.savedAt);
  switch (save.status) {
    case 'busy':
      return { available: true, text: '保存中…', tone: 'info', hasSave: save.hasSave, savedAt };
    case 'saved':
      return {
        available: true,
        text: savedAt ? '已保存 ' + savedAt : '已保存',
        tone: 'ok',
        hasSave: true,
        savedAt,
      };
    case 'restored':
      return {
        available: true,
        text: savedAt ? '已读取存档 ' + savedAt : '已读取存档',
        tone: 'ok',
        hasSave: true,
        savedAt,
      };
    case 'error':
      return {
        available: true,
        text: '保存失败：' + (save.message ?? '未知错误'),
        tone: 'danger',
        hasSave: save.hasSave,
        savedAt,
      };
    default:
      return {
        available: true,
        text: save.hasSave
          ? (savedAt ? '存在存档 ' + savedAt : '存在存档')
          : '未找到存档',
        tone: save.hasSave ? 'info' : 'muted',
        hasSave: save.hasSave,
        savedAt,
      };
  }
}
