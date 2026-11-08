import { ITEM_IDS } from '../items/items.ts';
import {
  GOAL_REQUIREMENTS,
  GOAL_STEPS,
  MACHINE_KINDS,
  ORDER_SUBTITLE,
  ORDER_TITLE,
  PRODUCTION_STEP_KIND,
  type GoalBlockerCode,
  type GoalStepDefinition,
  type GoalStepId,
} from './order.ts';
import type { GoalObservation } from './observation.ts';
import {
  captureBaseline,
  createContext,
  deltaOf,
  hasAllMachines,
  isPowerStarted,
  type GoalContext,
} from './goal-context.ts';
import { resolveBlocker } from './goal-blockers.ts';

/**
 * M2.0-P1-A 第一份工业订单：八步目标状态机（纯逻辑、零引擎依赖）。
 *
 * 边界（与任务书一致）：
 * - 只读输入：本模块不认识引擎、库存服务或机械运行时，只接收一份纯数据快照 GoalObservation；
 * - 不重复实现生产逻辑：库存、机器、动力网络的状态全部由现有系统给出，本模块只做判定与文案；
 * - 真实生产：生产步骤只看 production.produced 相对**订单开始基线**的增量，绝不用库存数量判断，
 *   因此开局原型套件自带的 24 根传动轴不会让订单直接完成，历史累计产出也不会误判新订单；
 * - latch：已完成步骤不回退，当前目标 = 第一个未完成的步骤；后续步骤只在前一步完成后才参与判定；
 * - 拆除机器不会造成虚假完成：已锁存步骤保留，但当前步骤的阻塞原因会提示重建机器/重接动力。
 *
 * 文件拆分：只读上下文与阻塞文案分别在 goal-context.ts / goal-blockers.ts（守住 20 KB 上限），
 * 本文件保留类型、状态机推进与快照组装；对外导出接口不变。
 */

/** 订单开始时的生产累计产出基线。 */
export interface GoalProducedBaseline {
  readonly crushedOre: number;
  readonly ironIngot: number;
  readonly shaft: number;
}

/** 订单状态（可序列化纯数据；阶段 B 可原样缓存）。 */
export interface GoalState {
  readonly baseline: GoalProducedBaseline;
  /** 已锁存的步骤，按顺序；包含 'complete' 表示订单已完成。 */
  readonly completed: readonly GoalStepId[];
}

export interface GoalStepProgress {
  readonly current: number;
  readonly required: number;
}

export interface GoalStepSnapshot extends GoalStepDefinition {
  readonly completed: boolean;
  /** 可量化进度；没有数量语义的步骤为 null。 */
  readonly progress: GoalStepProgress | null;
}

export interface GoalBlocker {
  readonly code: GoalBlockerCode;
  readonly message: string;
}

/** 每帧输出的目标读数（纯 JSON，HUD 直接消费）。 */
export interface GoalSnapshot {
  readonly title: string;
  readonly subtitle: string;
  readonly complete: boolean;
  readonly currentStep: GoalStepSnapshot;
  readonly steps: readonly GoalStepSnapshot[];
  readonly blocker: GoalBlocker | null;
  /** 当前步骤相关的零件（机器或动力源，供 HUD 高亮）；没有时为 null。 */
  readonly focusPartId: number | null;
}

export interface GoalEvaluation {
  readonly state: GoalState;
  readonly snapshot: GoalSnapshot;
}

function isStepSatisfied(stepId: GoalStepId, observation: GoalObservation, context: GoalContext): boolean {
  switch (stepId) {
    case 'gather-ore':
      return observation.ironOre >= GOAL_REQUIREMENTS.ironOre;
    case 'build-machines':
      return hasAllMachines(context);
    case 'connect-power':
      return hasAllMachines(context) && context.orderNetwork !== undefined;
    case 'start-power':
      return isPowerStarted(context);
    case 'crush-ore':
      return deltaOf(context, ITEM_IDS.CRUSHED_ORE) >= GOAL_REQUIREMENTS.crushedOre;
    case 'smelt-ingot':
      return deltaOf(context, ITEM_IDS.IRON_INGOT) >= GOAL_REQUIREMENTS.ironIngot;
    case 'forge-shaft':
      return deltaOf(context, ITEM_IDS.SHAFT) >= GOAL_REQUIREMENTS.shaft;
    case 'complete':
      // 完成态由「前七步是否全部锁存」推导，不单独判定。
      return false;
  }
}

