import { describe, expect, it } from 'vitest';
import {
  GOAL_REQUIREMENTS,
  GOAL_STEPS,
  createGoalState,
  evaluateGoal,
} from '../goal/goal.ts';
import {
  CRUSHER,
  FLYWHEEL,
  FORGE,
  SHAFT,
  SMELTER,
  builtMachines,
  crusherState,
  evaluate,
  factory,
  flywheel,
  forgeState,
  observation,
  orderNetwork,
  part,
  poweredFactory,
  producedOf,
  smelterState,
  stepById,
} from './goal-fixtures.ts';

// M2.0-P1-A 单元测试（一）：八步订单定义、顺序锁存、动力启动与真实生产推进。
// 与 goal-blockers.test.ts 共同保持拆分前的完整覆盖；夹具见 goal-fixtures.ts。

describe('M2.0-P1-A 第一份工业订单：八步进度', () => {
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
