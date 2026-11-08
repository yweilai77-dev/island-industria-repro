import { describe, expect, it } from 'vitest';
import {
  ITEM_IDS,
  IRON_ORE_DEFINITION,
  getItemDefinition,
  itemDefinitions,
  type ItemId,
} from '../items/items.ts';
import {
  InvalidItemCountError,
  createInventoryService,
  inventoryCount,
  type InventoryService,
} from '../inventory/inventory.ts';
import {
  advanceHarvest,
  awardHarvest,
  createHarvestState,
  startHarvest,
} from '../harvest/harvest.ts';
import type { HarvestResult } from '../resource/resource.ts';

const IRON = ITEM_IDS.IRON_ORE;

function stackCounts(service: InventoryService): number[] {
  return service.stacks().map((stack) => stack.count);
}

describe('item definitions', () => {
  it('registers iron ore with name and max stack', () => {
    expect(IRON_ORE_DEFINITION.id).toBe('iron_ore');
    expect(IRON_ORE_DEFINITION.name).toBe('铁矿石');
    expect(IRON_ORE_DEFINITION.maxStack).toBe(999);
    expect(IRON_ORE_DEFINITION.description.length).toBeGreaterThan(0);
    expect(IRON_ORE_DEFINITION.icon).toBe('iron_ore');
    expect(getItemDefinition(IRON)).toEqual(IRON_ORE_DEFINITION);
    // P2-B：接口盒成为真实物品，14 → 15；P2-C：输出/分流/合流接口盒，15 → 18。
    expect(itemDefinitions()).toHaveLength(18);
  });

  it('returns undefined for unknown item ids', () => {
    expect(getItemDefinition('stone' as ItemId)).toBeUndefined();
  });
});

describe('inventory stacking', () => {
  it('keeps 999 in one stack', () => {
    const inventory = createInventoryService();
    inventory.add(IRON, 999);
    expect(stackCounts(inventory)).toEqual([999]);
    expect(inventory.count(IRON)).toBe(999);
  });

  it('splits 1000 into [999, 1]', () => {
    const inventory = createInventoryService();
    inventory.add(IRON, 1000);
    expect(stackCounts(inventory)).toEqual([999, 1]);
    expect(inventory.count(IRON)).toBe(1000);
  });

  it('splits 1998 into [999, 999]', () => {
    const inventory = createInventoryService();
    inventory.add(IRON, 1998);
    expect(stackCounts(inventory)).toEqual([999, 999]);
  });

  it('fills 500 + 600 into [999, 101]', () => {
    const inventory = createInventoryService();
    inventory.add(IRON, 500);
    inventory.add(IRON, 600);
    expect(stackCounts(inventory)).toEqual([999, 101]);
    expect(inventory.count(IRON)).toBe(1100);
  });

  it('adds one-by-one across stack boundaries', () => {
    const inventory = createInventoryService();
    for (let index = 0; index < 1000; index += 1) inventory.add(IRON, 1);
    expect(stackCounts(inventory)).toEqual([999, 1]);
    expect(inventory.count(IRON)).toBe(1000);
  });
});

