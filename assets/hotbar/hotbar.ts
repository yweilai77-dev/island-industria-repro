import { getItemDefinition, type ItemId } from '../items/items.ts';
import type { SaveHotbarSlice } from '../save/save-schema.ts';
import type { SaveRestoreReport } from '../save/save-ports.ts';

/**
 * 快捷栏固定槽位数量。
 * M1.8：机械零件从 5 种增加到 11 种，8 格装不下（`bind` 越界会抛 RangeError 导致启动失败），
 * 扩到 12 格。键盘 Digit1-9/0 覆盖前 10 格，第 11、12 格用鼠标点 UI 选择。
 */
export const HOTBAR_SLOT_COUNT = 12;

export type HotbarSlot = ItemId | null;

export interface HotbarState {
  slots: HotbarSlot[];
  selected: number;
  /** 每次变更递增，前端用它判断是否需要重绘。 */
  revision: number;
}

export function createHotbarState(): HotbarState {
  return {
    slots: Array.from({ length: HOTBAR_SLOT_COUNT }, () => null),
    selected: 0,
    revision: 0,
  };
}

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SLOT_COUNT) {
    throw new RangeError(`hotbar slot must be an integer in [0, ${HOTBAR_SLOT_COUNT - 1}], received ${String(slot)}`);
  }
}

/** 选择槽位；返回是否发生变化。 */
export function selectSlot(state: HotbarState, slot: number): boolean {
  assertSlot(slot);
  if (state.selected === slot) return false;
  state.selected = slot;
  state.revision += 1;
  return true;
}

/**
 * 绑定物品到槽位（替换语义）：
 * - 若该物品已绑定在其他槽，先解除旧绑定（移动而非复制）；
 * - 目标槽原有物品被替换（解除绑定）；
 * - 同物品重复绑定到同一槽不改变状态。
 */
export function bindItem(state: HotbarState, slot: number, itemId: ItemId): boolean {
  assertSlot(slot);
  if (state.slots[slot] === itemId) return false;
  for (let index = 0; index < state.slots.length; index += 1) {
    if (index !== slot && state.slots[index] === itemId) {
      state.slots[index] = null;
    }
  }
  state.slots[slot] = itemId;
  state.revision += 1;
  return true;
}

/** 解除槽位绑定；返回是否发生变化。 */
export function unbindSlot(state: HotbarState, slot: number): boolean {
  assertSlot(slot);
  if (state.slots[slot] === null) return false;
  state.slots[slot] = null;
  state.revision += 1;
  return true;
}

/** 清除库存数量为 0 的物品绑定；返回被解除的物品 ID 列表。 */
export function dropUnavailable(
  state: HotbarState,
  countOf: (itemId: ItemId) => number,
): readonly ItemId[] {
  const removed: ItemId[] = [];
  for (let index = 0; index < state.slots.length; index += 1) {
    const itemId = state.slots[index];
    if (itemId === null) continue;
    if (countOf(itemId) > 0) continue;
    state.slots[index] = null;
    removed.push(itemId);
  }
  if (removed.length > 0) state.revision += 1;
  return removed;
}

export interface HotbarSnapshot {
  readonly slots: readonly HotbarSlot[];
  readonly selected: number;
  readonly revision: number;
}

export function hotbarSnapshot(state: HotbarState): HotbarSnapshot {
  return { slots: [...state.slots], selected: state.selected, revision: state.revision };
}

export interface HotbarService {
  readonly slots: readonly HotbarSlot[];
  readonly selected: number;
  readonly revision: number;
  select(slot: number): boolean;
  bind(slot: number, itemId: ItemId): boolean;
  unbind(slot: number): boolean;
  dropUnavailable(countOf: (itemId: ItemId) => number): readonly ItemId[];
  /** 存档切片：槽位绑定 + 选中槽（纯 JSON）。 */
  snapshot(): SaveHotbarSlice;
  /** 从不可信存档数据恢复：非法槽位/未知物品/重复绑定逐条丢弃并返回 issues。 */
  restore(raw: unknown): SaveRestoreReport;
}

/** 由纯逻辑组装的服务（插件与测试共用）。 */
export function createHotbarService(): HotbarService {
  const state = createHotbarState();
  return {
    get slots() {
      return state.slots;
    },
    get selected() {
      return state.selected;
    },
    get revision() {
      return state.revision;
    },
    select: (slot) => selectSlot(state, slot),
    bind: (slot, itemId) => bindItem(state, slot, itemId),
    unbind: (slot) => unbindSlot(state, slot),
    dropUnavailable: (countOf) => dropUnavailable(state, countOf),
    snapshot: () => ({ slots: [...state.slots], selected: state.selected }),
    restore: (raw) => {
      const issues: string[] = [];
      const source = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
      const rawSlots = Array.isArray(source.slots) ? source.slots : [];
      state.slots = Array.from({ length: HOTBAR_SLOT_COUNT }, () => null);
      state.selected = 0;
      const seen = new Set<ItemId>();
      for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
        const value = rawSlots[slot];
        if (value === null || value === undefined) continue;
        if (typeof value !== 'string' || getItemDefinition(value as ItemId) === undefined) {
          issues.push('hotbar slot ' + slot + ' dropped: unknown item ' + String(value));
          continue;
        }
        const itemId = value as ItemId;
        if (seen.has(itemId)) {
          issues.push('hotbar duplicate binding dropped at slot ' + slot + ': ' + itemId);
          continue;
        }
        seen.add(itemId);
        state.slots[slot] = itemId;
      }
      if (rawSlots.length > HOTBAR_SLOT_COUNT) issues.push('hotbar slots truncated to ' + HOTBAR_SLOT_COUNT);
      const selected = typeof source.selected === 'number' && Number.isInteger(source.selected)
        ? Math.min(HOTBAR_SLOT_COUNT - 1, Math.max(0, source.selected))
        : 0;
      if (selected !== source.selected && source.selected !== undefined) issues.push('hotbar selected repaired');
      state.selected = selected;
      state.revision += 1;
      return { restored: seen.size, issues };
    },
  };
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    hotbar: HotbarService;
  }
}
