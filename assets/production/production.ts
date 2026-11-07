import type { ItemId } from '../items/items.ts';
import type { MechanicalPartDef } from '../mechanical/parts.ts';
import { primaryInputOf, primaryOutputOf, recipesFor, type Recipe } from './recipes.ts';

/**
 * M1.8-C 加工机器状态机（纯逻辑、零引擎依赖）。
 *
 * 规则（全部可单测，不依赖引擎）：
 * - 加工必须由机械动力驱动：`powered=false` 时**进度冻结**、原料不消耗，恢复后从原进度继续；
 * - 每周期开始时整笔消耗原料、整笔检查输出空间；任一不满足就绪条件就不开工，绝不半途扣料；
 * - 周期完成时若输出缓冲已满，进度停在 1.0 等空间释放，**不丢产物**；
 * - 一台机器只有一条配方生效，配方只能在该周期尚未消耗原料时切换；
 * - `producedTotal` 是真正的累计产出件数（生产目标读数用），不从动画推导。
 */

export type MachineBlockReason = 'ok' | 'no-power' | 'no-input' | 'output-full' | 'no-recipe';

export interface MachineState {
  readonly partId: number;
  recipeIndex: number;
  /** 当前周期进度 0..1；1 表示「已完成但输出被堵住」。 */
  progress: number;
  inputItem: ItemId | null;
  inputCount: number;
  outputItem: ItemId | null;
  outputCount: number;
  /** 本帧是否真的在推进（给读数/动画用）。 */
  running: boolean;
  /** 本帧为什么没开工（ok = 正在加工或可以加工）。 */
  block: MachineBlockReason;
  /** 累计产出件数。 */
  producedTotal: number;
}

export const DEFAULT_INPUT_CAPACITY = 4;
export const DEFAULT_OUTPUT_CAPACITY = 4;

export function inputCapacity(def: MechanicalPartDef): number {
  return def.buffers?.input ?? DEFAULT_INPUT_CAPACITY;
}

export function outputCapacity(def: MechanicalPartDef): number {
  return def.buffers?.output ?? DEFAULT_OUTPUT_CAPACITY;
}

export function createMachineState(partId: number): MachineState {
  return {
    partId,
    recipeIndex: 0,
    progress: 0,
    inputItem: null,
    inputCount: 0,
    outputItem: null,
    outputCount: 0,
    running: false,
    block: 'no-recipe',
    producedTotal: 0,
  };
}

/** 当前生效的配方；机器没有配方时返回 undefined。 */
export function activeRecipe(state: MachineState, def: MechanicalPartDef): Recipe | undefined {
  const list = recipesFor(def.id);
  if (list.length === 0) return undefined;
  const index = Math.min(Math.max(state.recipeIndex, 0), list.length - 1);
  return list[index];
}

/** 缓冲里的原料是否是当前配方的原料类型（用于判断能否切换配方）。 */
export function hasBufferedInput(state: MachineState): boolean {
  return state.inputCount > 0;
}

/** 能否切换配方：必须处在「周期未开始」状态（进度 0 且没有已消耗的原料）。 */
export function canSwitchRecipe(state: MachineState): boolean {
  return state.progress === 0 && state.inputCount === 0;
}

/** 循环切到下一条配方；不允许时返回 false 且不改状态。 */
export function cycleRecipe(state: MachineState, def: MechanicalPartDef): boolean {
  const list = recipesFor(def.id);
  if (list.length <= 1) return false;
  if (!canSwitchRecipe(state)) return false;
  state.recipeIndex = (state.recipeIndex + 1) % list.length;
  return true;
}

/** 该机器当前接受的原料类型；没有配方返回 undefined。 */
export function acceptedInputOf(state: MachineState, def: MechanicalPartDef): ItemId | undefined {
  const recipe = activeRecipe(state, def);
  return recipe ? primaryInputOf(recipe)?.itemId : undefined;
}

/**
 * 往输入缓冲投料。返回实际投入数量。
 * 只接受当前配方的原料、且不与已缓冲的其他原料混装、不超过容量。
 */
export function insertInput(
  state: MachineState,
  def: MechanicalPartDef,
  itemId: ItemId,
  count: number,
): number {
  if (!Number.isInteger(count) || count <= 0) return 0;
  const accepted = acceptedInputOf(state, def);
  if (accepted === undefined || accepted !== itemId) return 0;
  if (state.inputCount > 0 && state.inputItem !== itemId) return 0;
  const space = inputCapacity(def) - state.inputCount;
  if (space <= 0) return 0;
  const put = Math.min(space, count);
  state.inputItem = itemId;
  state.inputCount += put;
  return put;
}

