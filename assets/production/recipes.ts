import { ITEM_IDS, type ItemId } from '../items/items.ts';
import type { PartId } from '../mechanical/parts.ts';

/**
 * M1.8-C 加工配方表（纯数据、零引擎依赖）。
 *
 * 只有 `crusher / smelter / forge` 三台正式机器有配方；冲压机 `machine` 是 M1.7 的运动学原型，
 * 不消耗也不产出物品（保持历史验收行为不变）。
 *
 * `seconds` 是「额定 60 RPM」下的加工时长；实际速率按机器所在轴的 rpm/60 线性缩放，
 * 因此负载把整网转速压到 54% 时，加工时间约变成 1.85 倍 —— 这是负载影响生产的唯一途径。
 */

export interface RecipeIngredient {
  readonly itemId: ItemId;
  readonly count: number;
}

export interface Recipe {
  readonly id: string;
  /** 读数里显示的配方名。 */
  readonly label: string;
  /** 每完成一个周期消耗的原料（**整笔消耗**：原料不足时一个都不扣）。 */
  readonly inputs: readonly RecipeIngredient[];
  /** 每完成一个周期产出的物品。 */
  readonly outputs: readonly RecipeIngredient[];
  /** 额定转速下的加工时长（秒）。 */
  readonly seconds: number;
}

export const CRUSH_RECIPE: Recipe = {
  id: 'crush-iron-ore',
  label: '破碎铁矿',
  inputs: [{ itemId: ITEM_IDS.IRON_ORE, count: 1 }],
  outputs: [{ itemId: ITEM_IDS.CRUSHED_ORE, count: 1 }],
  seconds: 4,
};

export const SMELT_RECIPE: Recipe = {
  id: 'smelt-crushed-ore',
  label: '熔炼铁锭',
  inputs: [{ itemId: ITEM_IDS.CRUSHED_ORE, count: 1 }],
  outputs: [{ itemId: ITEM_IDS.IRON_INGOT, count: 1 }],
  seconds: 6,
};

/** 锻压机：把铁锭锻成机械零件（M1.8-E 的「产物反哺建造」）。 */
export const FORGE_SHAFT_RECIPE: Recipe = {
  id: 'forge-shaft',
  label: '锻压传动轴',
  inputs: [{ itemId: ITEM_IDS.IRON_INGOT, count: 2 }],
  outputs: [{ itemId: ITEM_IDS.SHAFT, count: 1 }],
  seconds: 5,
};

export const FORGE_VERTICAL_DRIVE_RECIPE: Recipe = {
  id: 'forge-vertical-drive',
  label: '锻压立式传动带',
  inputs: [{ itemId: ITEM_IDS.IRON_INGOT, count: 3 }],
  outputs: [{ itemId: ITEM_IDS.VERTICAL_DRIVE, count: 1 }],
  seconds: 6,
};

export const FORGE_CHUTE_RECIPE: Recipe = {
  id: 'forge-chute',
  label: '锻压重力溜槽',
  inputs: [{ itemId: ITEM_IDS.IRON_INGOT, count: 2 }],
  outputs: [{ itemId: ITEM_IDS.CHUTE, count: 1 }],
  seconds: 4,
};

/**
 * P2-B：锻压基础接口盒。
 * 只消耗铁锭，不涉及科技解锁或新关键材料——P2-B 只要求「有基础、可测试的制造配方」。
 * 追加在锻压机配方列表**末尾**，保证 R 键切换顺序里前三条（含订单用的 forge-shaft）不变。
 */
export const FORGE_INTERFACE_BOX_RECIPE: Recipe = {
  id: 'forge-interface-box',
  label: '锻压基础接口盒',
  inputs: [{ itemId: ITEM_IDS.IRON_INGOT, count: 2 }],
  outputs: [{ itemId: ITEM_IDS.INTERFACE_BOX, count: 1 }],
  seconds: 5,
};

/**
 * P2-C：锻压接口盒三件套（输出 / 分流 / 合流）。
 * 与 P2-B 一样只消耗铁锭，不引入科技解锁；追加在列表末尾，已有配方的 R 切换下标不变。
 */
