import type { EndgameSnapshot } from '../endgame/endgame-types.ts';
import type { DiagnosticsSnapshot } from '../diagnostics/diagnostics-types.ts';
import type { PersistenceSnapshot } from '../save/persistence.pack.ts';

/**
 * P2-E2 桥接层的「服务快照签名」（纯函数，零引擎依赖）。
 *
 * 目的：只有服务快照内容变化时才向 UI 重新广播状态消息，避免每帧刷新 DOM。
 * 不依赖服务自己维护的 revision（E2 阶段终局/诊断/存档服务由别人实现，
 * revision 的语义尚未联调）；直接用快照内容做签名更稳。
 */

export function projectSignature(project: EndgameSnapshot | null): string {
  if (!project) return 'project:none';
  const entries = project.delivery.entries
    .map((entry) => `${entry.itemId}:${entry.delivered}/${entry.required}`)
    .join(',');
  const conditions = project.proof.conditions
    .map((condition) => `${condition.id}:${condition.ok ? '+' : '-'}:${condition.current}`)
    .join(',');
  const blocks = project.blocks.join('|');
  return [
    'project',
    project.projectId,
    project.completed ? 'C' : project.unlocked ? 'U' : 'L',
    project.delivery.totalDelivered,
    entries,
    project.proof.state,
    project.proof.elapsedSeconds,
    project.proof.produced,
    project.proof.failureReason ?? '-',
    conditions,
    blocks,
  ].join(':');
}

export function diagnosticsSignature(diagnostics: DiagnosticsSnapshot | null): string {
  if (!diagnostics) return 'diagnostics:none';
  const machines = diagnostics.machines
    .map((machine) => [
      machine.coreId,
      machine.powered ? 'P' : '-',
      machine.running ? 'R' : '-',
      machine.block,
      Math.round(machine.progress * 100),
      machine.inputCount,
      machine.outputCount,
    ].join('/'))
    .join(',');
  const links = diagnostics.links
    .map((link) => `${link.id}:${link.state}:${link.transferred}:${link.blocked ? 'B' : '-'}`)
    .join(',');
  const summary = diagnostics.summary;
  return [
    'diagnostics',
    diagnostics.hasError ? 'E' : '-',
    summary.total, summary.running, summary.idle, summary.blocked, summary.powered,
    machines,
    links,
    diagnostics.bottleneck ? `${diagnostics.bottleneck.kind}:${diagnostics.bottleneck.label}` : 'none',
  ].join(':');
}

export function saveSignature(save: PersistenceSnapshot | null): string {
  if (!save) return 'save:none';
  return ['save', save.status, save.savedAt ?? '-', save.version, save.hasSave ? '1' : '0', save.message ?? '-'].join(':');
}
