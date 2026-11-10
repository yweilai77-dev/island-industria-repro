/**
 * M2.0-P2-E3 正式存档 v1：快照类型、版本号与**每个切片的纯校验/规整函数**。
 *
 * 边界（重要）：
 * - 本文件零引擎依赖（只 import 纯数据定义），因此可在单测里直接跑；
 * - 只保存**逻辑状态**（id/kind/placement/数量/进度），绝不保存 EntityHandle、Map、Set、
 *   派生量（空间索引/支撑面/可通行面/动力解算/视图实体/连接拓扑/加工锁存原因）；
 * - 所有规整函数都是**纯函数**：非法值钳制或丢弃并返回 issues，绝不抛异常；
 * - 未知字段一律丢弃（只按下面的显式字段表重建对象），未知系统同理。
 *
 * 快照 JSON（v1）：
 *   version/savedAt/engine
 *   player     { x, z, level, yaw }
 *   inventory  { stacks: [{ itemId, count }] }
 *   hotbar     { slots: (string|null)[12], selected }
 *   kitGranted boolean
 *   counters   { nextBuildingId, nextPartId, nextFloorId }
 *   floors     [{ id, kind, gx, gz, rotation, level }]
 *   buildings  [{ id, kind, gx, gz, rotation, level }]
 *   parts      [{ id, kind, gx, gz, rotation, level }]
 *   sources    [{ partId, enabled }]
 *   resources  [{ id, amount, depleted }]
 *   ports      [{ partId, slotId, moduleId, itemId, count }]
 *   links      [{ id, from:{entityId,slotId}, to:{entityId,slotId}, moved }]
 *   production { machines:[...], chutes:[...] }
 *   tech       TechState JSON（由 tech.serialize() 产生，版本独立）
 *   goal       { baseline:{crushedOre,ironIngot,shaft}, completed:[...] }（预留，恢复待接）
 *
 * 说明：诊断（diagnostics）与终局运行证明（endgame proof）全部由真实状态派生，
 * 不进快照；终局完成标记就是 TechState 里的 T3.3 交付进度。
 */
import { cellToCenter, isRotation } from '../grid/grid.ts';
import { getItemDefinition, type ItemId } from '../items/items.ts';
import { BUILDING_TYPES } from '../build/build.ts';
import { floorFootprint, isFloorKind } from '../build/floors.ts';
import { MECHANICAL_PART_DEFS, type PartId } from '../mechanical/parts.ts';
import { HOTBAR_SLOT_COUNT, type HotbarSlot } from '../hotbar/hotbar.ts';
import { IRON_ORE_MAX_AMOUNT, IRON_ORE_NODES } from '../resource/resource.ts';
import { portModuleOfId } from '../industrial/port-module.ts';
import { PLAYER_BOUNDS_X, PLAYER_BOUNDS_Z, PLAYER_START_CELL } from '../player/player.ts';

/** 当前快照版本（结构不兼容时 +1，并在 save-codec.ts 里补迁移函数）。 */
export const SAVE_VERSION = 1;
/** 引擎版本记录，仅用于排障与迁移决策，不参与校验。 */
export const SAVE_ENGINE_VERSION = '0.4.19';
/** 单份存档 JSON 的最大字符数；超过直接拒绝，避免恶意/损坏数据撑爆内存。 */
export const SAVE_MAX_CHARS = 512 * 1024;
/** 每个数组切片的硬上限（正常存档远低于它，只防损坏数据）。 */
const MAX_RECORDS = 512;
/** 计数器上限。 */
const MAX_COUNTER = 10_000_000;
/** 坐标整数绝对值上限（真实地图 ±16，这里只防损坏数据）。 */
const MAX_CELL = 4096;
/** 层数上限（派生自标准层高的合理范围）。 */
const MAX_LEVEL = 64;

export interface SaveRestoreReport {
  readonly restored: number;
  readonly issues: readonly string[];
}

export interface SavePlayerRecord {
  readonly x: number;
  readonly z: number;
  readonly level: number;
  readonly yaw: number;
}

export interface SaveInventoryStack {
  readonly itemId: ItemId;
  readonly count: number;
}

export interface SaveInventorySlice {
  readonly stacks: readonly SaveInventoryStack[];
}

export interface SaveHotbarSlice {
  readonly slots: readonly HotbarSlot[];
  readonly selected: number;
}

export interface SaveCounters {
  readonly nextBuildingId: number;
  readonly nextPartId: number;
  readonly nextFloorId: number;
}

/** 楼层/建筑/机械零件共用的逻辑放置记录：kind 是稳定定义 ID。 */
export interface SavePlacementRecord {
  readonly id: number;
  readonly kind: string;
  readonly gx: number;
  readonly gz: number;
  readonly rotation: number;
  readonly level: number;
}

export type SaveFloorRecord = SavePlacementRecord;
export type SaveBuildingRecord = SavePlacementRecord;
export type SavePartRecord = SavePlacementRecord;

export interface SaveSourceRecord {
  readonly partId: number;
  readonly enabled: boolean;
}