export const FORGE_OUTPUT_BOX_RECIPE: Recipe = {
  id: 'forge-output-box',
  label: '锻压输出接口盒',
  inputs: [{ itemId: ITEM_IDS.IRON_INGOT, count: 2 }],
  outputs: [{ itemId: ITEM_IDS.OUTPUT_INTERFACE_BOX, count: 1 }],
  seconds: 5,
};

export const FORGE_SPLITTER_BOX_RECIPE: Recipe = {
  id: 'forge-splitter-box',
  label: '锻压分流接口盒',
  inputs: [{ itemId: ITEM_IDS.IRON_INGOT, count: 3 }],
  outputs: [{ itemId: ITEM_IDS.SPLITTER_BOX, count: 1 }],
  seconds: 6,
};

export const FORGE_MERGER_BOX_RECIPE: Recipe = {
  id: 'forge-merger-box',
  label: '锻压合流接口盒',
  inputs: [{ itemId: ITEM_IDS.IRON_INGOT, count: 3 }],
  outputs: [{ itemId: ITEM_IDS.MERGER_BOX, count: 1 }],
  seconds: 6,
};

/**
 * P2-C：加工核心复制配方。
 *
 * 为什么 P2-C 必须补这三条：多核心生产线（合流需要两台同种上游、分流需要两台同种下游、
 * 多级产线需要三台核心）在当前内容里只有开局各 1 台，没有获取更多核心的途径。
 * 这三条沿用**既有锻造工艺**，只是新增配方数据，不新增工艺、不改配方结构，
 * 也不改任何已有机器的加工行为。
 */
export const FORGE_CRUSHER_RECIPE: Recipe = {
  id: 'forge-crusher',
  label: '锻压破碎机',
  inputs: [{ itemId: ITEM_IDS.IRON_INGOT, count: 6 }],
  outputs: [{ itemId: ITEM_IDS.CRUSHER, count: 1 }],
  seconds: 8,
};

export const FORGE_SMELTER_RECIPE: Recipe = {
  id: 'forge-smelter',
  label: '锻压熔炼炉',
  inputs: [{ itemId: ITEM_IDS.IRON_INGOT, count: 7 }],
  outputs: [{ itemId: ITEM_IDS.SMELTER, count: 1 }],
  seconds: 9,
};

export const FORGE_CORE_RECIPE: Recipe = {
  id: 'forge-processing-core',
  label: '锻压锻压机',
  inputs: [{ itemId: ITEM_IDS.IRON_INGOT, count: 8 }],
  outputs: [{ itemId: ITEM_IDS.FORGE, count: 1 }],
  seconds: 10,
};

/** 每台机器的配方列表；`recipeIndex` 是玩家用 R 切换的下标。 */
export const MACHINE_RECIPES: Readonly<Partial<Record<PartId, readonly Recipe[]>>> = Object.freeze({
  crusher: Object.freeze([CRUSH_RECIPE]),
  smelter: Object.freeze([SMELT_RECIPE]),
  forge: Object.freeze([
    FORGE_SHAFT_RECIPE,
    FORGE_VERTICAL_DRIVE_RECIPE,
    FORGE_CHUTE_RECIPE,
    FORGE_INTERFACE_BOX_RECIPE,
    FORGE_OUTPUT_BOX_RECIPE,
    FORGE_SPLITTER_BOX_RECIPE,
    FORGE_MERGER_BOX_RECIPE,
    FORGE_CRUSHER_RECIPE,
    FORGE_SMELTER_RECIPE,
    FORGE_CORE_RECIPE,
  ]),
});

/** 机器的配方表；非加工机器返回空数组。 */
export function recipesFor(partId: PartId): readonly Recipe[] {
  return MACHINE_RECIPES[partId] ?? [];
}

/** 该配方每周期唯一消耗的原料类型（当前所有配方都是单原料，缓冲模型据此简化为单槽）。 */
export function primaryInputOf(recipe: Recipe): RecipeIngredient | undefined {
  return recipe.inputs[0];
}

/** 该配方唯一产出的物品类型。 */
export function primaryOutputOf(recipe: Recipe): RecipeIngredient | undefined {
  return recipe.outputs[0];
}

/** 机器是否接受某种原料（任意一条配方需要它）。 */
export function machineAccepts(partId: PartId, itemId: ItemId): boolean {
  return recipesFor(partId).some((recipe) => recipe.inputs.some((input) => input.itemId === itemId));
}
