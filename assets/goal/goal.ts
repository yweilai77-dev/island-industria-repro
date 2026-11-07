import { ITEM_IDS, type ItemId } from '../items/items.ts';
import type { PartId } from '../mechanical/parts.ts';
import {
  GOAL_REQUIREMENTS,
  GOAL_STEPS,
  INPUT_HINTS,
  MACHINE_KINDS,
  MACHINE_LABELS,
  NO_POWER_MESSAGE,
  ORDER_RECIPE_BY_KIND,
  ORDER_SUBTITLE,
  ORDER_TITLE,
  PRODUCTION_STEP_KIND,
  isGoalMachineKind,
  type GoalBlockerCode,
  type GoalMachineKind,
  type GoalStepDefinition,
  type GoalStepId,
} from './order.ts';
import type {
  GoalMachineObservation,
  GoalNetworkObservation,
  GoalObservation,
  GoalPartObservation,
  GoalSourceObservation,
} from './observation.ts';

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
 * 阶段 A 只提供本模块与单测；接线（每帧快照 → progress 服务）属于阶段 B。
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

interface GoalContext {
  readonly partById: ReadonlyMap<number, GoalPartObservation>;
  readonly kindOfPart: ReadonlyMap<number, PartId>;
  readonly builtMachineKinds: ReadonlySet<GoalMachineKind>;
  readonly firstPartOfKind: ReadonlyMap<GoalMachineKind, number>;
  readonly machinesByKind: ReadonlyMap<GoalMachineKind, readonly GoalMachineObservation[]>;
  readonly hasPowerSource: boolean;
  /** 同时包含三台机器与动力源、结构可用的网络（没有则为 undefined）。 */
  readonly orderNetwork: GoalNetworkObservation | undefined;
  readonly orderSource: GoalSourceObservation | undefined;
  /** 订单开始后新增的生产数量（已扣基线并夹到 >= 0）。 */
  readonly producedDelta: ReadonlyMap<ItemId, number>;
}


function producedCountOf(observation: GoalObservation, itemId: ItemId): number {
  return observation.produced.find((entry) => entry.itemId === itemId)?.count ?? 0;
}

function baselineCountOf(baseline: GoalProducedBaseline, itemId: ItemId): number {
  if (itemId === ITEM_IDS.CRUSHED_ORE) return baseline.crushedOre;
  if (itemId === ITEM_IDS.IRON_INGOT) return baseline.ironIngot;
  if (itemId === ITEM_IDS.SHAFT) return baseline.shaft;
  return 0;
}

function captureBaseline(observation: GoalObservation): GoalProducedBaseline {
  return {
    crushedOre: producedCountOf(observation, ITEM_IDS.CRUSHED_ORE),
    ironIngot: producedCountOf(observation, ITEM_IDS.IRON_INGOT),
    shaft: producedCountOf(observation, ITEM_IDS.SHAFT),
  };
}

function networkHasMachineKind(
  network: GoalNetworkObservation,
  kind: GoalMachineKind,
  kindOfPart: ReadonlyMap<number, PartId>,
): boolean {
  for (const partId of network.partIds) {
    if (kindOfPart.get(partId) === kind) return true;
  }
  return false;
}

