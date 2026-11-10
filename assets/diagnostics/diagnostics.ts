/**
 * M2.0-P2-E2 生产线诊断（T3.2 `line-diagnostics`）的**纯逻辑实现**。
 *
 * - 只读：输入全部来自真实运行时快照（目标观测 / 接口盒 / 物料连接 / 组合机械）；
 *   本模块不持有第二份状态、不缓存、不反向控制任何系统。
 * - 零引擎依赖：只用纯数据即可单测（`assets/__tests__/diagnostics.test.ts`）。
 * - 门控：`diagnosticsSnapshot(source, unlocked)` 未解锁时返回 **null**（不是空数组）。
 *
 * 六个问题对应：缺输入（block/conditions.input）、接口盒已满（*PortFull）、
 * 连接阻塞（links[].blocked / blockedLinkId）、缺动力（block/powered）、
 * 瓶颈（bottleneck）、正常环节（severity=ok + summary）。
 */
import type { GoalMachineObservation, GoalObservation } from '../goal/observation.ts';
import { coreForPart, recipeOfId, slotOfId } from '../industrial/catalog.ts';
import type { MaterialLinkSnapshot } from '../industrial/link-runtime.ts';
import type { InstalledPortSnapshot } from '../industrial/port-runtime.ts';
import { getItemDefinition } from '../items/items.ts';
import type { ItemId } from '../items/items.ts';
import { MECHANICAL_PART_DEFS, type PartId } from '../mechanical/parts.ts';
import { inputCapacity, outputCapacity } from '../production/production.ts';
import type {
  DiagnosticsBottleneck,
  DiagnosticsCondition,
  DiagnosticsSeverity,
  DiagnosticsSnapshot,
  LinkDiagnostic,
  MachineDiagnostic,
} from './diagnostics-types.ts';

/** `assembly.snapshot()` 里诊断真正需要的最小视图（完整快照结构兼容）。 */
export interface DiagnosticsAssemblyInput {
  readonly id: string;
  readonly memberIds: readonly number[];
}

/** 诊断一帧所需的全部真实输入（由插件从各服务读取，纯数据）。 */
export interface DiagnosticsSource {
  readonly observation: GoalObservation;
  readonly ports: readonly InstalledPortSnapshot[];
  readonly links: readonly MaterialLinkSnapshot[];
  readonly assemblies?: readonly DiagnosticsAssemblyInput[];
}

const NETWORK_REASON_LABEL: Record<string, string> = {
  'no-source': '网络里没有动力源',
  'multiple-sources': '单源网络里接入了多个动力源（并联不被支持）',
  'cyclic-network': '动力网络存在闭环',
  'source-overload': '动力源过载',
  'branch-overload': '传动支路过载',
};

function itemLabel(itemId: ItemId | null): string {
  if (itemId === null) return '空';
  return getItemDefinition(itemId)?.name ?? itemId;
}

function coreIdOf(kind: PartId): string {
  return coreForPart(kind)?.id ?? `core.${kind}`;
}

function percentOf(progress: number): number {
  return Math.round(Math.max(0, Math.min(1, progress)) * 100);
}

/** 阻塞原因 → 严重度。缺料/缺动力/输出满都是「玩家需要处理」的 error。 */
function severityOfBlock(block: string): DiagnosticsSeverity {
  if (block === 'no-input' || block === 'no-power' || block === 'output-full') return 'error';
  return block === 'no-recipe' ? 'warn' : 'ok';
}

const SEVERITY_RANK: Record<DiagnosticsSeverity, number> = { ok: 0, warn: 1, error: 2 };

function worse(left: DiagnosticsSeverity, right: DiagnosticsSeverity): DiagnosticsSeverity {
  return SEVERITY_RANK[right] > SEVERITY_RANK[left] ? right : left;
}

interface PortIndex {
  readonly byPart: ReadonlyMap<number, readonly InstalledPortSnapshot[]>;
  roleOf(port: InstalledPortSnapshot): string;
}

