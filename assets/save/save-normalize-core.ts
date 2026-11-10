/**
 * 存档切片规整（核心）：玩家 / 库存 / 快捷栏 / 起步包标记 / 计数器 / 时间戳。
 * 由 save-schema.ts 聚合 re-export。
 */
import type {
  SaveCounters,
  SaveHotbarSlice,
  SaveInventorySlice,
  SaveInventoryStack,
  SavePlayerRecord,
} from './save-types.ts';
import { SAVE_ENGINE_VERSION } from './save-types.ts';
import type { ItemId } from '../items/items.ts';
import type { HotbarSlot } from '../hotbar/hotbar.ts';
import type { Normalized } from './save-normalize-primitives.ts';
import {
  MAX_COUNTER,
  MAX_LEVEL,
  MAX_RECORDS,
  asRecord,
  defaultPlayer,
  finiteNumber,
  integerIn,
  knownItemId,
} from './save-normalize-primitives.ts';
import { getItemDefinition } from '../items/items.ts';
import { HOTBAR_SLOT_COUNT } from '../hotbar/hotbar.ts';
import { IRON_ORE_MAX_AMOUNT, IRON_ORE_NODES } from '../resource/resource.ts';
import { PLAYER_BOUNDS_X, PLAYER_BOUNDS_Z } from '../player/player.ts';

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


export function normalizeSavedAt(raw: unknown): Normalized<string> {
  if (typeof raw === 'string' && !Number.isNaN(Date.parse(raw))) return { value: raw, issues: [] };
  return { value: new Date(0).toISOString(), issues: ['savedAt missing/invalid; using epoch'] };
}

export function normalizeEngine(raw: unknown): Normalized<string> {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 32
    ? { value: raw, issues: [] }
    : { value: SAVE_ENGINE_VERSION, issues: [] };
}