export interface SaveResourceRecord {
  readonly id: number;
  readonly amount: number;
  /** 由 amount 派生，存档里存一份便于人工排查；恢复时以 amount 为准。 */
  readonly depleted: boolean;
}

export interface SavePortRecord {
  readonly partId: number;
  readonly slotId: string;
  readonly moduleId: string;
  readonly itemId: ItemId | null;
  readonly count: number;
}

export interface SavePortEndpoint {
  readonly entityId: number;
  readonly slotId: string;
}

export interface SaveLinkRecord {
  readonly id: string;
  readonly from: SavePortEndpoint;
  readonly to: SavePortEndpoint;
  readonly moved: number;
}

export interface SaveMachineRecord {
  readonly partId: number;
  readonly recipeId: string | null;
  readonly progress: number;
  readonly inputItem: ItemId | null;
  readonly inputCount: number;
  readonly outputItem: ItemId | null;
  readonly outputCount: number;
  readonly producedTotal: number;
}

export interface SaveChuteRecord {
  readonly partId: number;
  readonly itemId: ItemId | null;
  readonly t: number;
  readonly blocked: boolean;
  readonly delivered: number;
}

export interface SaveProductionSlice {
  readonly machines: readonly SaveMachineRecord[];
  readonly chutes: readonly SaveChuteRecord[];
}

export interface SaveGoalSlice {
  readonly baseline: {
    readonly crushedOre: number;
    readonly ironIngot: number;
    readonly shaft: number;
  };
  readonly completed: readonly string[];
}

export interface SavePortsData {
  readonly ports: readonly SavePortRecord[];
  readonly links: readonly SaveLinkRecord[];
}

export interface SaveBuildingsData {
  readonly nextBuildingId: number;
  readonly buildings: readonly SaveBuildingRecord[];
}

export interface SaveFloorsData {
  readonly nextFloorId: number;
  readonly floors: readonly SaveFloorRecord[];
}

export interface SaveMechanicalData {
  readonly nextPartId: number;
  readonly kitGranted: boolean;
  readonly parts: readonly SavePartRecord[];
}

export interface SaveSnapshot {
  readonly version: number;
  readonly savedAt: string;
  readonly engine: string;
  readonly player: SavePlayerRecord;
  readonly inventory: SaveInventorySlice;
  readonly hotbar: SaveHotbarSlice;
  readonly kitGranted: boolean;
  readonly counters: SaveCounters;
  readonly floors: readonly SaveFloorRecord[];
  readonly buildings: readonly SaveBuildingRecord[];
  readonly parts: readonly SavePartRecord[];
  readonly sources: readonly SaveSourceRecord[];
  readonly resources: readonly SaveResourceRecord[];
  readonly ports: readonly SavePortRecord[];
  readonly links: readonly SaveLinkRecord[];
  readonly production: SaveProductionSlice;
  /** 科技状态：tech.serialize() 的原样 JSON（版本由 TECH_STATE_VERSION 管理）。 */
  readonly tech?: unknown;
  /** 工业订单状态（预留：goal-service 目前只读，本题先存不恢复）。 */
  readonly goal?: SaveGoalSlice;
}

// ---------------------------------------------------------------------------
// 基础规整原语（全部纯函数）
// ---------------------------------------------------------------------------