function indexPorts(ports: readonly InstalledPortSnapshot[]): PortIndex {
  const byPart = new Map<number, InstalledPortSnapshot[]>();
  for (const port of ports) {
    const list = byPart.get(port.partId);
    if (list) list.push(port); else byPart.set(port.partId, [port]);
  }
  return { byPart, roleOf: (port) => slotOfId(port.slotId)?.slot.role ?? 'unknown' };
}

/** 某台机器某角色接口盒的整体占用（message/detail 与「是否已满」共用）。 */
function boxOf(index: PortIndex, partId: number, role: 'input' | 'output'): InstalledPortSnapshot | undefined {
  return (index.byPart.get(partId) ?? []).find((port) => index.roleOf(port) === role);
}

function bufferKey(entityId: number, slotId: string): string {
  return `${entityId}:${slotId}`;
}

/**
 * 判定一条连接是否真的在阻塞（与 link-runtime 语义一致：连接不存料）。
 * 只有「源里有货、目标收不下」才是阻塞；源里没货只是等待上游。
 */
function linkBlocked(link: MaterialLinkSnapshot, buffers: ReadonlyMap<string, InstalledPortSnapshot>): boolean {
  if (!link.active) return false;
  const source = buffers.get(bufferKey(link.from.entityId, link.from.slotId));
  if (!source || source.itemId === null || source.count <= 0) return false;
  const target = buffers.get(bufferKey(link.to.entityId, link.to.slotId));
  if (!target) return false;
  if (target.count > 0 && target.itemId !== source.itemId) return true;
  return target.count >= target.capacity;
}

function linkMessageOf(
  link: MaterialLinkSnapshot,
  buffers: ReadonlyMap<string, InstalledPortSnapshot>,
): { readonly blocked: boolean; readonly severity: DiagnosticsSeverity; readonly message: string } {
  const source = buffers.get(bufferKey(link.from.entityId, link.from.slotId));
  const target = buffers.get(bufferKey(link.to.entityId, link.to.slotId));
  if (!link.active) return { blocked: false, severity: 'warn', message: '连接失效（缺少接口盒或几何不成立），不会传递物料' };
  if (!source) return { blocked: false, severity: 'warn', message: '上游接口盒不存在' };
  if (source.count <= 0 || source.itemId === null) return { blocked: false, severity: 'ok', message: '等待上游供料' };
  if (!target) return { blocked: false, severity: 'warn', message: '下游接口盒不存在' };
  if (target.count > 0 && target.itemId !== source.itemId) {
    return {
      blocked: true,
      severity: 'error',
      message: `下游接口盒里是${itemLabel(target.itemId)}，收不下${itemLabel(source.itemId)}（已累计传递 ${link.moved} 件）`,
    };
  }
  if (target.count >= target.capacity) {
    return {
      blocked: true,
      severity: 'error',
      message: `下游接口盒已满（${target.count}/${target.capacity}），物料停在源头（已传递 ${link.moved} 件）`,
    };
  }
  return { blocked: false, severity: 'ok', message: `可传递（已累计 ${link.moved} 件）` };
}

/** 机器输入侧被哪条连接卡住（下游 = 这台机器）。 */
function blockedLinkInto(
  partId: number,
  links: readonly MaterialLinkSnapshot[],
  buffers: ReadonlyMap<string, InstalledPortSnapshot>,
): string | null {
  let found: string | null = null;
  for (const link of links) {
    if (link.to.entityId !== partId || !linkBlocked(link, buffers)) continue;
    if (found === null || link.id < found) found = link.id;
  }
  return found;
}

/** 上游层级：无入边机器 depth=0，其余 = 1 + 上游最大深度（有环时停在已访问节点）。 */
function depthMapOf(
  machines: readonly GoalMachineObservation[],
  links: readonly MaterialLinkSnapshot[],
): ReadonlyMap<number, number> {
  const upstream = new Map<number, number[]>();
  for (const link of links) {
    if (!link.active || link.from.entityId === link.to.entityId) continue;
    const list = upstream.get(link.to.entityId);
    if (list) list.push(link.from.entityId); else upstream.set(link.to.entityId, [link.from.entityId]);
  }
  const depth = new Map<number, number>();
  const visiting = new Set<number>();
  const depthOf = (partId: number): number => {
    const cached = depth.get(partId);
    if (cached !== undefined) return cached;
    if (visiting.has(partId)) return 0;
    visiting.add(partId);
    let value = 0;
    for (const source of upstream.get(partId) ?? []) value = Math.max(value, depthOf(source) + 1);
    visiting.delete(partId);
    depth.set(partId, value);
    return value;
  };
  for (const machine of machines) depthOf(machine.partId);
  return depth;
}