function stepProgress(stepId: GoalStepId, observation: GoalObservation, context: GoalContext): GoalStepProgress | null {
  switch (stepId) {
    case 'gather-ore':
      return {
        current: Math.min(Math.max(0, Math.floor(observation.ironOre)), GOAL_REQUIREMENTS.ironOre),
        required: GOAL_REQUIREMENTS.ironOre,
      };
    case 'build-machines':
      return { current: context.builtMachineKinds.size, required: MACHINE_KINDS.length };
    case 'crush-ore':
      return {
        current: Math.min(deltaOf(context, ITEM_IDS.CRUSHED_ORE), GOAL_REQUIREMENTS.crushedOre),
        required: GOAL_REQUIREMENTS.crushedOre,
      };
    case 'smelt-ingot':
      return {
        current: Math.min(deltaOf(context, ITEM_IDS.IRON_INGOT), GOAL_REQUIREMENTS.ironIngot),
        required: GOAL_REQUIREMENTS.ironIngot,
      };
    case 'forge-shaft':
      return {
        current: Math.min(deltaOf(context, ITEM_IDS.SHAFT), GOAL_REQUIREMENTS.shaft),
        required: GOAL_REQUIREMENTS.shaft,
      };
    default:
      return null;
  }
}

function focusPartIdOf(stepId: GoalStepId, context: GoalContext): number | null {
  const kind = PRODUCTION_STEP_KIND[stepId];
  if (kind !== undefined) {
    const machine = context.machinesByKind.get(kind)?.[0];
    if (machine !== undefined) return machine.partId;
    return context.firstPartOfKind.get(kind) ?? null;
  }
  if (stepId === 'start-power') return context.orderSource?.partId ?? null;
  return null;
}

/**
 * 已完成步骤的显示进度：锁存后的步骤一律显示满进度。
 * 否则「采集铁矿石」在原料被消耗后会显示 ✓ 0 / 2，「建造生产机器」在拆机期间显示 ✓ 2 / 3，
 * 与已锁存的完成状态自相矛盾（D 阶段真实 playthrough 抓到的 HUD/运行时不一致）。
 */
function completedProgress(progress: GoalStepProgress | null): GoalStepProgress | null {
  if (progress === null) return null;
  return { current: progress.required, required: progress.required };
}

function buildSnapshot(state: GoalState, observation: GoalObservation, context: GoalContext): GoalSnapshot {
  const complete = state.completed.includes('complete');
  const steps: GoalStepSnapshot[] = GOAL_STEPS.map((definition) => {
    const completed = state.completed.includes(definition.id);
    return {
      ...definition,
      completed,
      progress: completed
        ? completedProgress(stepProgress(definition.id, observation, context))
        : stepProgress(definition.id, observation, context),
    };
  });
  const currentStep = steps.find((step) => !step.completed) ?? steps[steps.length - 1]!;
  return {
    title: ORDER_TITLE,
    subtitle: ORDER_SUBTITLE,
    complete,
    currentStep,
    steps,
    blocker: complete ? null : resolveBlocker(currentStep.id, observation, context),
    focusPartId: complete ? null : focusPartIdOf(currentStep.id, context),
  };
}

/** 创建订单状态并记录生产累计产出的基线（订单开始）。 */
export function createGoalState(observation: GoalObservation): GoalState {
  return { baseline: captureBaseline(observation), completed: [] };
}

/**
 * 推进订单求值（纯函数：不修改入参）。
 * 按顺序锁存满足条件的步骤，遇到第一个未满足的步骤即停止；已有锁存永不回退。
 */
export function evaluateGoal(state: GoalState, observation: GoalObservation): GoalEvaluation {
  const context = createContext(observation, state.baseline);
  const completed: GoalStepId[] = [...state.completed];
  for (const step of GOAL_STEPS) {
    if (completed.includes(step.id)) continue;
    if (step.id === 'complete') {
      if (completed.length >= GOAL_STEPS.length - 1) completed.push('complete');
      break;
    }
    if (!isStepSatisfied(step.id, observation, context)) break;
    completed.push(step.id);
  }
  const nextState: GoalState = { baseline: state.baseline, completed };
  return { state: nextState, snapshot: buildSnapshot(nextState, observation, context) };
}

export {
  GOAL_REQUIREMENTS,
  GOAL_STEPS,
  MACHINE_KINDS,
  MACHINE_LABELS,
  ORDER_TITLE,
  ORDER_SUBTITLE,
} from './order.ts';
export type {
  GoalBlockerCode,
  GoalMachineKind,
  GoalOrderStepId,
  GoalStepDefinition,
  GoalStepId,
} from './order.ts';
export type {
  GoalMachineObservation,
  GoalNetworkObservation,
  GoalObservation,
  GoalPartObservation,
  GoalSourceObservation,
} from './observation.ts';
