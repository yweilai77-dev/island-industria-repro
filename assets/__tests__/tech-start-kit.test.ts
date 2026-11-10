import { describe, expect, it } from 'vitest';
import { getItemDefinition, ITEM_IDS, type ItemId } from '../items/items.ts';
import { PROTOTYPE_KIT, PROTOTYPE_KIT_SLOTS } from '../mechanical/parts.ts';
import {
  INHERITED_WORKSHOP,
  INHERITED_WORKSHOP_DEFAULT_SLOT,
  INHERITED_WORKSHOP_SLOTS,
  starterKitCountOf,
} from '../tech/start-kit.ts';

/**
 * P2-E1「继承工坊」正式起步包测试（任务书 §六）：
 * 与 E0 §9.2 的 9 项数量逐字一致、不含调试件/阶段 1+ 内容、
 * 槽位表 5 号空槽无重复、且与旧 PROTOTYPE_KIT 严格区分。
 */

/** E0 设计 §9.2 的正式起步包清单（顺序 = INHERITED_WORKSHOP）。 */
const EXPECTED_WORKSHOP: readonly (readonly [string, number])[] = [
  [ITEM_IDS.SHAFT, 8],
  [ITEM_IDS.GEAR_12, 4],
  [ITEM_IDS.GEAR_24, 2],
  [ITEM_IDS.CHUTE, 2],
  [ITEM_IDS.VERTICAL_DRIVE, 1],
  [ITEM_IDS.FLYWHEEL_SOURCE, 1],
  [ITEM_IDS.CRUSHER, 1],
  [ITEM_IDS.SMELTER, 1],
  [ITEM_IDS.FORGE, 1],
];

const EXPECTED_SLOTS: readonly (readonly [number, string])[] = [
  [0, ITEM_IDS.SHAFT],
  [1, ITEM_IDS.GEAR_12],
  [2, ITEM_IDS.GEAR_24],
  [6, ITEM_IDS.CHUTE],
  [7, ITEM_IDS.VERTICAL_DRIVE],
  [8, ITEM_IDS.FLYWHEEL_SOURCE],
  [9, ITEM_IDS.CRUSHER],
  [10, ITEM_IDS.SMELTER],
  [11, ITEM_IDS.FORGE],
];

describe('继承工坊：精确内容', () => {
  it('恰好 9 项，物品与数量与 E0 §9.2 逐字一致', () => {
    expect(INHERITED_WORKSHOP).toHaveLength(9);
    expect(INHERITED_WORKSHOP.map((entry) => [entry.itemId, entry.count])).toEqual(
      EXPECTED_WORKSHOP.map(([itemId, count]) => [itemId, count]),
    );
    expect(INHERITED_WORKSHOP.reduce((sum, entry) => sum + entry.count, 0)).toBe(21);
  });

  it('starterKitCountOf 与清单一致，未包含物品返回 0', () => {
    for (const [itemId, count] of EXPECTED_WORKSHOP) {
      expect(starterKitCountOf(itemId as ItemId), itemId).toBe(count);
    }
    expect(starterKitCountOf('unobtainium' as ItemId)).toBe(0);
  });

  it('所有条目物品真实存在、数量为正整数且不重复', () => {
    const seen = new Set<string>();
    for (const entry of INHERITED_WORKSHOP) {
      expect(getItemDefinition(entry.itemId), entry.itemId).toBeDefined();
      expect(Number.isInteger(entry.count), entry.itemId).toBe(true);
      expect(entry.count).toBeGreaterThan(0);
      expect(seen.has(entry.itemId)).toBe(false);
      seen.add(entry.itemId);
    }
  });

  it('不包含调试件、阶段 1+ 内容与基础资源（E0 §9.2 的 0 项）', () => {
    for (const excluded of [
      ITEM_IDS.POWER_SOURCE,
      ITEM_IDS.MACHINE,
      ITEM_IDS.INTERFACE_BOX,
      ITEM_IDS.OUTPUT_INTERFACE_BOX,
      ITEM_IDS.SPLITTER_BOX,
      ITEM_IDS.MERGER_BOX,
      ITEM_IDS.STRUCTURE_FRAME,
      ITEM_IDS.IRON_ORE,
      ITEM_IDS.CRUSHED_ORE,
      ITEM_IDS.IRON_INGOT,
    ]) {
      expect(starterKitCountOf(excluded), excluded).toBe(0);
    }
  });
});