interface MachineContext {
  readonly kind: PartId;
  readonly observation: GoalMachineObservation;
  /** 本帧真实动力（来自 `GoalPartObservation.powered`，不自行推断）。 */
  readonly powered: boolean;
  readonly index: PortIndex;
  readonly links: readonly MaterialLinkSnapshot[];
  readonly buffers: ReadonlyMap<string, InstalledPortSnapshot>;
  readonly networks: GoalObservation['networks'];
  readonly assemblyOf: ReadonlyMap<number, string>;
}

function networkNoteOf(partId: number, networks: GoalObservation['networks']): string {
  const network = networks.find((entry) => entry.machineIds.includes(partId));
  if (!network) return '';
  if (network.reason !== null) return `（${NETWORK_REASON_LABEL[network.reason] ?? network.reason}）`;
  return network.status === 'idle' ? '（动力源未挂合）' : '';
}

function conditionsOf(context: MachineContext): DiagnosticsCondition[] {
  const { observation, kind, powered } = context;
  const def = MECHANICAL_PART_DEFS[kind];
  const recipe = observation.recipeId === null ? undefined : recipeOfId(observation.recipeId);
  const need = recipe?.recipe.inputs[0];
  const out = recipe?.recipe.outputs[0];
  const inCap = inputCapacity(def);
  const outCap = outputCapacity(def);
  const hasInput = observation.progress > 0 || (need !== undefined && observation.inputCount >= need.count);
  const outputSpace = out === undefined
    ? 0
    : (observation.outputItem !== null && observation.outputItem !== out.itemId
      ? 0
      : Math.max(0, outCap - observation.outputCount));
  const box = boxOf(context.index, observation.partId, 'input');
  const linkId = blockedLinkInto(observation.partId, context.links, context.buffers);
  return [
    {
      id: 'power',
      label: '动力',
      ok: powered,
      detail: powered ? '有动力' : `传动断开或动力源未运转${networkNoteOf(observation.partId, context.networks)}`,
    },
    {
      id: 'input',
      label: '原料',
      ok: hasInput,
      detail: need === undefined
        ? '没有可用配方'
        : `${itemLabel(need.itemId)} ${observation.inputCount}/${need.count}（缓冲上限 ${inCap}）`,
    },
    {
      id: 'output-space',
      label: '输出空间',
      ok: out !== undefined && outputSpace >= out.count,
      detail: out === undefined
        ? '没有可用配方'
        : `${itemLabel(observation.outputItem)} ${observation.outputCount}/${outCap}，下一批需要 ${out.count} 格`,
    },
    {
      id: 'input-port',
      label: '输入接口盒',
      ok: box === undefined || box.count < box.capacity,
      detail: box === undefined
        ? '未安装输入接口盒（只能手动投料）'
        : `${box.count}/${box.capacity}${box.itemId === null ? '' : ` ${itemLabel(box.itemId)}`}`,
    },
    { id: 'link', label: '物料连接', ok: linkId === null, detail: linkId === null ? '输入侧连接未阻塞' : `被 ${linkId} 卡住` },
  ];
}

