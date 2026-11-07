import type { ItemId } from '../items/items.ts';

/** 快捷栏固定槽位数量。 */
export const HOTBAR_SLOT_COUNT = 8;

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
  };
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    hotbar: HotbarService;
  }
}