describe('inventory quantity validation', () => {
  const invalidCounts = [-1, -999, 1.5, NaN, Infinity, -Infinity];

  it('rejects invalid add amounts without touching state', () => {
    const inventory = createInventoryService();
    inventory.add(IRON, 1);
    for (const bad of invalidCounts) {
      expect(() => inventory.add(IRON, bad)).toThrow(InvalidItemCountError);
    }
    expect(inventory.count(IRON)).toBe(1);
    expect(stackCounts(inventory)).toEqual([1]);
  });

  it('rejects invalid remove/has amounts without touching state', () => {
    const inventory = createInventoryService();
    inventory.add(IRON, 10);
    for (const bad of invalidCounts) {
      expect(() => inventory.remove(IRON, bad)).toThrow(InvalidItemCountError);
      expect(() => inventory.has(IRON, bad)).toThrow(InvalidItemCountError);
    }
    expect(inventory.count(IRON)).toBe(10);
    expect(stackCounts(inventory)).toEqual([10]);
  });

  it('treats zero as a no-op', () => {
    const inventory = createInventoryService();
    expect(inventory.add(IRON, 0)).toBe(0);
    expect(inventory.stacks()).toEqual([]);
    expect(inventory.remove(IRON, 0)).toBe(true);
    expect(inventory.has(IRON, 0)).toBe(true);
    expect(inventory.count(IRON)).toBe(0);
  });

  it('rejects unknown item ids through the service', () => {
    const inventory = createInventoryService();
    expect(() => inventory.add('stone' as ItemId, 1)).toThrow(/unknown item id/);
    expect(inventory.count('stone' as ItemId)).toBe(0);
  });

  it('rejects unknown item in pure count helpers', () => {
    const inventory = createInventoryService();
    expect(inventoryCount({ stacks: [] }, IRON)).toBe(0);
  });
});

describe('inventory removal', () => {
  it('removes a partial amount from the first stack', () => {
    const inventory = createInventoryService();
    inventory.add(IRON, 1000);
    expect(inventory.remove(IRON, 1)).toBe(true);
    expect(stackCounts(inventory)).toEqual([998, 1]);
    expect(inventory.count(IRON)).toBe(999);
  });

  it('removes across stacks and deletes empty stacks', () => {
    const inventory = createInventoryService();
    inventory.add(IRON, 1000);
    expect(inventory.remove(IRON, 500)).toBe(true);
    expect(stackCounts(inventory)).toEqual([499, 1]);
    expect(inventory.remove(IRON, 500)).toBe(true);
    expect(inventory.stacks()).toEqual([]);
  });

  it('fails without mutating when there are not enough items', () => {
    const inventory = createInventoryService();
    inventory.add(IRON, 5);
    expect(inventory.remove(IRON, 6)).toBe(false);
    expect(stackCounts(inventory)).toEqual([5]);
    expect(inventory.remove(IRON, 5)).toBe(true);
    expect(inventory.stacks()).toEqual([]);
  });

  it('reports exact availability', () => {
    const inventory = createInventoryService();
    inventory.add(IRON, 7);
    expect(inventory.has(IRON, 7)).toBe(true);
    expect(inventory.has(IRON, 8)).toBe(false);
    expect(inventory.has(IRON, 0)).toBe(true);
  });

  it('returns a snapshot that cannot mutate internal stacks', () => {
    const inventory = createInventoryService();
    inventory.add(IRON, 3);
    const snapshot = inventory.stacks();
    (snapshot[0] as { count: number }).count = 999;
    expect(inventory.count(IRON)).toBe(3);
  });
});

describe('harvest awards exactly the deducted amount once', () => {
  it('awards only successful deductions', () => {
    const inventory = createInventoryService();
    expect(awardHarvest(inventory, undefined)).toBe(0);
    expect(awardHarvest(inventory, { deducted: 0, remaining: 20 })).toBe(0);
    expect(inventory.count(IRON)).toBe(0);
    expect(awardHarvest(inventory, { deducted: 2, remaining: 18 })).toBe(2);
    expect(inventory.count(IRON)).toBe(2);
  });

  it('grants one item per completed harvest cycle, never twice', () => {
    const state = createHarvestState();
    const inventory = createInventoryService();
    startHarvest(state, 1);
    let completions = 0;
    for (let frame = 0; frame < 40; frame += 1) {
      const tick = advanceHarvest(state, 0.1, true, true);
      if (tick.status === 'completed') {
        completions += 1;
        awardHarvest(inventory, { deducted: 1, remaining: 19 } satisfies HarvestResult);
      }
    }
    expect(completions).toBe(1);
    expect(inventory.count(IRON)).toBe(1);
    expect(advanceHarvest(state, 1, true, true).status).toBe('idle');
  });
});