function machineMessageOf(context: MachineContext): string {
  const { observation, kind } = context;
  const recipe = observation.recipeId === null ? undefined : recipeOfId(observation.recipeId);
  const inputBox = boxOf(context.index, observation.partId, 'input');
  const outputBox = boxOf(context.index, observation.partId, 'output');
  const assemblyId = context.assemblyOf.get(observation.partId);
  const suffix = assemblyId === undefined ? '' : `（组合 ${assemblyId}）`;
  switch (observation.block) {
    case 'no-power':
      return `缺动力：传动断开或动力源未运转${networkNoteOf(observation.partId, context.networks)}${suffix}`;
    case 'no-input': {
      const need = recipe?.recipe.inputs[0];
      const inputNote = need === undefined
        ? '没有可用配方'
        : `需要${itemLabel(need.itemId)} ×${need.count}，缓冲只有 ${observation.inputCount}`;
      const boxNote = inputBox !== undefined && inputBox.count > 0
        ? `；输入接口盒 ${inputBox.count}/${inputBox.capacity} 件未进机器`
        : '';
      return `缺原料：${inputNote}${boxNote}${suffix}`;
    }
    case 'output-full': {
      const outNote = outputBox !== undefined && outputBox.count >= outputBox.capacity
        ? `输出接口盒已满（${outputBox.count}/${outputBox.capacity}）`
        : `机器输出缓冲已满（${observation.outputCount}/${outputCapacity(MECHANICAL_PART_DEFS[kind])}）`;
      return `输出已满：${outNote}，等下游取走${itemLabel(observation.outputItem)}${suffix}`;
    }
    case 'no-recipe':
      return `没有可用（已解锁）配方${suffix}`;
    default:
      break;
  }
  if (observation.running && recipe !== undefined) {
    return `正在加工「${recipe.recipe.label}」 ${percentOf(observation.progress)}%${suffix}`;
  }
  return `就绪，等待开工${suffix}`;
}

function machineDiagnosticOf(context: MachineContext): MachineDiagnostic {
  const { observation, kind, powered } = context;
  const recipe = observation.recipeId === null ? undefined : recipeOfId(observation.recipeId);
  const inputFull = boxOf(context.index, observation.partId, 'input');
  const outputFull = boxOf(context.index, observation.partId, 'output');
  const linkId = blockedLinkInto(observation.partId, context.links, context.buffers);
  return {
    partId: observation.partId,
    coreId: coreIdOf(kind),
    label: `${MECHANICAL_PART_DEFS[kind].label} #${observation.partId}`,
    powered,
    running: observation.running,
    block: observation.block,
    recipeId: recipe?.recipe.id ?? null,
    recipeLabel: recipe?.recipe.label ?? null,
    progress: Math.max(0, Math.min(1, observation.progress)),
    inputItem: observation.inputItem,
    inputCount: observation.inputCount,
    outputItem: observation.outputItem,
    outputCount: observation.outputCount,
    inputPortFull: inputFull !== undefined && inputFull.count >= inputFull.capacity,
    outputPortFull: outputFull !== undefined && outputFull.count >= outputFull.capacity,
    blockedLinkId: linkId,
    severity: worse(severityOfBlock(observation.block), linkId === null ? 'ok' : 'error'),
    message: machineMessageOf(context),
    conditions: conditionsOf(context),
  };
}

function linkDiagnosticOf(
  link: MaterialLinkSnapshot,
  partsById: ReadonlyMap<number, { readonly partKind: PartId }>,
  buffers: ReadonlyMap<string, InstalledPortSnapshot>,
): LinkDiagnostic {
  const verdict = linkMessageOf(link, buffers);
  const fromKind = partsById.get(link.from.entityId)?.partKind;
  const toKind = partsById.get(link.to.entityId)?.partKind;
  return {
    id: link.id,
    fromCoreId: fromKind === undefined ? 'unknown' : coreIdOf(fromKind),
    toCoreId: toKind === undefined ? 'unknown' : coreIdOf(toKind),
    state: link.status,
    transferred: link.moved,
    blocked: verdict.blocked,
    severity: verdict.severity,
    message: verdict.message,
  };
}

interface BottleneckCandidate {
  readonly kind: DiagnosticsBottleneck['kind'];
  readonly rank: number;
  readonly depth: number;
  readonly partId?: number;
  readonly linkId?: string;
  readonly label: string;
  readonly detail: string;
}

