/**
 * 存档切片规整（世界）：楼层 / 建筑 / 机械零件 / 资源 / 接口盒 / 连接 / 加工 / tech / goal / endgame。
 * 由 save-schema.ts 聚合 re-export。
 */
import type {
  SaveBuildingsData,
  SaveChuteRecord,
  SaveFloorsData,
  SaveGoalSlice,
  SaveLinkRecord,
  SaveMachineRecord,
  SaveMechanicalData,
  SavePlacementRecord,
  SavePortEndpoint,
  SavePortRecord,
  SaveProductionSlice,
  SaveResourceRecord,
  SaveSourceRecord,
} from './save-types.ts';
import type { Normalized } from './save-normalize-primitives.ts';
import {
  MAX_COUNTER,
  MAX_RECORDS,
  asArray,
  asRecord,
  clampNumber,
  finiteCell,
  finiteNumber,
  integerIn,
  knownItemId,
  knownKind,
  isBuildingKind,
  isPartKind,
  safeRotation,
  validId,
  validLevel,
} from './save-normalize-primitives.ts';
import { BUILDING_TYPES } from '../build/build.ts';
import { floorFootprint, isFloorKind } from '../build/floors.ts';
import { MECHANICAL_PART_DEFS, type PartId } from '../mechanical/parts.ts';
import { portModuleOfId } from '../industrial/port-module.ts';
import { IRON_ORE_MAX_AMOUNT, IRON_ORE_NODES } from '../resource/resource.ts';

function normalizePlacementRecords(
  raw: unknown,
  label: string,
  isKnownKind: (kind: string) => boolean,
  idSeen: Set<number>,
): Normalized<SavePlacementRecord[]> {
  const issues: string[] = [];
  if (raw !== undefined && !Array.isArray(raw)) issues.push(label + ' slice is not an array; cleared');
  const records: SavePlacementRecord[] = [];
  for (const entry of asArray(raw).slice(0, MAX_RECORDS)) {
    const source = asRecord(entry);
    const id = validId(source.id);
    if (id === undefined) { issues.push(label + ' record with invalid id dropped'); continue; }
    if (idSeen.has(id)) { issues.push(label + ' duplicate id dropped: ' + id); continue; }
    const kind = knownKind(source.kind, isKnownKind);
    if (kind === undefined) { issues.push(label + ' record with unknown kind dropped: ' + String(source.kind)); continue; }
    const gx = finiteCell(source.gx);
    const gz = finiteCell(source.gz);
    if (gx === undefined || gz === undefined) { issues.push(label + ' record with invalid cell dropped: ' + id); continue; }
    const rotation = safeRotation(source.rotation);
    const level = validLevel(source.level) ?? 0;
    idSeen.add(id);
    records.push({ id, kind, gx, gz, rotation, level });
  }
  if (asArray(raw).length > MAX_RECORDS) issues.push(label + ' list truncated');
  return { value: records, issues };
}

export function normalizeFloorsSlice(rawRecords: unknown, rawNextId: unknown): Normalized<SaveFloorsData> {
  const ids = new Set<number>();
  const records = normalizePlacementRecords(rawRecords, 'floor', isFloorKind, ids);
  const nextFloorId = integerIn(rawNextId, 1, MAX_COUNTER, 1);
  const issues = [...records.issues];
  if (nextFloorId !== rawNextId && rawNextId !== undefined) issues.push('counter nextFloorId repaired');
  return { value: { nextFloorId, floors: records.value }, issues };
}

export function normalizeBuildingsSlice(rawRecords: unknown, rawNextId: unknown): Normalized<SaveBuildingsData> {
  const ids = new Set<number>();
  const records = normalizePlacementRecords(rawRecords, 'building', isBuildingKind, ids);
  const nextBuildingId = integerIn(rawNextId, 1, MAX_COUNTER, 1);
  const issues = [...records.issues];
  if (nextBuildingId !== rawNextId && rawNextId !== undefined) issues.push('counter nextBuildingId repaired');
  return { value: { nextBuildingId, buildings: records.value }, issues };
}

