import { describe, expect, it } from 'vitest';
import { evaluateGoal, type GoalState } from '../goal/goal.ts';
import {
  CRUSHER,
  FORGE,
  FLYWHEEL,
  SHAFT,
  SMELTER,
  crusherState,
  factory,
  flywheel,
  forgeState,
  observation,
  orderNetwork,
  part,
  poweredFactory,
  smelterState,
} from './goal-fixtures.ts';

/**
 * M2.0-P1-D 缺陷回归测试（由定向代码检查 + 真实 playthrough 发现）：
 * 1) 已完成步骤的显示进度必须满值（HUD 不能出现「✓ 0 / 2」）；
 * 2) 闭环/多源网络要给出具体原因，而不是通用的「动力连接尚未完成」；
 * 3) 局部支路过载不能被误报成 no-power（检查接线/离合）；
 * 4) 储能耗尽的文案不能引导玩家把已经挂上的离合按掉。
 */

const EMPTY_BASELINE = { crushedOre: 0, ironIngot: 0, shaft: 0 } as const;

function latched(completed: GoalState['completed']): GoalState {
  return { baseline: EMPTY_BASELINE, completed };
}

describe('M2.0-P1-D 缺陷回归：已完成步骤的显示进度', () => {
  it('shows full progress for a completed gather step after the ore is consumed', () => {
    // 采集步已锁存，但背包里的铁矿石已经投进机器（当前库存 0）。
    const { snapshot } = evaluateGoal(
      latched(['gather-ore']),
      observation({ ironOre: 0, parts: [part(CRUSHER, 'crusher')] }),
    );
    const gather = snapshot.steps.find((step) => step.id === 'gather-ore');
    expect(gather?.completed).toBe(true);
    expect(gather?.progress).toEqual({ current: 2, required: 2 });
  });

  it('shows full progress for a completed build step after one machine is dismantled', () => {
    // 建机器步已锁存，但锻压机被拆掉（当前只剩两种机器）。
    const { snapshot } = evaluateGoal(
      latched(['gather-ore', 'build-machines']),
      observation({
        ironOre: 0,
        parts: [part(CRUSHER, 'crusher'), part(SMELTER, 'smelter')],
        machines: [crusherState(), smelterState()],
      }),
    );
    const build = snapshot.steps.find((step) => step.id === 'build-machines');
    expect(build?.completed).toBe(true);
    expect(build?.progress).toEqual({ current: 3, required: 3 });
    // 当前步骤仍正确指向缺失的机器（完成态只是显示口径变化，不伪造完成）。
    expect(snapshot.currentStep.id).toBe('connect-power');
  });
});

describe('M2.0-P1-D 缺陷回归：闭环 / 多源网络的阻塞文案', () => {
  const allMachines = [part(FLYWHEEL, 'flywheel_source'), part(CRUSHER, 'crusher'), part(SMELTER, 'smelter'), part(FORGE, 'forge')];

  it('explains a cyclic power network instead of asking the player to connect again', () => {
    const { snapshot } = evaluateGoal(
      latched(['gather-ore', 'build-machines']),
      factory({
        parts: allMachines,
        machines: [crusherState(), smelterState(), forgeState()],
        networks: [orderNetwork({ status: 'unsupported', reason: 'cyclic-network', speedFactor: 0 })],
      }),
    );
    expect(snapshot.currentStep.id).toBe('connect-power');
    expect(snapshot.blocker?.code).toBe('no-connection');
    expect(snapshot.blocker?.message).toContain('闭环');
    expect(snapshot.blocker?.message).not.toContain('接进同一套传动网络');
  });

  it('explains a multiple-source network', () => {
    const { snapshot } = evaluateGoal(
      latched(['gather-ore', 'build-machines']),
      factory({
        parts: allMachines,
        machines: [crusherState(), smelterState(), forgeState()],
        networks: [orderNetwork({ status: 'unsupported', reason: 'multiple-sources', speedFactor: 0 })],
      }),
    );
    expect(snapshot.currentStep.id).toBe('connect-power');
    expect(snapshot.blocker?.message).toContain('只能接一个动力源');
  });
});

describe('M2.0-P1-D 缺陷回归：局部支路过载', () => {
  const stalledCrusher = { ...part(CRUSHER, 'crusher'), powered: false, stalled: true };

  it('reports network-overload at start-power when the order machines are stopped by a branch overload', () => {
    const { snapshot } = evaluateGoal(
      latched(['gather-ore', 'build-machines', 'connect-power']),
      factory({
        parts: [part(FLYWHEEL, 'flywheel_source', true), stalledCrusher, part(SMELTER, 'smelter', true), part(FORGE, 'forge', true)],
        machines: [crusherState('no-power'), smelterState(), forgeState()],
        sources: [flywheel(true)],
        // 整网仍是 powered（还有别的支路在转），但订单机器被支路过载停转。
        networks: [orderNetwork({ status: 'powered', reason: null, stalledPartIds: [CRUSHER], speedFactor: 0.86 })],
      }),
    );
    expect(snapshot.currentStep.id).toBe('start-power');
    expect(snapshot.blocker?.code).toBe('network-overload');
    expect(snapshot.blocker?.message).toContain('支路过载');
  });

  it('reports network-overload during production instead of a misleading no-power hint', () => {
    const { snapshot } = evaluateGoal(
      latched(['gather-ore', 'build-machines', 'connect-power', 'start-power']),
      poweredFactory({
        parts: [part(FLYWHEEL, 'flywheel_source', true), stalledCrusher, part(SMELTER, 'smelter', true), part(FORGE, 'forge', true)],
        machines: [crusherState('no-power'), smelterState(), forgeState()],
        networks: [orderNetwork({ status: 'powered', reason: null, stalledPartIds: [CRUSHER], speedFactor: 0.86 })],
      }),
    );
    expect(snapshot.currentStep.id).toBe('crush-ore');
    expect(snapshot.blocker?.code).toBe('network-overload');
    expect(snapshot.blocker?.message).toContain('支路过载');
  });
});

describe('M2.0-P1-D 缺陷回归：储能耗尽时的恢复文案', () => {
  it('does not tell the player to toggle a clutch that may already be engaged', () => {
    // 离合已挂但储能耗尽：engaged=false。旧文案「再右键接合离合」会把已挂的离合按掉。
    const { snapshot } = evaluateGoal(
      latched(['gather-ore', 'build-machines', 'connect-power']),
      factory({
        parts: [part(FLYWHEEL, 'flywheel_source'), part(SHAFT, 'shaft'), part(CRUSHER, 'crusher'), part(SMELTER, 'smelter'), part(FORGE, 'forge')],
        machines: [crusherState('no-power'), smelterState('no-power'), forgeState('no-power')],
        sources: [{ partId: FLYWHEEL, engaged: false, energy: 0, energyCapacity: 300 }],
        networks: [orderNetwork({ status: 'idle', speedFactor: 0 })],
      }),
    );
    expect(snapshot.currentStep.id).toBe('start-power');
    expect(snapshot.blocker?.code).toBe('no-power');
    expect(snapshot.blocker?.message).toContain('摇柄补能');
    // 右键建议必须挂在「离合未挂上」这个条件之后，不能像旧文案那样无条件让玩家按掉已挂离合。
    expect(snapshot.blocker?.message).toContain('若离合未挂上，再右键接合离合');
    expect(snapshot.blocker?.message.indexOf('摇柄补能')).toBeLessThan(snapshot.blocker?.message.indexOf('右键') ?? -1);
  });
});