describe('继承工坊：快捷栏槽位表', () => {
  it('槽位绑定与历史语义一致，5 号槽为空、3/4 号槽在正式流程为空', () => {
    expect(INHERITED_WORKSHOP_SLOTS.map((entry) => [entry.slot, entry.itemId])).toEqual(
      EXPECTED_SLOTS.map(([slot, itemId]) => [slot, itemId]),
    );
    expect(INHERITED_WORKSHOP_DEFAULT_SLOT).toBe(5);
    expect(INHERITED_WORKSHOP_SLOTS.some((entry) => entry.slot === 5)).toBe(false);
    expect(INHERITED_WORKSHOP_SLOTS.some((entry) => entry.slot === 3)).toBe(false);
    expect(INHERITED_WORKSHOP_SLOTS.some((entry) => entry.slot === 4)).toBe(false);
    expect(INHERITED_WORKSHOP_SLOTS.filter((entry) => entry.slot === 5)).toHaveLength(0);
    expect(INHERITED_WORKSHOP_SLOTS.map((entry) => entry.slot)).toEqual([0, 1, 2, 6, 7, 8, 9, 10, 11]);
  });

  it('槽位无重复、范围合法、绑定物品全部存在且都在起步包内', () => {
    const slots = new Set<number>();
    const boundItems = new Set<string>();
    for (const binding of INHERITED_WORKSHOP_SLOTS) {
      expect(slots.has(binding.slot)).toBe(false);
      slots.add(binding.slot);
      expect(binding.slot).toBeGreaterThanOrEqual(0);
      expect(binding.slot).toBeLessThanOrEqual(11);
      expect(getItemDefinition(binding.itemId), binding.itemId).toBeDefined();
      expect(starterKitCountOf(binding.itemId)).toBeGreaterThan(0);
      expect(boundItems.has(binding.itemId)).toBe(false);
      boundItems.add(binding.itemId);
    }
    // 起步包 9 项每一项都恰好绑定一个槽位。
    expect([...boundItems].sort()).toEqual(INHERITED_WORKSHOP.map((entry) => entry.itemId).sort());
  });

  it('不把调试件/阶段 1+ 内容绑进快捷栏', () => {
    const slotItems = INHERITED_WORKSHOP_SLOTS.map((entry) => entry.itemId);
    for (const excluded of [
      ITEM_IDS.POWER_SOURCE,
      ITEM_IDS.MACHINE,
      ITEM_IDS.STRUCTURE_FRAME,
      ITEM_IDS.INTERFACE_BOX,
    ]) {
      expect(slotItems).not.toContain(excluded);
    }
  });
});

describe('与旧 PROTOTYPE_KIT 严格区分', () => {
  it('同一物品的正式发放量远小于旧原型套件（8 vs 24、1 vs 3 …）', () => {
    expect(starterKitCountOf(ITEM_IDS.SHAFT)).toBe(8);
    expect(PROTOTYPE_KIT.shaft).toBe(24);
    expect(starterKitCountOf(ITEM_IDS.GEAR_12)).toBe(4);
    expect(PROTOTYPE_KIT.gear_12).toBe(6);
    expect(starterKitCountOf(ITEM_IDS.GEAR_24)).toBe(2);
    expect(PROTOTYPE_KIT.gear_24).toBe(4);
    expect(starterKitCountOf(ITEM_IDS.CHUTE)).toBe(2);
    expect(PROTOTYPE_KIT.chute).toBe(3);
    expect(starterKitCountOf(ITEM_IDS.VERTICAL_DRIVE)).toBe(1);
    expect(PROTOTYPE_KIT.vertical_drive).toBe(2);
    expect(starterKitCountOf(ITEM_IDS.CRUSHER)).toBe(1);
    expect(PROTOTYPE_KIT.crusher).toBe(3);
    expect(starterKitCountOf(ITEM_IDS.SMELTER)).toBe(1);
    expect(PROTOTYPE_KIT.smelter).toBe(3);
    // 单件设备两边都是 1；不是所有条目都不同，但总量必须显著更少。
    expect(starterKitCountOf(ITEM_IDS.FORGE)).toBe(PROTOTYPE_KIT.forge);
    expect(starterKitCountOf(ITEM_IDS.FLYWHEEL_SOURCE)).toBe(PROTOTYPE_KIT.flywheel_source);
  });

  it('旧套件有 12 项 56 件，正式起步包 9 项 21 件，且不含测试件', () => {
    const protoTotal = Object.values(PROTOTYPE_KIT).reduce((sum, count) => sum + count, 0);
    expect(protoTotal).toBe(56);
    expect(INHERITED_WORKSHOP.reduce((sum, entry) => sum + entry.count, 0)).toBe(21);
    expect(protoTotal).toBeGreaterThan(21);
    expect(PROTOTYPE_KIT.power_source).toBe(4);
    expect(PROTOTYPE_KIT.machine).toBe(5);
    expect(starterKitCountOf(ITEM_IDS.POWER_SOURCE)).toBe(0);
    expect(starterKitCountOf(ITEM_IDS.MACHINE)).toBe(0);
  });

  it('旧槽位表的 3/4 号槽（测试动力源/冲压机）在正式槽位表中不存在；两表 5 号槽都空', () => {
    expect(PROTOTYPE_KIT_SLOTS.find((entry) => entry.slot === 3)?.id).toBe('power_source');
    expect(PROTOTYPE_KIT_SLOTS.find((entry) => entry.slot === 4)?.id).toBe('machine');
    expect(INHERITED_WORKSHOP_SLOTS.some((entry) => entry.slot === 3 || entry.slot === 4)).toBe(false);
    expect(PROTOTYPE_KIT_SLOTS.some((entry) => entry.slot === 5)).toBe(false);
    expect(INHERITED_WORKSHOP_SLOTS.some((entry) => entry.slot === 5)).toBe(false);
    // 历史槽位 0/1/2/6/7/8/9/10/11 的语义保持不变（同一槽位仍绑同一物品）。
    for (const binding of INHERITED_WORKSHOP_SLOTS) {
      const historical = PROTOTYPE_KIT_SLOTS.find((entry) => entry.slot === binding.slot);
      expect(historical, `slot ${binding.slot}`).toBeDefined();
      expect(historical?.id).toBe(binding.itemId);
    }
  });
});