/** 从输出缓冲取货（先入先出只有一种物品，直接整取或取指定数量）。 */
export function takeOutput(
  state: MachineState,
  count: number,
): { readonly itemId: ItemId; readonly count: number } | undefined {
  if (state.outputItem === null || state.outputCount <= 0) return undefined;
  const n = Math.min(state.outputCount, Math.max(0, Math.floor(count)));
  if (n <= 0) return undefined;
  const itemId = state.outputItem;
  state.outputCount -= n;
  if (state.outputCount === 0) state.outputItem = null;
  return { itemId, count: n };
}

/** 输出缓冲还能放多少个该物品（供读数/外部预判使用）。 */
export function outputSpaceFor(
  state: MachineState,
  def: MechanicalPartDef,
  itemId: ItemId,
): number {
  if (state.outputCount > 0 && state.outputItem !== itemId) return 0;
  return Math.max(0, outputCapacity(def) - state.outputCount);
}

function canStoreOutput(
  state: MachineState,
  def: MechanicalPartDef,
  itemId: ItemId,
  amount: number,
): boolean {
  if (state.outputCount > 0 && state.outputItem !== itemId) return false;
  return state.outputCount + amount <= outputCapacity(def);
}

export interface MachineTickInput {
  readonly def: MechanicalPartDef;
  /** 机械动力是否有效（断轴/过载/源停 → false）。 */
  readonly powered: boolean;
  /** 实际转速 / 额定转速（1 = 额定 60 RPM）。 */
  readonly rate: number;
  readonly delta: number;
}

/**
 * 推进一个加工周期。返回本帧是否完成了一个周期（供 UI/后续逻辑使用）。
 */
export function tickMachine(state: MachineState, input: MachineTickInput): boolean {
  const { def, powered } = input;
  const dt = Number.isFinite(input.delta) ? Math.max(0, Math.min(input.delta, 0.25)) : 0;
  const rate = Number.isFinite(input.rate) ? Math.max(0, input.rate) : 0;

  // 零长度时间步：绝不改任何状态。
  // （曾经在这里丢掉过原料：dt=0 时照常「整笔扣料」，但 progress += 0 不前进，
  //   下一帧又因为进度为 0 重新要求整笔原料 → 缓冲里的料凭空消失。真机 playthrough 抓到的。）
  if (dt <= 0) {
    state.running = false;
    return false;
  }

  state.running = false;
  const recipe = activeRecipe(state, def);
  if (!recipe) {
    state.block = 'no-recipe';
    return false;
  }
  const inSpec = primaryInputOf(recipe);
  const outSpec = primaryOutputOf(recipe);
  if (!inSpec || !outSpec) {
    state.block = 'no-recipe';
    return false;
  }
  // 缓冲里残留的是别的东西：不推进，等玩家处理（不会静默吞料）。
  if (state.inputCount > 0 && state.inputItem !== inSpec.itemId) {
    state.block = 'no-input';
    return false;
  }
  if (!powered || rate <= 0) {
    state.block = 'no-power';
    return false;
  }

  if (state.progress <= 0) {
    if (state.inputCount < inSpec.count) {
      state.progress = 0;
      state.block = 'no-input';
      return false;
    }
    if (!canStoreOutput(state, def, outSpec.itemId, outSpec.count)) {
      state.progress = 0;
      state.block = 'output-full';
      return false;
    }
    // 开工：整笔扣料。
    state.inputCount -= inSpec.count;
    if (state.inputCount === 0) state.inputItem = null;
  }

  state.running = true;
  state.block = 'ok';
  state.progress += (rate * dt) / recipe.seconds;
  if (state.progress < 1) return false;

  if (!canStoreOutput(state, def, outSpec.itemId, outSpec.count)) {
    state.progress = 1;
    state.running = false;
    state.block = 'output-full';
    return false;
  }
  if (state.outputCount > 0) {
    state.outputItem = outSpec.itemId;
    state.outputCount += outSpec.count;
  } else {
    state.outputItem = outSpec.itemId;
    state.outputCount = outSpec.count;
  }
  state.producedTotal += outSpec.count;
  state.progress = 0;
  return true;
}

/** 机器被拆除时把缓冲里的东西全部取出（防止物品消失）。 */
export function flushMachine(state: MachineState): { readonly itemId: ItemId; readonly count: number }[] {
  const result: { itemId: ItemId; count: number }[] = [];
  if (state.inputItem !== null && state.inputCount > 0) {
    result.push({ itemId: state.inputItem, count: state.inputCount });
  }
  if (state.outputItem !== null && state.outputCount > 0) {
    result.push({ itemId: state.outputItem, count: state.outputCount });
  }
  state.inputItem = null;
  state.inputCount = 0;
  state.outputItem = null;
  state.outputCount = 0;
  state.progress = 0;
  state.running = false;
  state.block = 'no-recipe';
  return result;
}
