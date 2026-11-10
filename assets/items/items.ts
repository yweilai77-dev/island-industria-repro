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
  | 'chute'
  | 'interface_box'
  | 'output_interface_box'
  | 'splitter_box'
  | 'merger_box'
  | 'structure_frame';

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
  INTERFACE_BOX: 'interface_box',
  OUTPUT_INTERFACE_BOX: 'output_interface_box',
  SPLITTER_BOX: 'splitter_box',
  MERGER_BOX: 'merger_box',
  STRUCTURE_FRAME: 'structure_frame',
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

/**
 * 机械类物品定义。
 *
 * P2-B：接口盒也登记在这里并沿用 `category: 'mechanical'`。这不是把它当成可放置的机械零件
 * （`partDefForItem` 里没有它，快捷栏也不会绑定它），而是因为 `category` 目前实际承担的是
 * 「选中该物品时是否让建筑系统让出输入」这一个职责（见 build/input-mode.ts）：
 * 接口盒是安装在机器上的工业部件，不应该被当作建筑放置。
 * 等 P2-E 科技树需要真正的物品分类时再拆出独立分类。
 */
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
  {
    // P2-B：工业接口盒。分类沿用 mechanical，原因见 MECHANICAL_DEFINITIONS 顶部注释。
    id: ITEM_IDS.INTERFACE_BOX,
    name: '基础接口盒',
    description: '通用物料接口（1 进 1 出），输入位、输出位都能装。装在输入位后溜槽可自动送料进机器；装在输出位后机器产物会自动进入接口盒。悬停核心按 T 装到输入位，按 O 装到输出位。',
    icon: 'interface_box',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    // P2-C：专用输出接口盒。输入/输出是明确区分的功能类型，普通输入接口不会自动获得输出能力。
    id: ITEM_IDS.OUTPUT_INTERFACE_BOX,
    name: '输出接口盒',
    description: '专用物料输出接口（1 出），只能装在加工核心的输出安装位。装好后产物会进入接口盒，可经物料连接送到下游核心。悬停核心按 O 安装。',
    icon: 'output_interface_box',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    id: ITEM_IDS.SPLITTER_BOX,
    name: '分流接口盒',
    description: '一路输入、两路输出的物料分流模块，只能装在加工核心的输出安装位。两路输出按轮询规则分配，最近送达的连接优先获得下一件。悬停核心按 K 安装。',
    icon: 'splitter_box',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    id: ITEM_IDS.MERGER_BOX,
    name: '合流接口盒',
    description: '两路输入、一路输出的物料合流模块，只能装在加工核心的输入安装位。多路上游按轮询规则合入同一输入缓冲。悬停核心按 L 安装。',
    icon: 'merger_box',
    maxStack: 999,
    category: 'mechanical',
  },
  {
    // P2-D：结构模块。玩家用它在世界中把多台独立加工核心组织成组合机械。
    id: ITEM_IDS.STRUCTURE_FRAME,
    name: '结构框架',
    description: '组合机械的基础结构模块。悬停格子按 P 进入结构放置模式，左键放置；与加工核心或其它结构框架正交相邻时把它们组织成组合机械。拆除后组合关系自动解除，物品返还。',
    icon: 'structure_frame',
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
