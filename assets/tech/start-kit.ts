/**
 * M2.0-P2-E1「继承工坊」正式起步包（纯数据）。
 *
 * 设计来源：docs/m20/P2-E0-TECH-TREE-DESIGN.md §9.2。
 * 与旧的 PROTOTYPE_KIT（assets/mechanical/parts.ts）严格区分：
 * - 旧套件只用于 M1/P2 验收脚本的 legacy 兼容模式与开发调试；
 * - 正式玩家开局只拿到这里列出的「继承设备」，其余靠科技解锁 + 自己制造；
 * - 测试动力源（调试件）与冲压机（纯运动学原型）**不在**正式起步包内。
 */
import { ITEM_IDS, type ItemId } from '../items/items.ts';

export interface KitEntry {
  readonly itemId: ItemId;
  readonly count: number;
}

export interface KitSlotBinding {
  readonly slot: number;
  readonly itemId: ItemId;
}

/**
 * 正式起步包物品（继承的旧工坊）：
 * 1 台飞轮 + 破碎/熔炼/锻压各 1 台 + 够搭第一条动力线的轴/齿轮 +
 * 1 个立式传动带（展示跨层可能，但配方要 T1.3 才解锁）+ 2 个溜槽。
 */
export const INHERITED_WORKSHOP: readonly KitEntry[] = Object.freeze([
  { itemId: ITEM_IDS.SHAFT, count: 8 },
  { itemId: ITEM_IDS.GEAR_12, count: 4 },
  { itemId: ITEM_IDS.GEAR_24, count: 2 },
  { itemId: ITEM_IDS.CHUTE, count: 2 },
  { itemId: ITEM_IDS.VERTICAL_DRIVE, count: 1 },
  { itemId: ITEM_IDS.FLYWHEEL_SOURCE, count: 1 },
  { itemId: ITEM_IDS.CRUSHER, count: 1 },
  { itemId: ITEM_IDS.SMELTER, count: 1 },
  { itemId: ITEM_IDS.FORGE, count: 1 },
]);

/**
 * 起步包的快捷栏绑定。
 * 保持历史槽位 0/1/2/6/7/8/9/10/11 的语义，**5 号槽保持空槽**（普通建造模式的停机位），
 * 3/4 号槽（旧套件的测试动力源/冲压机）在正式流程中为空。
 */
export const INHERITED_WORKSHOP_SLOTS: readonly KitSlotBinding[] = Object.freeze([
  { slot: 0, itemId: ITEM_IDS.SHAFT },
  { slot: 1, itemId: ITEM_IDS.GEAR_12 },
  { slot: 2, itemId: ITEM_IDS.GEAR_24 },
  { slot: 6, itemId: ITEM_IDS.CHUTE },
  { slot: 7, itemId: ITEM_IDS.VERTICAL_DRIVE },
  { slot: 8, itemId: ITEM_IDS.FLYWHEEL_SOURCE },
  { slot: 9, itemId: ITEM_IDS.CRUSHER },
  { slot: 10, itemId: ITEM_IDS.SMELTER },
  { slot: 11, itemId: ITEM_IDS.FORGE },
]);

/** 默认选中槽：空槽 5，保持 M1.5 的普通建造默认行为。 */
export const INHERITED_WORKSHOP_DEFAULT_SLOT = 5;

/** 正式起步包是否包含某物品（测试用）。 */
export function starterKitCountOf(itemId: ItemId): number {
  return INHERITED_WORKSHOP.find((entry) => entry.itemId === itemId)?.count ?? 0;
}
