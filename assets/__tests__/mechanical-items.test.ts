import { describe, expect, it } from 'vitest';
import { createInventoryService } from '../inventory/inventory.ts';
import { isMechanicalItem, itemDefinitions, ITEM_IDS } from '../items/items.ts';
import {
  MECHANICAL_PART_DEFS,
  MECHANICAL_ITEM_IDS,
  PROTOTYPE_KIT,
  partDefForItem,
} from '../mechanical/parts.ts';
import { PartViewRegistry } from '../mechanical/visuals.ts';

describe('mechanical items and prototype kit', () => {
  it('registers all mechanical items with category and correct mapping', () => {
    expect(itemDefinitions()).toHaveLength(6);
    for (const itemId of MECHANICAL_ITEM_IDS) expect(isMechanicalItem(itemId)).toBe(true);
    expect(isMechanicalItem(ITEM_IDS.IRON_ORE)).toBe(false);
    expect(isMechanicalItem(null)).toBe(false);
    expect(partDefForItem(ITEM_IDS.SHAFT)?.id).toBe('shaft');
    expect(partDefForItem(ITEM_IDS.GEAR_12)?.teeth).toBe(12);
    expect(partDefForItem(ITEM_IDS.IRON_ORE)).toBeUndefined();
    expect(PROTOTYPE_KIT.shaft).toBeGreaterThan(0);
    expect(PROTOTYPE_KIT.machine).toBeGreaterThanOrEqual(2);
  });

  it('supports all-or-nothing inventory consumption and single refund', () => {
    const inventory = createInventoryService();
    const shaft = MECHANICAL_PART_DEFS.shaft.itemId;
    inventory.add(shaft, 2);
    expect(inventory.count(shaft)).toBe(2);
    expect(inventory.remove(shaft, 1)).toBe(true);
    expect(inventory.count(shaft)).toBe(1);
    expect(inventory.remove(shaft, 2)).toBe(false);
    expect(inventory.count(shaft)).toBe(1);
    inventory.add(shaft, 1);
    expect(inventory.count(shaft)).toBe(2);
  });
});

describe('PartViewRegistry idempotent cleanup', () => {
  it('despawns each part root at most once and removes joints on clear', () => {
    const despawned: number[] = [];
    const world = { despawn: (entity: { id: number } | number) => despawned.push(typeof entity === 'number' ? entity : entity.id) };
    const registry = new PartViewRegistry(world as never);
    registry.add(1, { root: 10 as never });
    expect(registry.viewCount).toBe(1);
    expect(registry.dispose(1)).toBe(true);
    expect(registry.dispose(1)).toBe(false);
    expect(despawned).toEqual([10]);
    expect(registry.viewCount).toBe(0);
    registry.disposeAll();
    expect(despawned).toEqual([10]);
  });
});
