import type { PartId } from '../mechanical/parts.ts';
import type { MachineBlockReason } from '../production/production.ts';
import {
  createGoalState,
  evaluateGoal,
  type GoalMachineObservation,
  type GoalNetworkObservation,
  type GoalObservation,
  type GoalPartObservation,
  type GoalSnapshot,
  type GoalSourceObservation,
  type GoalState,
} from '../goal/goal.ts';

// M2.0-P1-A 测试共用夹具：八步订单的纯数据快照构建器。
// 从 goal.test.ts 拆出，避免单文件触及 20 KB 提交钩子；测试覆盖保持完全不变。

export const FLYWHEEL = 1;
export const SHAFT = 2;
export const CRUSHER = 3;
export const SMELTER = 4;
export const FORGE = 5;

export function part(partId: number, partKind: PartId, powered = false): GoalPartObservation {
  return { partId, partKind, powered, stalled: false };
}

export function machineState(
  partId: number,
  recipeId: string,
  block: MachineBlockReason = 'ok',
  overrides: Partial<GoalMachineObservation> = {},
): GoalMachineObservation {
  return {
    partId,
    recipeId,
    progress: 0,
    block,
    inputItem: null,
    inputCount: 0,
    outputItem: null,
    outputCount: 0,
    running: block === 'ok',
    ...overrides,
  };
}

export function crusherState(
  block: MachineBlockReason = 'ok',
  overrides: Partial<GoalMachineObservation> = {},
): GoalMachineObservation {
  return machineState(CRUSHER, 'crush-iron-ore', block, overrides);
}

export function smelterState(
  block: MachineBlockReason = 'ok',
  overrides: Partial<GoalMachineObservation> = {},
): GoalMachineObservation {
  return machineState(SMELTER, 'smelt-crushed-ore', block, overrides);
}

export function forgeState(
  recipeId = 'forge-shaft',
  block: MachineBlockReason = 'ok',
  overrides: Partial<GoalMachineObservation> = {},
): GoalMachineObservation {
  return machineState(FORGE, recipeId, block, overrides);
}

export function flywheel(engaged: boolean): GoalSourceObservation {
  return { partId: FLYWHEEL, engaged, energy: engaged ? 200 : 0, energyCapacity: 300 };
}

export function orderNetwork(overrides: Partial<GoalNetworkObservation> = {}): GoalNetworkObservation {
  return {
    id: 0,
    status: 'powered',
    reason: null,
    sourceIds: [FLYWHEEL],
    machineIds: [CRUSHER, SMELTER, FORGE],
    partIds: [FLYWHEEL, SHAFT, CRUSHER, SMELTER, FORGE],
    stalledPartIds: [],
    speedFactor: 1,
    ...overrides,
  };
}

export function observation(overrides: Partial<GoalObservation> = {}): GoalObservation {
  return { ironOre: 0, parts: [], machines: [], sources: [], networks: [], produced: [], ...overrides };
}

export function producedOf(crushedOre: number, ironIngot: number, shaft: number): GoalObservation['produced'] {
  return [
    { itemId: 'crushed_ore', count: crushedOre },
    { itemId: 'iron_ingot', count: ironIngot },
    { itemId: 'shaft', count: shaft },
  ];
}

/** 三台机器建成，无动力源。 */
export function builtMachines(overrides: Partial<GoalObservation> = {}): GoalObservation {
  return observation({
    ironOre: 2,
    parts: [part(CRUSHER, 'crusher'), part(SMELTER, 'smelter'), part(FORGE, 'forge')],
    machines: [crusherState(), smelterState(), forgeState()],
    networks: [orderNetwork({ sourceIds: [], status: 'idle', reason: 'no-source', speedFactor: 0 })],
    ...overrides,
  });
}

/** 整条产线建好但飞轮未启动。 */
export function factory(overrides: Partial<GoalObservation> = {}): GoalObservation {
  return observation({
    ironOre: 2,
    parts: [
      part(FLYWHEEL, 'flywheel_source'),
      part(SHAFT, 'shaft'),
      part(CRUSHER, 'crusher'),
      part(SMELTER, 'smelter'),
      part(FORGE, 'forge'),
    ],
    machines: [crusherState(), smelterState(), forgeState()],
    sources: [flywheel(false)],
    networks: [orderNetwork({ status: 'idle', speedFactor: 0 })],
    ...overrides,
  });
}

/** 整条产线自动化运行中。 */
export function poweredFactory(overrides: Partial<GoalObservation> = {}): GoalObservation {
  return observation({
    ironOre: 2,
    parts: [
      part(FLYWHEEL, 'flywheel_source', true),
      part(SHAFT, 'shaft', true),
      part(CRUSHER, 'crusher', true),
      part(SMELTER, 'smelter', true),
      part(FORGE, 'forge', true),
    ],
    machines: [crusherState(), smelterState(), forgeState()],
    sources: [flywheel(true)],
    networks: [orderNetwork()],
    ...overrides,
  });
}

/** 空世界基线（生产 0），对场景求值一次。 */
export function evaluate(
  scene: GoalObservation,
  baseline: GoalObservation = observation(),
): { state: GoalState; snapshot: GoalSnapshot } {
  return evaluateGoal(createGoalState(baseline), scene);
}

export function stepById(snapshot: GoalSnapshot, id: string) {
  return snapshot.steps.find((step) => step.id === id);
}
