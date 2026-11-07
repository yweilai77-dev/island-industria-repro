/**
 * 物品定义（只读注册表）。
 * 物品定义与库存堆叠数据分离：库存只保存 itemId + count，名称/描述/图标/最大堆叠数从这里读取。
 *
 * M1.8：新增生产链物品（碎铁矿、铁锭）与 6 种新机械零件。
 * 新增物品时必须同步：ItemId 联合、ITEM_IDS、定义对象、DEFINITIONS 表、前端 icons.ts。
 * `ITEM_IDS` 的 satisfies 只校验值合法、不校验穷尽性，漏定义只会在运行期抛 unknown item id。
 */

export type ItemCategory = 'resource' | 'mechanical';

export type ItemId =
  | 'iron_ore'
  | 'crushed_ore'
  | 'iron_ingot'
  | 'shaft'
  | 'gear_12'
  | 'gear_24'
  | 'power_source'
  | 'machine'
  | 'vertical_drive'
  | 'flywheel_source'
  | 'crusher'
  | 'smelter'
  | 'forge'
  | 'chute';

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
  CRUSHED_ORE: 'crushed_ore',
  IRON_INGOT: 'iron_ingot',
  SHAFT: 'shaft',
  GEAR_12: 'gear_12',
  GEAR_24: 'gear_24',
  POWER_SOURCE: 'power_source',
  MACHINE: 'machine',
  VERTICAL_DRIVE: 'vertical_drive',
  FLYWHEEL_SOURCE: 'flywheel_source',
  CRUSHER: 'crusher',
  SMELTER: 'smelter',
  FORGE: 'forge',
  CHUTE: 'chute',
} as const satisfies Record<string, ItemId>;

export const IRON_ORE_DEFINITION: ItemDefinition = {
  id: ITEM_IDS.IRON_ORE,
  name: '铁矿石',
  description: '常见的铁矿石。破碎机可将其打成碎铁矿。',
  icon: 'iron_ore',
  maxStack: 999,
  category: 'resource',
};

/** M1.8 生产链中间产物与成品（资源类：不进入机械模式）。 */
const PRODUCTION_DEFINITIONS: readonly ItemDefinition[] = [
  {
    id: ITEM_IDS.CRUSHED_ORE,
    name: '碎铁矿',
    description: '铁矿石破碎后的产物，熔炼炉的原料。',
    icon: 'crushed_ore',
    maxStack: 999,
    category: 'resource',
  },
  {
    id: ITEM_IDS.IRON_INGOT,
    name: '铁锭',
    description: '熔炼炉炼出的铁锭。锻压机可把铁锭锻成机械零件。',
    icon: 'iron_ingot',
    maxStack: 999,
    category: 'resource',
  },
];

const MECHANICAL_DEFINITIONS: readonly ItemDefinition[] = [
  {
    id: ITEM_IDS.SHAFT,
    name: '传动轴',
    description: '1m 传动轴，两端可连接轴/齿轮/机器。也可由 2 个铁锭锻压而成。',
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
    description: 'M1.7 临时测试动力源；输出固定测试参数，可启停。不是正式动力来源。',
    icon: 'power_source',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    id: ITEM_IDS.MACHINE,
    name: '冲压机',
    description: 'M1.7 加工机器原型：输入轴驱动曲柄冲头往复工作，不消耗也不产出物品。',
    icon: 'machine',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    id: ITEM_IDS.VERTICAL_DRIVE,
    name: '立式传动带',
    description: '3m 高的垂直皮带传动。底部接下一层轴，顶部接上一层轴，可跨层传递动力。需要在该格楼板上开孔。',
    icon: 'vertical_drive',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    id: ITEM_IDS.FLYWHEEL_SOURCE,
    name: '手摇飞轮储能机',
    description: '正式动力来源：靠近按住 C 摇动摇柄给飞轮储能，右键离合启停。储能耗尽后自动停转。',
    icon: 'flywheel_source',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    id: ITEM_IDS.CRUSHER,
    name: '破碎机',
    description: '工业加工机器：1 铁矿石 → 1 碎铁矿。悬停按 C 从库存投料、右键取货；必须由机械动力驱动。',
    icon: 'crusher',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    id: ITEM_IDS.SMELTER,
    name: '熔炼炉',
    description: '工业加工机器：1 碎铁矿 → 1 铁锭。悬停按 C 投料、右键取货；必须由机械动力驱动。',
    icon: 'smelter',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    id: ITEM_IDS.FORGE,
    name: '锻压机',
    description: '工业加工机器：把铁锭锻成机械零件。悬停按 R 切换配方（传动轴 / 立式传动带 / 溜槽），C 投料、右键取货。',
    icon: 'forge',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    id: ITEM_IDS.CHUTE,
    name: '重力溜槽',
    description: '无动力物料溜槽：把机器产物沿朝向送到下一格。堵塞时物品停在槽上，不会消失。',
    icon: 'chute',
    maxStack: 999,
    category: 'mechanical',
  },
];

const DEFINITIONS: ReadonlyMap<ItemId, ItemDefinition> = new Map([
  [IRON_ORE_DEFINITION.id, IRON_ORE_DEFINITION],
  ...PRODUCTION_DEFINITIONS.map((definition) => [definition.id, definition] as const),
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