function createContext(observation: GoalObservation, baseline: GoalProducedBaseline): GoalContext {
  const partById = new Map<number, GoalPartObservation>();
  const kindOfPart = new Map<number, PartId>();
  const builtMachineKinds = new Set<GoalMachineKind>();
  const firstPartOfKind = new Map<GoalMachineKind, number>();
  let hasPowerSource = false;
  for (const part of observation.parts) {
    partById.set(part.partId, part);
    kindOfPart.set(part.partId, part.partKind);
    if (isGoalMachineKind(part.partKind)) {
      builtMachineKinds.add(part.partKind);
      if (!firstPartOfKind.has(part.partKind)) firstPartOfKind.set(part.partKind, part.partId);
    }
    if (part.partKind === 'power_source' || part.partKind === 'flywheel_source') hasPowerSource = true;
  }

  const machinesByKind = new Map<GoalMachineKind, GoalMachineObservation[]>();
  for (const machine of [...observation.machines].sort((a, b) => a.partId - b.partId)) {
    const kind = kindOfPart.get(machine.partId);
    if (kind === undefined || !isGoalMachineKind(kind)) continue;
    const list = machinesByKind.get(kind);
    if (list) list.push(machine);
    else machinesByKind.set(kind, [machine]);
  }

  const producedDelta = new Map<ItemId, number>();
  for (const itemId of [ITEM_IDS.CRUSHED_ORE, ITEM_IDS.IRON_INGOT, ITEM_IDS.SHAFT]) {
    producedDelta.set(
      itemId,
      Math.max(0, producedCountOf(observation, itemId) - baselineCountOf(baseline, itemId)),
    );
  }

  const orderNetwork = [...observation.networks]
    .sort((a, b) => a.id - b.id)
    .find(
      (network) =>
        network.status !== 'unsupported'
        && network.sourceIds.length > 0
        && MACHINE_KINDS.every((kind) => networkHasMachineKind(network, kind, kindOfPart)),
    );
  const orderSource = orderNetwork === undefined
    ? undefined
    : observation.sources.find((source) => orderNetwork.sourceIds.includes(source.partId));

  return {
    partById,
    kindOfPart,
    builtMachineKinds,
    firstPartOfKind,
    machinesByKind,
    hasPowerSource,
    orderNetwork,
    orderSource,
    producedDelta,
  };
}

function deltaOf(context: GoalContext, itemId: ItemId): number {
  return context.producedDelta.get(itemId) ?? 0;
}

function hasAllMachines(context: GoalContext): boolean {
  return MACHINE_KINDS.every((kind) => context.builtMachineKinds.has(kind));
}

function isKindPowered(context: GoalContext, kind: GoalMachineKind, network: GoalNetworkObservation): boolean {
  for (const part of context.partById.values()) {
    if (part.partKind !== kind) continue;
    if (!part.powered || part.stalled) continue;
    if (network.partIds.includes(part.partId)) return true;
  }
  return false;
}

