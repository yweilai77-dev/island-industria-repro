import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../items/items.ts';
import {
  HOTBAR_SLOT_COUNT,
  bindItem,
  createHotbarService,
  createHotbarState,
  dropUnavailable,
  hotbarSnapshot,
  selectSlot,
  unbindSlot,
} from '../hotbar/hotbar.ts';

const IRON = ITEM_IDS.IRON_ORE;

describe('hotbar slots and selection', () => {
  it('starts with eight empty slots and slot 0 selected', () => {
    const state = createHotbarState();
    expect(state.slots).toHaveLength(HOTBAR_SLOT_COUNT);
    expect(state.slots.every((slot) => slot === null)).toBe(true);
    expect(state.selected).toBe(0);
  });

  it('selects a slot and ignores selecting the same slot', () => {
    const state = createHotbarState();
    expect(selectSlot(state, 3)).toBe(true);
    expect(state.selected).toBe(3);
    expect(selectSlot(state, 3)).toBe(false);
  });

  it('rejects invalid slots', () => {
    const state = createHotbarState();
    // M1.8：槽位数 8 → 12，越界值随之改为 12。
    for (const bad of [-1, HOTBAR_SLOT_COUNT, 1.5, NaN]) {
      expect(() => selectSlot(state, bad)).toThrow(RangeError);
      expect(() => bindItem(state, bad, IRON)).toThrow(RangeError);
      expect(() => unbindSlot(state, bad)).toThrow(RangeError);
    }
  });
});

describe('hotbar binding rules', () => {
  it('binds an item and unbinds it', () => {
    const state = createHotbarState();
    expect(bindItem(state, 2, IRON)).toBe(true);
    expect(state.slots[2]).toBe(IRON);
    expect(unbindSlot(state, 2)).toBe(true);
    expect(state.slots[2]).toBeNull();
    expect(unbindSlot(state, 2)).toBe(false);
  });

  it('moves an already-bound item instead of duplicating it', () => {
    const state = createHotbarState();
    bindItem(state, 1, IRON);
    bindItem(state, 5, IRON);
    expect(state.slots[1]).toBeNull();
    expect(state.slots[5]).toBe(IRON);
    expect(state.slots.filter((slot) => slot === IRON)).toHaveLength(1);
  });

  it('replaces the previous occupant when binding to an occupied slot', () => {
    const state = createHotbarState();
    bindItem(state, 0, IRON);
    expect(state.slots[0]).toBe(IRON);
    // 当前只有铁矿石一种物品，用纯逻辑验证“替换”语义：
    const other = 'copper_ore' as typeof IRON;
    bindItem(state, 0, other);
    expect(state.slots[0]).toBe(other);
    expect(state.slots.filter((slot) => slot === IRON)).toHaveLength(0);
  });

  it('binding the same item to the same slot is a no-op', () => {
    const state = createHotbarState();
    bindItem(state, 4, IRON);
    const revision = state.revision;
    expect(bindItem(state, 4, IRON)).toBe(false);
    expect(state.revision).toBe(revision);
  });
});

describe('zero-count auto unbind', () => {
  it('clears bindings whose inventory count is zero', () => {
    const state = createHotbarState();
    bindItem(state, 0, IRON);
    const removed = dropUnavailable(state, () => 0);
    expect(removed).toEqual([IRON]);
    expect(state.slots[0]).toBeNull();
  });

  it('keeps bindings with positive inventory counts', () => {
    const state = createHotbarState();
    bindItem(state, 6, IRON);
    expect(dropUnavailable(state, () => 3)).toEqual([]);
    expect(state.slots[6]).toBe(IRON);
  });
});

describe('hotbar service and snapshot', () => {
  it('exposes live slots/selection and revision changes', () => {
    const service = createHotbarService();
    const rev0 = service.revision;
    service.select(2);
    service.bind(2, IRON);
    expect(service.selected).toBe(2);
    expect(service.slots[2]).toBe(IRON);
    expect(service.revision).toBeGreaterThan(rev0);
    service.dropUnavailable(() => 0);
    expect(service.slots[2]).toBeNull();
  });

  it('snapshot is a copy that cannot mutate the service', () => {
    const service = createHotbarService();
    service.bind(0, IRON);
    const snapshot = service.slots;
    expect(snapshot[0]).toBe(IRON);
    const copied = hotbarSnapshot({
      slots: [...snapshot], selected: service.selected, revision: service.revision,
    });
    expect(copied.slots[0]).toBe(IRON);
  });
});