function bottleneckOf(
  machines: readonly MachineDiagnostic[],
  links: readonly LinkDiagnostic[],
  depth: ReadonlyMap<number, number>,
): DiagnosticsBottleneck | null {
  const candidates: BottleneckCandidate[] = [];
  for (const machine of machines) {
    const level = depth.get(machine.partId) ?? 0;
    if (machine.block === 'no-input') {
      candidates.push({ kind: 'supply', rank: 0, depth: level, partId: machine.partId, label: `${machine.label}：缺原料`, detail: machine.message });
    } else if (machine.block === 'no-power') {
      candidates.push({ kind: 'power', rank: 1, depth: level, partId: machine.partId, label: `${machine.label}：缺动力`, detail: machine.message });
    } else if (machine.blockedLinkId !== null) {
      candidates.push({ kind: 'logistics', rank: 2, depth: level, partId: machine.partId, linkId: machine.blockedLinkId, label: `${machine.label}：下游接口盒堵塞`, detail: machine.message });
    } else if (machine.block === 'output-full') {
      candidates.push({ kind: 'output', rank: 3, depth: level, partId: machine.partId, label: `${machine.label}：输出已满`, detail: machine.message });
    }
  }
  if (candidates.length === 0) {
    const blocked = links.find((link) => link.blocked);
    if (blocked === undefined) return null;
    return { kind: 'logistics', label: `物料连接阻塞：${blocked.id}`, detail: blocked.message, linkId: blocked.id };
  }
  candidates.sort((left, right) => (
    left.depth - right.depth
    || left.rank - right.rank
    || (left.partId ?? 0) - (right.partId ?? 0)
    || (left.linkId ?? '').localeCompare(right.linkId ?? '')
  ));
  const best = candidates[0] as BottleneckCandidate;
  return {
    kind: best.kind,
    label: best.label,
    detail: best.detail,
    ...(best.partId === undefined ? {} : { partId: best.partId }),
    ...(best.linkId === undefined ? {} : { linkId: best.linkId }),
  };
}

/**
 * 构造诊断快照：`unlocked=false`（`tech.hasCapability('line-diagnostics')` 为 false）时返回 **null**。
 * 「诊断不是空数据，而是玩家还没解锁这个视图」；插件把本函数结果原样提供为 snapshot()。
 */
export function diagnosticsSnapshot(source: DiagnosticsSource, unlocked: boolean): DiagnosticsSnapshot | null {
  return unlocked ? buildDiagnostics(source) : null;
}

/** 不做门控的纯构造（测试与终局运行证明复用）。 */
export function buildDiagnostics(source: DiagnosticsSource): DiagnosticsSnapshot {
  const { observation } = source;
  const partsById = new Map<number, { readonly partKind: PartId }>();
  const poweredById = new Map<number, boolean>();
  for (const part of observation.parts) {
    partsById.set(part.partId, { partKind: part.partKind });
    poweredById.set(part.partId, part.powered === true && part.stalled !== true);
  }
  const index = indexPorts(source.ports);
  const buffers = new Map<string, InstalledPortSnapshot>();
  for (const port of source.ports) buffers.set(bufferKey(port.partId, port.slotId), port);
  const assemblyOf = new Map<number, string>();
  for (const assembly of source.assemblies ?? []) {
    for (const memberId of assembly.memberIds) assemblyOf.set(memberId, assembly.id);
  }
  const links = [...source.links]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((link) => linkDiagnosticOf(link, partsById, buffers));
  const machines: MachineDiagnostic[] = [];
  for (const machine of [...observation.machines].sort((left, right) => left.partId - right.partId)) {
    const kind = partsById.get(machine.partId)?.partKind;
    if (kind === undefined) continue;
    machines.push(machineDiagnosticOf({
      kind,
      observation: machine,
      powered: poweredById.get(machine.partId) === true,
      index,
      links: source.links,
      buffers,
      networks: observation.networks,
      assemblyOf,
    }));
  }
  const running = machines.filter((machine) => machine.running).length;
  const blockedCount = machines.filter((machine) => machine.severity === 'error').length;
  return {
    unlocked: true,
    machines,
    links,
    bottleneck: bottleneckOf(machines, links, depthMapOf(observation.machines, source.links)),
    summary: {
      total: machines.length,
      running,
      idle: Math.max(0, machines.length - running - blockedCount),
      blocked: blockedCount,
      powered: machines.filter((machine) => machine.powered).length,
    },
    hasError: machines.some((machine) => machine.severity === 'error')
      || links.some((link) => link.severity === 'error'),
  };
}
