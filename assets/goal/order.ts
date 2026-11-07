import { CRUSH_RECIPE, FORGE_SHAFT_RECIPE, SMELT_RECIPE, type Recipe } from '../production/recipes.ts';
import type { PartId } from '../mechanical/parts.ts';

/**
 * M2.0-P1-A 第一份工业订单：订单定义（纯数据、零引擎依赖）。
 *
 * 这里只放「订单是什么」：八步定义、数量口径、机器种类、配方映射与提示文案。
 * 判定逻辑在 goal.ts，只读观测类型在 observation.ts；拆文件是为了守住工程 20 KB 单文件上限。
 */

/** 订单标题（HUD 用）。 */
export const ORDER_TITLE = '第一份工业订单';
/** 订单副标题（HUD 用）。 */
export const ORDER_SUBTITLE = '制造你的第一根传动轴。';

/** 八步目标 ID（与任务书表格一一对应）。 */
export type GoalStepId =
  | 'gather-ore'
  | 'build-machines'
  | 'connect-power'
  | 'start-power'
  | 'crush-ore'
  | 'smelt-ingot'
  | 'forge-shaft'
  | 'complete';

/** 订单的七个实质步骤（不含最后的完成态）。 */
export type GoalOrderStepId = Exclude<GoalStepId, 'complete'>;

/** 订单涉及的三台加工机器（与 PRODUCTION_MACHINE_IDS 一致）。 */
export type GoalMachineKind = 'crusher' | 'smelter' | 'forge';

/** 当前无法继续推进的原因（HUD 直接把它翻成提示）。 */
export type GoalBlockerCode =
  | 'missing-ore'
  | 'missing-machine'
  | 'missing-power-source'
  | 'no-connection'
  | 'no-power'
  | 'network-overload'
  | 'no-input'
  | 'output-full'
  | 'wrong-recipe'
  | 'no-recipe';

export interface GoalStepDefinition {
  readonly id: GoalStepId;
  /** 1..8，与任务书表格一致。 */
  readonly index: number;
  readonly title: string;
  readonly instruction: string;
}

/** 八步定义（HUD 与单测共用，避免文案漂移）。 */
export const GOAL_STEPS: readonly GoalStepDefinition[] = Object.freeze([
  {
    id: 'gather-ore',
    index: 1,
    title: '采集铁矿石',
    instruction: '去矿点采集至少 2 个铁矿石，作为第一份订单的原料。',
  },
  {
    id: 'build-machines',
    index: 2,
    title: '建造生产机器',
    instruction: '建造破碎机、熔炼炉、锻压机各至少 1 台。',
  },
  {
    id: 'connect-power',
    index: 3,
    title: '建立机械动力连接',
    instruction: '用传动轴和齿轮把三台机器与动力源接进同一套传动网络。',
  },
  {
    id: 'start-power',
    index: 4,
    title: '启动动力网络',
    instruction: '靠近手摇飞轮按住 C 储能，右键接合离合，让三台机器同时获得动力。',
  },
  {
    id: 'crush-ore',
    index: 5,
    title: '完成矿石破碎',
    instruction: '给破碎机投料，生产 2 个碎铁矿。',
  },
  {
    id: 'smelt-ingot',
    index: 6,
    title: '完成铁锭熔炼',
    instruction: '把碎铁矿送进熔炼炉，生产 2 个铁锭。',
  },
  {
    id: 'forge-shaft',
    index: 7,
    title: '完成传动轴锻压',
    instruction: '给锻压机投入 2 个铁锭（悬停按 R 切到「锻压传动轴」），锻出 1 根传动轴。',
  },
  {
    id: 'complete',
    index: 8,
    title: '订单完成',
    instruction: '第一根由锻压机实际制造的传动轴已经交货。',
  },
]);

/** 订单数量口径（固定值；订单系统只识别进度，不定义生产逻辑）。 */
export interface GoalRequirements {
  readonly ironOre: number;
  readonly crushedOre: number;
  readonly ironIngot: number;
  readonly shaft: number;
}

export const GOAL_REQUIREMENTS: GoalRequirements = Object.freeze({
  ironOre: 2,
  crushedOre: 2,
  ironIngot: 2,
  shaft: 1,
});

/** 订单涉及的三台机器（顺序即步骤 2/4 的检查顺序）。 */
export const MACHINE_KINDS: readonly GoalMachineKind[] = Object.freeze(['crusher', 'smelter', 'forge']);

export const MACHINE_LABELS: Readonly<Record<GoalMachineKind, string>> = Object.freeze({
  crusher: '破碎机',
  smelter: '熔炼炉',
  forge: '锻压机',
});

/** 生产步骤要求的配方（复用 recipes.ts，避免文案/ID 双份维护）。 */
export const ORDER_RECIPE_BY_KIND: Readonly<Record<GoalMachineKind, Recipe>> = Object.freeze({
  crusher: CRUSH_RECIPE,
  smelter: SMELT_RECIPE,
  forge: FORGE_SHAFT_RECIPE,
});

/** 步骤 → 机器种类（只有生产步骤有）。 */
export const PRODUCTION_STEP_KIND: Readonly<Partial<Record<GoalStepId, GoalMachineKind>>> = Object.freeze({
  'crush-ore': 'crusher',
  'smelt-ingot': 'smelter',
  'forge-shaft': 'forge',
});

export const INPUT_HINTS: Readonly<Record<GoalMachineKind, string>> = Object.freeze({
  crusher: '按 C 从库存把铁矿石投进破碎机。',
  smelter: '把碎铁矿送进熔炼炉（接溜槽或按 C 投料）。',
  forge: '按 C 从库存把铁锭投进锻压机，每根传动轴需要 2 个铁锭。',
});

export const NO_POWER_MESSAGE = '动力网络没有输出：靠近飞轮按住 C 储能，再右键接合离合。';

export function isGoalMachineKind(kind: PartId): kind is GoalMachineKind {
  return (MACHINE_KINDS as readonly string[]).includes(kind);
}