export interface Normalized<T> {
  readonly value: T;
  readonly issues: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function integerIn(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = finiteNumber(value, fallback);
  return Math.min(max, Math.max(min, number));
}

function knownItemId(value: unknown): ItemId | undefined {
  if (typeof value !== 'string') return undefined;
  return getItemDefinition(value as ItemId) === undefined ? undefined : value as ItemId;
}

function finiteCell(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
  if (Math.abs(value) > MAX_CELL) return undefined;
  return value;
}

function validId(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
  if (value < 1 || value > MAX_COUNTER) return undefined;
  return value;
}

function validLevel(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
  if (value < 0 || value > MAX_LEVEL) return undefined;
  return value;
}

function safeRotation(value: unknown): number {
  return isRotation(value as number) ? value as number : 0;
}

function knownKind(value: unknown, isKnown: (kind: string) => boolean): string | undefined {
  return typeof value === 'string' && isKnown(value) ? value : undefined;
}

function isBuildingKind(kind: string): boolean {
  return BUILDING_TYPES.some((type) => type.id === kind);
}

function isPartKind(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(MECHANICAL_PART_DEFS, kind);
}

/** 默认玩家位置（出生格中心），供损坏/缺失的 player 切片使用。 */
function defaultPlayer(): SavePlayerRecord {
  const center = cellToCenter(PLAYER_START_CELL);
  return { x: center[0], z: center[2], level: 0, yaw: 0 };
}

// ---------------------------------------------------------------------------
// 各切片规整
// ---------------------------------------------------------------------------

export function normalizePlayerSlice(raw: unknown): Normalized<SavePlayerRecord> {
  const source = asRecord(raw);
  if (raw === undefined) return { value: defaultPlayer(), issues: ['player slice missing; using spawn'] };
  const fallback = defaultPlayer();
  const x = finiteNumber(source.x, fallback.x);
  const z = finiteNumber(source.z, fallback.z);
  const issues: string[] = [];
  const clampedX = Math.min(PLAYER_BOUNDS_X, Math.max(-PLAYER_BOUNDS_X, x));
  const clampedZ = Math.min(PLAYER_BOUNDS_Z, Math.max(-PLAYER_BOUNDS_Z, z));
  if (clampedX !== x) issues.push('player x clamped to map bounds');
  if (clampedZ !== z) issues.push('player z clamped to map bounds');
  const level = integerIn(source.level, 0, MAX_LEVEL, 0);
  if (level !== source.level) issues.push('player level repaired to 0');
  const yaw = finiteNumber(source.yaw, 0);
  if (yaw !== source.yaw) issues.push('player yaw repaired to 0');
  return { value: { x: clampedX, z: clampedZ, level, yaw }, issues };
}

export function normalizeInventorySlice(raw: unknown): Normalized<SaveInventorySlice> {
  const source = asRecord(raw);
  const rawStacks = Array.isArray(source.stacks) ? source.stacks : [];
  const issues: string[] = [];
  if (raw !== undefined && !Array.isArray(source.stacks)) issues.push('inventory.stacks missing; inventory cleared');
  const stacks: SaveInventoryStack[] = [];
  const seen = new Set<ItemId>();
  for (const entry of rawStacks.slice(0, MAX_RECORDS)) {
    const record = asRecord(entry);
    const itemId = knownItemId(record.itemId);
    if (itemId === undefined) {
      issues.push('inventory stack with unknown item dropped');
      continue;
    }
    if (seen.has(itemId)) {
      issues.push('duplicate inventory stack for ' + itemId + ' dropped');
      continue;
    }
    seen.add(itemId);
    const definition = getItemDefinition(itemId);
    if (definition === undefined) continue;
    const count = integerIn(record.count, 0, definition.maxStack, 0);
    if (count <= 0) {
      issues.push('inventory stack with invalid count dropped: ' + itemId);
      continue;
    }
    const original = finiteNumber(record.count, 0);
    if (count !== original) issues.push('inventory count clamped: ' + itemId + ' ' + original + ' -> ' + count);
    stacks.push({ itemId, count });
  }
  if (rawStacks.length > MAX_RECORDS) issues.push('inventory stack list truncated');
  return { value: { stacks }, issues };
}

export function normalizeHotbarSlice(raw: unknown): Normalized<SaveHotbarSlice> {
  const source = asRecord(raw);
  const issues: string[] = [];
  const rawSlots = Array.isArray(source.slots) ? source.slots : [];
  const slots: HotbarSlot[] = [];
  const seen = new Set<ItemId>();
  for (let index = 0; index < HOTBAR_SLOT_COUNT; index += 1) {
    const rawSlot = rawSlots[index];
    if (rawSlot === undefined || rawSlot === null) {
      slots.push(null);
      continue;
    }
    const itemId = knownItemId(rawSlot);
    if (itemId === undefined) {
      issues.push('hotbar slot ' + index + ' with unknown item cleared');
      slots.push(null);
      continue;
    }
    if (seen.has(itemId)) {
      issues.push('duplicate hotbar binding ' + itemId + ' cleared at slot ' + index);
      slots.push(null);
      continue;
    }
    seen.add(itemId);
    slots.push(itemId);
  }
  if (rawSlots.length > HOTBAR_SLOT_COUNT) issues.push('hotbar has more than ' + HOTBAR_SLOT_COUNT + ' slots; extra dropped');
  const selected = integerIn(source.selected, 0, HOTBAR_SLOT_COUNT - 1, 0);
  if (selected !== source.selected) issues.push('hotbar selected slot clamped');
  return { value: { slots, selected }, issues };
}

export function normalizeKitGranted(raw: unknown): Normalized<boolean> {
  if (typeof raw === 'boolean') return { value: raw, issues: [] };
  if (raw === undefined) return { value: false, issues: ['kitGranted missing; defaulted to false'] };
  return { value: raw === true, issues: ['kitGranted repaired to false'] };
}

export function normalizeCounters(raw: unknown): Normalized<SaveCounters> {
  const source = asRecord(raw);
  const issues: string[] = [];
  const read = (key: 'nextBuildingId' | 'nextPartId' | 'nextFloorId'): number => {
    const value = integerIn(source[key], 1, MAX_COUNTER, 1);
    if (value !== source[key] && source[key] !== undefined) issues.push('counter ' + key + ' repaired');
    return value;
  };
  if (raw === undefined) issues.push('counters missing; defaults used');
  return { value: { nextBuildingId: read('nextBuildingId'), nextPartId: read('nextPartId'), nextFloorId: read('nextFloorId') }, issues };
}

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

export function normalizeSavedAt(raw: unknown): Normalized<string> {
  if (typeof raw === 'string' && !Number.isNaN(Date.parse(raw))) return { value: raw, issues: [] };
  return { value: new Date(0).toISOString(), issues: ['savedAt missing/invalid; using epoch'] };
}

export function normalizeEngine(raw: unknown): Normalized<string> {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 32
    ? { value: raw, issues: [] }
    : { value: SAVE_ENGINE_VERSION, issues: [] };
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