function isPowerStarted(context: GoalContext): boolean {
  const network = context.orderNetwork;
  if (network === undefined || network.status !== 'powered' || network.speedFactor <= 0) return false;
  if (context.orderSource === undefined || context.orderSource.engaged !== true) return false;
  return MACHINE_KINDS.every((kind) => isKindPowered(context, kind, network));
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

function missingMachineBlocker(context: GoalContext): GoalBlocker | null {
  const missing = MACHINE_KINDS.filter((kind) => !context.builtMachineKinds.has(kind));
  if (missing.length === 0) return null;
  return {
    code: 'missing-machine',
    message: `生产机器尚未建造：还缺${missing.map((kind) => MACHINE_LABELS[kind]).join('、')}。`,
  };
}

function connectionBlocker(context: GoalContext): GoalBlocker | null {
  const missingMachine = missingMachineBlocker(context);
  if (missingMachine) return missingMachine;
  if (!context.hasPowerSource) {
    return { code: 'missing-power-source', message: '还没有动力源：先建造一台手摇飞轮储能机。' };
  }
  if (context.orderNetwork === undefined) {
    return {
      code: 'no-connection',
      message: '动力连接尚未完成：把破碎机、熔炼炉、锻压机和动力源接进同一套传动网络。',
    };
  }
  return null;
}

function startPowerBlocker(context: GoalContext): GoalBlocker | null {
  const connection = connectionBlocker(context);
  if (connection) return connection;
  const network = context.orderNetwork;
  if (network === undefined) return null;
  if (network.status === 'stalled') {
    return { code: 'network-overload', message: '动力网络过载：先停掉一部分机器，再重新启动飞轮。' };
  }
  const source = context.orderSource;
  if (source === undefined) {
    return { code: 'missing-power-source', message: '当前网络没有可用的动力源：接一台手摇飞轮储能机。' };
  }
  if (!source.engaged) return { code: 'no-power', message: NO_POWER_MESSAGE };
  const unpowered = MACHINE_KINDS.filter((kind) => !isKindPowered(context, kind, network));
  if (unpowered.length > 0) {
    return {
      code: 'no-power',
      message: `${unpowered.map((kind) => MACHINE_LABELS[kind]).join('、')}没有获得动力：检查传动连接与飞轮离合。`,
    };
  }
  return null;
}

function networkOfMachine(context: GoalContext, partId: number): GoalNetworkObservation | undefined {
  return context.orderNetwork?.machineIds.includes(partId) ? context.orderNetwork : undefined;
}

function productionBlocker(kind: GoalMachineKind, context: GoalContext): GoalBlocker | null {
  const label = MACHINE_LABELS[kind];
  if (!context.builtMachineKinds.has(kind)) {
    return { code: 'missing-machine', message: `缺少${label}：请先建造或重新放回生产线上。` };
  }
  const machine = context.machinesByKind.get(kind)?.[0];
  if (machine === undefined) {
    return { code: 'missing-machine', message: `缺少${label}：请先建造或重新放回生产线上。` };
  }
  const expected = ORDER_RECIPE_BY_KIND[kind];
  if (machine.recipeId !== expected.id) {
    return {
      code: 'wrong-recipe',
      message: `${label}当前配方不是「${expected.label}」：悬停按 R 切换配方。`,
    };
  }
  const network = networkOfMachine(context, machine.partId);
  if (network?.status === 'stalled') {
    return { code: 'network-overload', message: `动力网络过载：${label}停转了，先关掉一部分机器。` };
  }
  const part = context.partById.get(machine.partId);
  const poweredPart = part !== undefined && part.powered && !part.stalled;
  switch (machine.block) {
    case 'no-input':
      return { code: 'no-input', message: `${label}缺少原料：${INPUT_HINTS[kind]}` };
    case 'output-full':
      return { code: 'output-full', message: `输出堵塞，请取出成品：${label}的输出缓冲已满。` };
    case 'no-recipe':
      return { code: 'no-recipe', message: `${label}没有可用配方。` };
    case 'no-power':
      return { code: 'no-power', message: `${label}没有动力：检查传动连接，并给飞轮储能接合离合。` };
    case 'ok':
      if (poweredPart) return null;
      return { code: 'no-power', message: `${label}没有动力：检查传动连接，并给飞轮储能接合离合。` };
  }
}

function oreBlocker(observation: GoalObservation): GoalBlocker | null {
  const ore = Math.max(0, Math.floor(observation.ironOre));
  if (ore >= GOAL_REQUIREMENTS.ironOre) return null;
  return {
    code: 'missing-ore',
    message: `去矿点采集铁矿石：还需要 ${GOAL_REQUIREMENTS.ironOre - ore} 个。`,
  };
}

function resolveBlocker(stepId: GoalStepId, observation: GoalObservation, context: GoalContext): GoalBlocker | null {
  switch (stepId) {
    case 'gather-ore':
      return oreBlocker(observation);
    case 'build-machines':
      return missingMachineBlocker(context);
    case 'connect-power':
      return connectionBlocker(context);
    case 'start-power':
      return startPowerBlocker(context);
    case 'crush-ore':
      return productionBlocker('crusher', context);
    case 'smelt-ingot':
      return productionBlocker('smelter', context);
    case 'forge-shaft':
      return productionBlocker('forge', context);
    case 'complete':
      return null;
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

function buildSnapshot(state: GoalState, observation: GoalObservation, context: GoalContext): GoalSnapshot {
  const complete = state.completed.includes('complete');
  const steps: GoalStepSnapshot[] = GOAL_STEPS.map((definition) => ({
    ...definition,
    completed: state.completed.includes(definition.id),
    progress: stepProgress(definition.id, observation, context),
  }));
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
