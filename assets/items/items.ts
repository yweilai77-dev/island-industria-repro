/**
 * 物品定义（只读注册表）。
 * 物品定义与库存堆叠数据分离：库存只保存 itemId + count，名称/描述/图标/最大堆叠数从这里读取。
 */

export type ItemCategory = 'resource' | 'mechanical';

export type ItemId =
  | 'iron_ore'
  | 'shaft'
  | 'gear_12'
  | 'gear_24'
  | 'power_source'
  | 'machine';

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
  /** 物品分类：资源/机械零件。 */
  readonly category: ItemCategory;
}

export const ITEM_IDS = {
  IRON_ORE: 'iron_ore',
  SHAFT: 'shaft',
  GEAR_12: 'gear_12',
  GEAR_24: 'gear_24',
  POWER_SOURCE: 'power_source',
  MACHINE: 'machine',
} as const satisfies Record<string, ItemId>;

export const IRON_ORE_DEFINITION: ItemDefinition = {
  id: ITEM_IDS.IRON_ORE,
  name: '铁矿石',
  description: '常见的铁矿石，可用于冶炼铁锭。',
  icon: 'iron_ore',
  maxStack: 999,
  category: 'resource',
};

const MECHANICAL_DEFINITIONS: readonly ItemDefinition[] = [
  {
    id: ITEM_IDS.SHAFT,
    name: '传动轴',
    description: '1m 传动轴，两端可连接轴/齿轮/机器。',
    icon: 'shaft',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    id: ITEM_IDS.GEAR_12,
    name: '12 齿齿轮',
    description: '平行轴外啮合齿轮，齿数 12；与 24 齿啮合时转速加倍、方向相反。',
    icon: 'gear_12',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    id: ITEM_IDS.GEAR_24,
    name: '24 齿齿轮',
    description: '平行轴外啮合齿轮，齿数 24；与 12 齿啮合时转速减半、方向相反。',
    icon: 'gear_24',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    id: ITEM_IDS.POWER_SOURCE,
    name: '测试动力源',
    description: 'M1.7 临时测试动力源；输出固定测试参数，可启停。',
    icon: 'power_source',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    id: ITEM_IDS.MACHINE,
    name: '冲压机',
    description: 'M1.7 加工机器原型：输入轴驱动曲柄冲头往复工作。',
    icon: 'machine',
    maxStack: 999,
    category: 'mechanical',
  },
];

const DEFINITIONS: ReadonlyMap<ItemId, ItemDefinition> = new Map([
  [IRON_ORE_DEFINITION.id, IRON_ORE_DEFINITION],
  ...MECHANICAL_DEFINITIONS.map((definition) => [definition.id, definition] as const),
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

/** 是否机械零件物品；null/undefined/资源物品返回 false。 */
export function isMechanicalItem(id: ItemId | null | undefined): boolean {
  if (id === null || id === undefined) return false;
  return getItemDefinition(id)?.category === 'mechanical';
}

/** 已注册的全部物品定义（只读快照）。 */
export function itemDefinitions(): readonly ItemDefinition[] {
  return [...DEFINITIONS.values()];
}