export function normalizePartsSlice(rawRecords: unknown, rawNextId: unknown): Normalized<SaveMechanicalData> {
  const ids = new Set<number>();
  const records = normalizePlacementRecords(rawRecords, 'part', isPartKind, ids);
  const nextPartId = integerIn(rawNextId, 1, MAX_COUNTER, 1);
  const issues = [...records.issues];
  if (nextPartId !== rawNextId && rawNextId !== undefined) issues.push('counter nextPartId repaired');
  return { value: { nextPartId, kitGranted: false, parts: records.value }, issues };
}

export function normalizeSourcesSlice(raw: unknown): Normalized<readonly SaveSourceRecord[]> {
  const issues: string[] = [];
  const records: SaveSourceRecord[] = [];
  const seen = new Set<number>();
  for (const entry of asArray(raw).slice(0, MAX_RECORDS)) {
    const source = asRecord(entry);
    const partId = validId(source.partId);
    if (partId === undefined) { issues.push('source record with invalid partId dropped'); continue; }
    if (seen.has(partId)) { issues.push('duplicate source record for part ' + partId + ' dropped'); continue; }
    seen.add(partId);
    records.push({ partId, enabled: source.enabled === true });
  }
  if (raw !== undefined && !Array.isArray(raw)) issues.push('sources slice is not an array; cleared');
  return { value: records, issues };
}

export function normalizeResourceSlice(raw: unknown): Normalized<readonly SaveResourceRecord[]> {
  const issues: string[] = [];
  const records: SaveResourceRecord[] = [];
  const seen = new Set<number>();
  for (const entry of asArray(raw).slice(0, MAX_RECORDS)) {
    const source = asRecord(entry);
    const id = validId(source.id);
    if (id === undefined) { issues.push('resource record with invalid id dropped'); continue; }
    if (!IRON_ORE_NODES.some((node) => node.id === id)) { issues.push('unknown resource node dropped: ' + id); continue; }
    if (seen.has(id)) { issues.push('duplicate resource node dropped: ' + id); continue; }
    seen.add(id);
    const amount = integerIn(source.amount, 0, IRON_ORE_MAX_AMOUNT, 0);
    const original = finiteNumber(source.amount, 0);
    if (amount !== original) issues.push('resource amount clamped: ' + id + ' ' + original + ' -> ' + amount);
    records.push({ id, amount, depleted: amount <= 0 });
  }
  if (raw !== undefined && !Array.isArray(raw)) issues.push('resources slice is not an array; kept full nodes');
  return { value: records, issues };
}

export function normalizePortsSlice(raw: unknown): Normalized<readonly SavePortRecord[]> {
  const issues: string[] = [];
  const records: SavePortRecord[] = [];
  const seen = new Set<string>();
  for (const entry of asArray(raw).slice(0, MAX_RECORDS)) {
    const source = asRecord(entry);
    const partId = validId(source.partId);
    const slotId = typeof source.slotId === 'string' && source.slotId.length > 0 && source.slotId.length <= 96
      ? source.slotId : undefined;
    const moduleId = typeof source.moduleId === 'string' && portModuleOfId(source.moduleId as never) !== undefined
      ? source.moduleId : undefined;
    if (partId === undefined || slotId === undefined || moduleId === undefined) {
      issues.push('port record with invalid part/slot/module dropped');
      continue;
    }
    const key = partId + ':' + slotId;
    if (seen.has(key)) { issues.push('duplicate port record dropped: ' + key); continue; }
    seen.add(key);
    const rawItem = source.itemId;
    let itemId = rawItem === null || rawItem === undefined ? null : knownItemId(rawItem) ?? null;
    if (rawItem !== null && rawItem !== undefined && itemId === null) issues.push('port buffer item unknown; cleared ' + key);
    const count = integerIn(source.count, 0, 999, 0);
    if (count > 0 && itemId === null) { issues.push('port buffer count without item cleared: ' + key); records.push({ partId, slotId, moduleId, itemId: null, count: 0 }); continue; }
    if (count === 0) itemId = null;
    records.push({ partId, slotId, moduleId, itemId, count });
  }
  if (raw !== undefined && !Array.isArray(raw)) issues.push('ports slice is not an array; cleared');
  return { value: records, issues };
}

