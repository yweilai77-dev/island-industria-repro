/**
 * 存档切片规整原语（纯函数、零引擎依赖）：安全类型转换、钳制、id 校验与默认值。
 */
import { cellToCenter, isRotation } from '../grid/grid.ts';
import { getItemDefinition, type ItemId } from '../items/items.ts';
import { BUILDING_TYPES } from '../build/build.ts';
import { MECHANICAL_PART_DEFS } from '../mechanical/parts.ts';
import { PLAYER_BOUNDS_X, PLAYER_BOUNDS_Z, PLAYER_START_CELL } from '../player/player.ts';
import type { SavePlayerRecord } from './save-types.ts';

export const MAX_RECORDS = 512;
/** 计数器上限。 */
export const MAX_COUNTER = 10_000_000;
/** 坐标整数绝对值上限（真实地图 ±16，这里只防损坏数据）。 */
export const MAX_CELL = 4096;
/** 层数上限（派生自标准层高的合理范围）。 */
export const MAX_LEVEL = 64;

// ---------------------------------------------------------------------------
// 基础规整原语（全部纯函数）
// ---------------------------------------------------------------------------

export interface Normalized<T> {
  readonly value: T;
  readonly issues: readonly string[];
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function integerIn(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = finiteNumber(value, fallback);
  return Math.min(max, Math.max(min, number));
}

export function knownItemId(value: unknown): ItemId | undefined {
  if (typeof value !== 'string') return undefined;
  return getItemDefinition(value as ItemId) === undefined ? undefined : value as ItemId;
}

export function finiteCell(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
  if (Math.abs(value) > MAX_CELL) return undefined;
  return value;
}

export function validId(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
  if (value < 1 || value > MAX_COUNTER) return undefined;
  return value;
}

export function validLevel(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
  if (value < 0 || value > MAX_LEVEL) return undefined;
  return value;
}

export function safeRotation(value: unknown): number {
  return isRotation(value as number) ? value as number : 0;
}

export function knownKind(value: unknown, isKnown: (kind: string) => boolean): string | undefined {
  return typeof value === 'string' && isKnown(value) ? value : undefined;
}

export function isBuildingKind(kind: string): boolean {
  return BUILDING_TYPES.some((type) => type.id === kind);
}

export function isPartKind(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(MECHANICAL_PART_DEFS, kind);
}

/** 默认玩家位置（出生格中心），供损坏/缺失的 player 切片使用。 */
export function defaultPlayer(): SavePlayerRecord {
  const center = cellToCenter(PLAYER_START_CELL);
  return { x: center[0], z: center[2], level: 0, yaw: 0 };
}

