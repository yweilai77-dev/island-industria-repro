import { describe, expect, it } from 'vitest';
import type { ItemId } from '../items/items.ts';
import type { PartId } from '../mechanical/parts.ts';
import type { MachineBlockReason } from '../production/production.ts';
import {
  GOAL_REQUIREMENTS,
  GOAL_STEPS,
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

// M2.0-P1-A 单元测试：八步订单状态机（纯数据快照，不依赖引擎/库存/机械运行时）。

const FLYWHEEL = 1;
const SHAFT = 2;
const CRUSHER = 3;
const SMELTER = 4;
const FORGE = 5;

function part(partId: number, partKind: PartId, powered = false): GoalPartObservation {
  return { partId, partKind, powered, stalled: false };
}

function machineState(
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

function crusherState(
  block: MachineBlockReason = 'ok',
  overrides: Partial<GoalMachineObservation> = {},
): GoalMachineObservation {
  return machineState(CRUSHER, 'crush-iron-ore', block, overrides);
}

function smelterState(
  block: MachineBlockReason = 'ok',
  overrides: Partial<GoalMachineObservation> = {},
): GoalMachineObservation {
  return machineState(SMELTER, 'smelt-crushed-ore', block, overrides);
}

function forgeState(
  recipeId = 'forge-shaft',
  block: MachineBlockReason = 'ok',
  overrides: Partial<GoalMachineObservation> = {},
): GoalMachineObservation {
  return machineState(FORGE, recipeId, block, overrides);
}

function flywheel(engaged: boolean): GoalSourceObservation {
  return { partId: FLYWHEEL, engaged, energy: engaged ? 200 : 0, energyCapacity: 300 };
}

function orderNetwork(overrides: Partial<GoalNetworkObservation> = {}): GoalNetworkObservation {
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

function observation(overrides: Partial<GoalObservation> = {}): GoalObservation {
  return { ironOre: 0, parts: [], machines: [], sources: [], networks: [], produced: [], ...overrides };
}

function producedOf(crushedOre: number, ironIngot: number, shaft: number): GoalObservation['produced'] {
  return [
    { itemId: 'crushed_ore', count: crushedOre },
    { itemId: 'iron_ingot', count: ironIngot },
    { itemId: 'shaft', count: shaft },
  ];
}

/** 三台机器建成，无动力源。 */
function builtMachines(overrides: Partial<GoalObservation> = {}): GoalObservation {
  return observation({
    ironOre: 2,
    parts: [part(CRUSHER, 'crusher'), part(SMELTER, 'smelter'), part(FORGE, 'forge')],
    machines: [crusherState(), smelterState(), forgeState()],
    networks: [orderNetwork({ sourceIds: [], status: 'idle', reason: 'no-source', speedFactor: 0 })],
    ...overrides,
  });
}

/** 整条产线建好但飞轮未启动。 */
function factory(overrides: Partial<GoalObservation> = {}): GoalObservation {
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
function poweredFactory(overrides: Partial<GoalObservation> = {}): GoalObservation {
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
function evaluate(
  scene: GoalObservation,
  baseline: GoalObservation = observation(),
): { state: GoalState; snapshot: GoalSnapshot } {
  return evaluateGoal(createGoalState(baseline), scene);
}

function stepById(snapshot: GoalSnapshot, id: string) {
  return snapshot.steps.find((step) => step.id === id);
}

describe('M2.0-P1-A 第一份工业订单：八步状态机', () => {
  it('starts at gather-ore and exposes the eight-step order definition', () => {
    const { snapshot } = evaluate(observation());
    expect(snapshot.title).toBe('第一份工业订单');
    expect(snapshot.subtitle).toBe('制造你的第一根传动轴。');
    expect(snapshot.complete).toBe(false);
    expect(snapshot.currentStep.id).toBe('gather-ore');
    expect(snapshot.steps.map((step) => step.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(snapshot.steps.map((step) => step.id)).toEqual([
      'gather-ore',
      'build-machines',
      'connect-power',
      'start-power',
      'crush-ore',
      'smelt-ingot',
      'forge-shaft',
      'complete',
    ]);
    expect(snapshot.blocker?.code).toBe('missing-ore');
    expect(snapshot.currentStep.progress).toEqual({ current: 0, required: GOAL_REQUIREMENTS.ironOre });
    expect(GOAL_REQUIREMENTS).toEqual({ ironOre: 2, crushedOre: 2, ironIngot: 2, shaft: 1 });
  });

  it('latches ore gathering at two and moves on to building machines', () => {
    const { state, snapshot } = evaluate(observation({ ironOre: 2 }));
    expect(state.completed).toEqual(['gather-ore']);
    expect(snapshot.currentStep.id).toBe('build-machines');
    expect(stepById(snapshot, 'gather-ore')?.completed).toBe(true);
    expect(snapshot.blocker?.code).toBe('missing-machine');
    expect(snapshot.currentStep.progress).toEqual({ current: 0, required: 3 });
  });

  it('requires a crusher, a smelter and a forge before connecting power', () => {
    const partial = evaluate(
      observation({ ironOre: 2, parts: [part(CRUSHER, 'crusher'), part(SMELTER, 'smelter')] }),
    );
    expect(partial.snapshot.currentStep.id).toBe('build-machines');
    expect(partial.snapshot.blocker?.message).toContain('锻压机');
    expect(partial.snapshot.currentStep.progress).toEqual({ current: 2, required: 3 });

    const built = evaluate(builtMachines());
    expect(built.state.completed).toEqual(['gather-ore', 'build-machines']);
    expect(built.snapshot.currentStep.id).toBe('connect-power');
    expect(built.snapshot.blocker?.code).toBe('missing-power-source');
  });

  it('requires the three machines and the power source in one shared network', () => {
    const split = observation({
      ironOre: 2,
      parts: [
        part(FLYWHEEL, 'flywheel_source'),
        part(CRUSHER, 'crusher'),
        part(SMELTER, 'smelter'),
        part(FORGE, 'forge'),
      ],
      machines: [crusherState(), smelterState(), forgeState()],
      sources: [flywheel(false)],
      networks: [
        orderNetwork({ id: 0, sourceIds: [FLYWHEEL], machineIds: [CRUSHER], partIds: [FLYWHEEL, CRUSHER], status: 'idle', speedFactor: 0 }),
        orderNetwork({ id: 1, sourceIds: [], machineIds: [SMELTER, FORGE], partIds: [SMELTER, FORGE], status: 'idle', reason: 'no-source', speedFactor: 0 }),
      ],
    });
    const splitResult = evaluate(split);
    expect(splitResult.snapshot.currentStep.id).toBe('connect-power');
    expect(splitResult.snapshot.blocker?.code).toBe('no-connection');

    const connected = evaluate(factory());
    expect(connected.state.completed).toEqual(['gather-ore', 'build-machines', 'connect-power']);
    expect(connected.snapshot.currentStep.id).toBe('start-power');
    expect(connected.snapshot.blocker?.code).toBe('no-power');
  });

  it('treats unsupported (cyclic) networks as not connected', () => {
    const cyclic = evaluate(
      observation({
        ironOre: 2,
        parts: [
          part(FLYWHEEL, 'flywheel_source'),
          part(CRUSHER, 'crusher'),
          part(SMELTER, 'smelter'),
          part(FORGE, 'forge'),
        ],
        machines: [crusherState(), smelterState(), forgeState()],
        sources: [flywheel(true)],
        networks: [orderNetwork({ status: 'unsupported', reason: 'cyclic-network', speedFactor: 0 })],
      }),
    );
    expect(cyclic.snapshot.currentStep.id).toBe('connect-power');
    expect(cyclic.snapshot.blocker?.code).toBe('no-connection');
  });

  it('starts the network only when the flywheel is engaged and every machine is powered', () => {
    const notEngaged = evaluate(poweredFactory({ sources: [flywheel(false)] }));
    expect(notEngaged.snapshot.currentStep.id).toBe('start-power');
    expect(notEngaged.snapshot.blocker?.code).toBe('no-power');

    const partlyPowered = evaluate(
      poweredFactory({
        parts: [
          part(FLYWHEEL, 'flywheel_source', true),
          part(SHAFT, 'shaft', true),
          part(CRUSHER, 'crusher', true),
          part(SMELTER, 'smelter', true),
          part(FORGE, 'forge', false),
        ],
      }),
    );
    expect(partlyPowered.snapshot.currentStep.id).toBe('start-power');
    expect(partlyPowered.snapshot.blocker?.message).toContain('锻压机');

    const started = evaluate(poweredFactory());
    expect(started.state.completed).toEqual([
      'gather-ore',
      'build-machines',
      'connect-power',
      'start-power',
    ]);
    expect(started.snapshot.currentStep.id).toBe('crush-ore');
    expect(started.snapshot.focusPartId).toBe(CRUSHER);
  });

  it('does not latch power while the network is overloaded', () => {
    const { state, snapshot } = evaluate(
      poweredFactory({
        networks: [
          orderNetwork({
            status: 'stalled',
            reason: 'source-overload',
            speedFactor: 0,
            stalledPartIds: [CRUSHER, SMELTER, FORGE],
          }),
        ],
      }),
    );
    expect(state.completed).not.toContain('start-power');
    expect(snapshot.currentStep.id).toBe('start-power');
    expect(snapshot.blocker?.code).toBe('network-overload');
  });

  it('advances production steps strictly by order-start produced deltas', () => {
    const state = createGoalState(poweredFactory({ produced: producedOf(0, 0, 0) }));
    const at = (crushed: number, ingot: number, shaft: number) =>
      evaluateGoal(state, poweredFactory({ produced: producedOf(crushed, ingot, shaft) }));

    const one = at(1, 0, 0);
    expect(one.snapshot.currentStep.id).toBe('crush-ore');
    expect(one.snapshot.currentStep.progress).toEqual({ current: 1, required: 2 });

    const two = at(2, 0, 0);
    expect(two.snapshot.currentStep.id).toBe('smelt-ingot');
    expect(two.state.completed).toEqual([
      'gather-ore',
      'build-machines',
      'connect-power',
      'start-power',
      'crush-ore',
    ]);

    const ingots = at(2, 2, 0);
    expect(ingots.snapshot.currentStep.id).toBe('forge-shaft');
    expect(ingots.snapshot.currentStep.progress).toEqual({ current: 0, required: 1 });

    const finished = at(2, 2, 1);
    expect(finished.snapshot.complete).toBe(true);
    expect(finished.snapshot.currentStep.id).toBe('complete');
    expect(finished.snapshot.blocker).toBeNull();
    expect(finished.state.completed).toEqual(GOAL_STEPS.map((step) => step.id));
  });

  it('does not count production that happened before the order started', () => {
    const baseline = poweredFactory({ produced: producedOf(5, 5, 5) });
    const state = createGoalState(baseline);
    const now = evaluateGoal(state, baseline);
    expect(now.snapshot.currentStep.id).toBe('crush-ore');
    expect(now.snapshot.currentStep.progress).toEqual({ current: 0, required: 2 });

    const resumed = evaluateGoal(state, poweredFactory({ produced: producedOf(7, 5, 5) }));
    expect(resumed.snapshot.currentStep.id).toBe('smelt-ingot');
  });

  it('never infers completion from the 24 prototype shafts in the inventory', () => {
    const state = createGoalState(poweredFactory());
    // 观测里根本没有「传动轴库存」这个输入：24 根开局轴无法参与判定。
    const stockOnly = evaluateGoal(state, poweredFactory({ produced: producedOf(2, 2, 0) })).snapshot;
    expect(stockOnly.currentStep.id).toBe('forge-shaft');
    expect(stockOnly.complete).toBe(false);
    // 只有锻压机真的产出 1 根（produced 增量）才完成。
    const forged = evaluateGoal(state, poweredFactory({ produced: producedOf(2, 2, 1) })).snapshot;
    expect(forged.complete).toBe(true);
  });

  it('does not skip ahead when later production already happened', () => {
    const state = createGoalState(observation());
    const notBuilt = evaluateGoal(
      state,
      observation({ ironOre: 5, produced: producedOf(2, 2, 1) }),
    );
    expect(notBuilt.state.completed).toEqual(['gather-ore']);
    expect(notBuilt.snapshot.currentStep.id).toBe('build-machines');
    expect(stepById(notBuilt.snapshot, 'forge-shaft')?.completed).toBe(false);

    const finished = evaluateGoal(notBuilt.state, poweredFactory({ produced: producedOf(2, 2, 1) }));
    expect(finished.state.completed).toEqual(GOAL_STEPS.map((step) => step.id));
    expect(finished.snapshot.complete).toBe(true);
  });

  it('keeps latched steps when power is lost (no rollback)', () => {
    const state = createGoalState(poweredFactory());
    const before = evaluateGoal(state, poweredFactory({ produced: producedOf(2, 0, 0) }));
    expect(before.snapshot.currentStep.id).toBe('smelt-ingot');

    const dark = evaluateGoal(
      before.state,
      factory({
        produced: producedOf(2, 0, 0),
        machines: [crusherState('no-power'), smelterState('no-power'), forgeState()],
      }),
    );
    expect(dark.snapshot.currentStep.id).toBe('smelt-ingot');
    expect(dark.snapshot.blocker?.code).toBe('no-power');
    expect(dark.state.completed).toEqual(before.state.completed);
  });

  it('freezes progress without power and resumes from the same delta', () => {
    const state = createGoalState(poweredFactory());
    const one = evaluateGoal(state, poweredFactory({ produced: producedOf(1, 0, 0) }));
    expect(one.snapshot.currentStep.progress).toEqual({ current: 1, required: 2 });

    const dark = evaluateGoal(
      one.state,
      factory({
        produced: producedOf(1, 0, 0),
        machines: [crusherState('no-power'), smelterState(), forgeState()],
      }),
    );
    expect(dark.snapshot.currentStep.id).toBe('crush-ore');
    expect(dark.snapshot.currentStep.progress).toEqual({ current: 1, required: 2 });
    expect(dark.snapshot.blocker?.code).toBe('no-power');

    const resumed = evaluateGoal(dark.state, poweredFactory({ produced: producedOf(2, 0, 0) }));
    expect(resumed.snapshot.currentStep.id).toBe('smelt-ingot');
  });

  it('reports output-full so the player takes the finished goods out', () => {
    const state = createGoalState(poweredFactory());
    const { snapshot } = evaluateGoal(
      state,
      poweredFactory({
        machines: [
          crusherState('output-full', { outputItem: 'crushed_ore', outputCount: 4 }),
          smelterState(),
          forgeState(),
        ],
      }),
    );
    expect(snapshot.currentStep.id).toBe('crush-ore');
    expect(snapshot.blocker?.code).toBe('output-full');
    expect(snapshot.blocker?.message).toContain('取出成品');
  });

  it('reports no-input when the machine lacks material', () => {
    const state = createGoalState(poweredFactory());
    const { snapshot } = evaluateGoal(
      state,
      poweredFactory({ machines: [crusherState('no-input'), smelterState(), forgeState()] }),
    );
    expect(snapshot.currentStep.id).toBe('crush-ore');
    expect(snapshot.blocker?.code).toBe('no-input');
    expect(snapshot.blocker?.message).toContain('铁矿石');
  });

  it('reports network-overload when the production network is stalled', () => {
    const state = createGoalState(poweredFactory());
    const started = evaluateGoal(state, poweredFactory({ produced: producedOf(0, 0, 0) }));
    const { snapshot } = evaluateGoal(
      started.state,
      poweredFactory({
        produced: producedOf(0, 0, 0),
        networks: [orderNetwork({ status: 'stalled', reason: 'branch-overload', speedFactor: 0 })],
        machines: [crusherState('no-power'), smelterState('no-power'), forgeState('no-power')],
      }),
    );
    expect(snapshot.currentStep.id).toBe('crush-ore');
    expect(snapshot.blocker?.code).toBe('network-overload');
  });

  it('reports wrong-recipe when the forge is set to another recipe', () => {
    const state = createGoalState(poweredFactory());
    const { snapshot } = evaluateGoal(
      state,
      poweredFactory({
        produced: producedOf(2, 2, 0),
        machines: [crusherState(), smelterState(), forgeState('forge-vertical-drive')],
      }),
    );
    expect(snapshot.currentStep.id).toBe('forge-shaft');
    expect(snapshot.blocker?.code).toBe('wrong-recipe');
    expect(snapshot.blocker?.message).toContain('锻压传动轴');
  });

  it('asks to rebuild a dismantled machine without faking completion', () => {
    const builtOnly = evaluate(builtMachines());
    expect(builtOnly.snapshot.currentStep.id).toBe('connect-power');
    const dismantled = evaluateGoal(builtOnly.state, observation({ ironOre: 2 }));
    expect(dismantled.snapshot.currentStep.id).toBe('connect-power');
    expect(dismantled.snapshot.blocker?.code).toBe('missing-machine');
    expect(dismantled.snapshot.complete).toBe(false);

    const state = createGoalState(poweredFactory());
    const ready = evaluateGoal(state, poweredFactory({ produced: producedOf(2, 2, 0) }));
    expect(ready.snapshot.currentStep.id).toBe('forge-shaft');
    const noForge = evaluateGoal(
      ready.state,
      poweredFactory({
        produced: producedOf(2, 2, 0),
        parts: [
          part(FLYWHEEL, 'flywheel_source', true),
          part(SHAFT, 'shaft', true),
          part(CRUSHER, 'crusher', true),
          part(SMELTER, 'smelter', true),
        ],
        machines: [crusherState(), smelterState()],
        networks: [orderNetwork({ machineIds: [CRUSHER, SMELTER], partIds: [FLYWHEEL, SHAFT, CRUSHER, SMELTER] })],
      }),
    );
    expect(noForge.snapshot.currentStep.id).toBe('forge-shaft');
    expect(noForge.snapshot.blocker?.code).toBe('missing-machine');
    expect(noForge.snapshot.blocker?.message).toContain('锻压机');
    expect(noForge.snapshot.complete).toBe(false);
  });

  it('completes once and never re-triggers', () => {
    const state = createGoalState(poweredFactory());
    const done = evaluateGoal(state, poweredFactory({ produced: producedOf(2, 2, 1) }));
    expect(done.snapshot.complete).toBe(true);
    expect(done.snapshot.currentStep.id).toBe('complete');
    expect(done.snapshot.blocker).toBeNull();
    expect(done.snapshot.focusPartId).toBeNull();

    const after = evaluateGoal(
      done.state,
      poweredFactory({ ironOre: 0, produced: producedOf(9, 9, 9), parts: [], machines: [], sources: [], networks: [] }),
    );
    expect(after.snapshot.complete).toBe(true);
    expect(after.snapshot.steps.every((step) => step.completed)).toBe(true);
    expect(after.snapshot.currentStep.id).toBe('complete');
    expect(after.state.completed).toEqual(done.state.completed);
  });

  it('evaluates purely without mutating the input state', () => {
    const state = createGoalState(observation());
    const before = JSON.stringify(state);
    evaluateGoal(state, poweredFactory({ produced: producedOf(2, 2, 1) }));
    expect(JSON.stringify(state)).toBe(before);
    expect(state.completed).toEqual([]);
  });

  it('produces a JSON-serializable snapshot for the HUD', () => {
    const { snapshot } = evaluate(poweredFactory({ produced: producedOf(1, 0, 0) }));
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('points the HUD at the relevant part of the current step', () => {
    expect(evaluate(factory()).snapshot.focusPartId).toBe(FLYWHEEL);
    expect(evaluate(poweredFactory()).snapshot.focusPartId).toBe(CRUSHER);
  });

});