function normalizeEndpoint(raw: unknown): SavePortEndpoint | undefined {
  const source = asRecord(raw);
  const entityId = validId(source.entityId);
  const slotId = typeof source.slotId === 'string' && source.slotId.length > 0 && source.slotId.length <= 96
    ? source.slotId : undefined;
  if (entityId === undefined || slotId === undefined) return undefined;
  return { entityId, slotId };
}

export function normalizeLinksSlice(raw: unknown): Normalized<readonly SaveLinkRecord[]> {
  const issues: string[] = [];
  const records: SaveLinkRecord[] = [];
  const seen = new Set<string>();
  for (const entry of asArray(raw).slice(0, MAX_RECORDS)) {
    const source = asRecord(entry);
    const id = typeof source.id === 'string' && source.id.length > 0 && source.id.length <= 192 ? source.id : undefined;
    const from = normalizeEndpoint(source.from);
    const to = normalizeEndpoint(source.to);
    if (id === undefined || from === undefined || to === undefined) {
      issues.push('link record with invalid id/endpoint dropped');
      continue;
    }
    if (seen.has(id)) { issues.push('duplicate link dropped: ' + id); continue; }
    seen.add(id);
    const moved = integerIn(source.moved, 0, MAX_COUNTER, 0);
    records.push({ id, from, to, moved });
  }
  if (raw !== undefined && !Array.isArray(raw)) issues.push('links slice is not an array; cleared');
  return { value: records, issues };
}

export function normalizeProductionSlice(raw: unknown): Normalized<SaveProductionSlice> {
  const source = asRecord(raw);
  const issues: string[] = [];
  const machines: SaveMachineRecord[] = [];
  const seenMachines = new Set<number>();
  for (const entry of asArray(source.machines).slice(0, MAX_RECORDS)) {
    const record = asRecord(entry);
    const partId = validId(record.partId);
    if (partId === undefined || seenMachines.has(partId)) { issues.push('production machine with invalid/duplicate partId dropped'); continue; }
    seenMachines.add(partId);
    const recipeId = typeof record.recipeId === 'string' && record.recipeId.length > 0 && record.recipeId.length <= 96
      ? record.recipeId : null;
    const inputItem = record.inputItem === null || record.inputItem === undefined ? null : knownItemId(record.inputItem) ?? null;
    const outputItem = record.outputItem === null || record.outputItem === undefined ? null : knownItemId(record.outputItem) ?? null;
    let inputCount = integerIn(record.inputCount, 0, 64, 0);
    let outputCount = integerIn(record.outputCount, 0, 64, 0);
    if (inputCount > 0 && inputItem === null) { inputCount = 0; issues.push('machine input without item cleared: ' + partId); }
    if (outputCount > 0 && outputItem === null) { outputCount = 0; issues.push('machine output without item cleared: ' + partId); }
    machines.push({
      partId,
      recipeId,
      progress: clampNumber(record.progress, 0, 1, 0),
      inputItem: inputCount > 0 ? inputItem : null,
      inputCount,
      outputItem: outputCount > 0 ? outputItem : null,
      outputCount,
      producedTotal: integerIn(record.producedTotal, 0, MAX_COUNTER, 0),
    });
  }
  const chutes: SaveChuteRecord[] = [];
  const seenChutes = new Set<number>();
  for (const entry of asArray(source.chutes).slice(0, MAX_RECORDS)) {
    const record = asRecord(entry);
    const partId = validId(record.partId);
    if (partId === undefined || seenChutes.has(partId)) { issues.push('chute record with invalid/duplicate partId dropped'); continue; }
    seenChutes.add(partId);
    const itemId = record.itemId === null || record.itemId === undefined ? null : knownItemId(record.itemId) ?? null;
    chutes.push({
      partId,
      itemId,
      t: clampNumber(record.t, 0, 1, 0),
      blocked: record.blocked === true,
      delivered: integerIn(record.delivered, 0, MAX_COUNTER, 0),
    });
  }
  if (raw !== undefined && !Array.isArray(source.machines) && !Array.isArray(source.chutes)) {
    issues.push('production slice missing; runtime buffers cleared');
  }
  return { value: { machines, chutes }, issues };
}

