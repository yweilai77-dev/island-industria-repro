import { describe, expect, it } from 'vitest';
import { createGoalState, evaluateGoal } from '../goal/goal.ts';
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
  forgeState,
  observation,
  orderNetwork,
  part,
  poweredFactory,
  producedOf,
  smelterState,
} from './goal-fixtures.ts';

// M2.0-P1-A 单元测试（二）：latch 不回退、断电冻结/恢复、真实阻塞原因与拆机重建提示。
// 与 goal.test.ts 共同保持拆分前的完整覆盖；夹具见 goal-fixtures.ts。

describe('M2.0-P1-A 第一份工业订单：阻塞与恢复', () => {
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
});
