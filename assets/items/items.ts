/**
 * 物品定义（只读注册表）。
 * 物品定义与库存堆叠数据分离：库存只保存 itemId + count，名称/描述/图标/最大堆叠数从这里读取。
 */

export type ItemId = 'iron_ore';

export interface ItemDefinition {
  readonly id: ItemId;
  /** 显示名称。 */
  readonly name: string;
  /** 背包详情里的描述。 */
  readonly description: string;
  /** 前端图标键（前端根据它选择内联 SVG；新增物品时在此扩展）。 */
  readonly icon: string;
  /** 单组最大堆叠数量。 */
  readonly maxStack: number;
}

export const ITEM_IDS = {
  IRON_ORE: 'iron_ore',
} as const satisfies Record<string, ItemId>;

export const IRON_ORE_DEFINITION: ItemDefinition = {
  id: ITEM_IDS.IRON_ORE,
  name: '铁矿石',
  description: '常见的铁矿石，可用于冶炼铁锭。',
  icon: 'iron_ore',
  maxStack: 999,
};

const DEFINITIONS: ReadonlyMap<ItemId, ItemDefinition> = new Map([
  [IRON_ORE_DEFINITION.id, IRON_ORE_DEFINITION],
]);

/** 按 ID 查询物品定义；未注册返回 undefined。 */
export function getItemDefinition(id: ItemId): ItemDefinition | undefined {
  return DEFINITIONS.get(id);
}

/** 按 ID 查询物品定义；未注册抛错（编程错误）。 */
export function requireItemDefinition(id: ItemId): ItemDefinition {
  const definition = DEFINITIONS.get(id);
  if (definition === undefined) throw new Error(`unknown item id: ${String(id)}`);
  return definition;
}

/** 已注册的全部物品定义（只读快照）。 */
export function itemDefinitions(): readonly ItemDefinition[] {
  return [...DEFINITIONS.values()];
}