/** 科技切片：不做结构解释（tech.restore 自己校验），只要求是 JSON 对象。 */
export function normalizeTechSlice(raw: unknown): Normalized<unknown | undefined> {
  if (raw === undefined) return { value: undefined, issues: [] };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { value: undefined, issues: ['tech slice is not an object; dropped'] };
  }
  // 防御性深拷贝：快照数组/对象绝不与调用方共享引用（tech 是后续 tech.restore 的不可信输入）。
  try {
    return { value: JSON.parse(JSON.stringify(raw)) as unknown, issues: [] };
  } catch {
    return { value: undefined, issues: ['tech slice is not JSON serializable; dropped'] };
  }
}

/** 终局切片：只要求是版本 1 的 JSON 对象；结构由 endgame.restore 自己校验。 */
export function normalizeEndgameSlice(raw: unknown): Normalized<unknown | undefined> {
  if (raw === undefined) return { value: undefined, issues: [] };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { value: undefined, issues: ['endgame slice is not an object; dropped'] };
  }
  const source = raw as Record<string, unknown>;
  if (source.version !== 1) {
    return { value: undefined, issues: ['unsupported endgame state version: ' + String(source.version)] };
  }
  try {
    return { value: JSON.parse(JSON.stringify(source)) as unknown, issues: [] };
  } catch {
    return { value: undefined, issues: ['endgame slice is not JSON serializable; dropped'] };
  }
}

/** 订单切片（预留）：只校验形状，恢复由 goal-service 以后接入。 */
export function normalizeGoalSlice(raw: unknown): Normalized<SaveGoalSlice | undefined> {
  if (raw === undefined) return { value: undefined, issues: [] };
  const source = asRecord(raw);
  const baseline = asRecord(source.baseline);
  const completed = asArray(source.completed).filter((entry): entry is string => typeof entry === 'string').slice(0, 32);
  const value: SaveGoalSlice = {
    baseline: {
      crushedOre: integerIn(baseline.crushedOre, 0, MAX_COUNTER, 0),
      ironIngot: integerIn(baseline.ironIngot, 0, MAX_COUNTER, 0),
      shaft: integerIn(baseline.shaft, 0, MAX_COUNTER, 0),
    },
    completed,
  };
  return { value, issues: [] };
}

/** kind → 该定义是否存在（供 restore 侧复用，避免每个系统各写一份）。 */
export function isKnownBuildingKind(kind: string): boolean { return isBuildingKind(kind); }
export function isKnownPartKind(kind: string): boolean { return isPartKind(kind); }
export function isKnownFloorKind(kind: string): boolean { return isFloorKind(kind); }

/** 该机械零件定义的 1×1 足迹（供 restore 侧构造 Placement）。 */
export function partFootprint(partId: PartId): { readonly w: number; readonly d: number } {
  const definition = MECHANICAL_PART_DEFS[partId];
  return { w: definition.w, d: definition.d };
}

/** 建筑 kind 的静态足迹（供 restore 侧构造 Placement）。 */
export function buildingFootprint(kind: string): { readonly w: number; readonly d: number } | undefined {
  return BUILDING_TYPES.find((type) => type.id === kind);
}

/** 楼层 kind 的静态足迹。 */
export function floorFootprintOf(kind: string): { readonly w: number; readonly d: number } | undefined {
  if (!isFloorKind(kind)) return undefined;
  return floorFootprint(kind);
}
