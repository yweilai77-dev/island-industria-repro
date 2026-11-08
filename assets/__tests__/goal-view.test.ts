import { describe, expect, it } from 'vitest';
import { GOAL_STEPS } from '../goal/goal.ts';
import {
  buildGoalView,
  goalViewSignature,
  parseGoalView,
  type UiGoalState,
} from '../game-ui-bridge/goal-view.ts';
import {
  evaluate,
  factory,
  observation,
  poweredFactory,
  producedOf,
} from './goal-fixtures.ts';

// M2.0-P1-C 共享视图模型测试：GoalSnapshot → UiGoalState → 前端解析/签名。
// 数据全部来自 A 阶段已验收的纯逻辑状态机，不模拟第二套目标判定。

const INITIAL = evaluate(observation());
const PARTIAL = evaluate(poweredFactory({ produced: producedOf(2, 1, 0) }));
const COMPLETE = evaluate(poweredFactory({ produced: producedOf(2, 2, 1) }));

function viewOf(result: { snapshot: Parameters<typeof buildGoalView>[0] }): UiGoalState {
  const view = buildGoalView(result.snapshot);
  if (view === null) throw new Error('expected a goal view');
  return view;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('goal view model', () => {
  it('maps the initial eight-step order without redefining the chain', () => {
    const view = viewOf(INITIAL);
    expect(view.title).toBe('第一份工业订单');
    expect(view.subtitle).toBe('制造你的第一根传动轴。');
    expect(view.complete).toBe(false);
    expect(view.completedCount).toBe(0);
    expect(view.totalCount).toBe(8);
    expect(view.currentStepId).toBe('gather-ore');
    expect(view.currentStep?.title).toBe('采集铁矿石');
    expect(view.steps.map((step) => step.id)).toEqual(GOAL_STEPS.map((step) => step.id));
    expect(view.steps.map((step) => step.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(view.steps.filter((step) => step.current)).toHaveLength(1);
    expect(view.currentStep?.progress).toEqual({ current: 0, required: 2 });
    expect(view.blocker?.code).toBe('missing-ore');
    expect(view.blocker?.message).toBe(INITIAL.snapshot.blocker?.message);
  });

  it('reports completed steps and the real order delta on the current step', () => {
    const view = viewOf(PARTIAL);
    expect(view.completedCount).toBe(5);
    expect(view.steps.slice(0, 5).every((step) => step.completed)).toBe(true);
    expect(view.steps[5]?.completed).toBe(false);
    expect(view.currentStepId).toBe('smelt-ingot');
    expect(view.currentStep?.progress).toEqual({ current: 1, required: 2 });
    // 已完成的生产步骤保留订单差值，不显示生命周期累计值。
    expect(view.steps[4]?.progress).toEqual({ current: 2, required: 2 });
  });

  it('shows a completed order with 8 / 8 and no remaining target', () => {
    const view = viewOf(COMPLETE);
    expect(view.complete).toBe(true);
    expect(view.completedCount).toBe(8);
    expect(view.totalCount).toBe(8);
    expect(view.currentStepId).toBeNull();
    expect(view.currentStep).toBeNull();
    expect(view.blocker).toBeNull();
    expect(view.steps.every((step) => step.completed)).toBe(true);
  });

  it('passes blocker text through unchanged (no frontend rephrasing)', () => {
    const noPower = evaluate(factory());
    const view = viewOf(noPower);
    expect(view.currentStepId).toBe('start-power');
    expect(view.blocker?.code).toBe('no-power');
    expect(view.blocker?.message).toBe(noPower.snapshot.blocker?.message);
  });

  it('does not mutate the goal snapshot while building the view', () => {
    const snapshot = clone(COMPLETE.snapshot);
    const before = JSON.stringify(snapshot);
    const view = buildGoalView(snapshot);
    expect(view).not.toBeNull();
    expect(JSON.stringify(snapshot)).toBe(before);
    // 视图是独立数据，修改视图不影响快照。
    const mutable = view as unknown as { steps: { completed: boolean }[] };
    mutable.steps[0]!.completed = false;
    expect(snapshot.steps[0]?.completed).toBe(true);
  });
});

describe('goal view signature', () => {
  it('is stable for identical views and changes with progress or blockers', () => {
    const view = viewOf(INITIAL);
    expect(goalViewSignature(view)).toBe(goalViewSignature(viewOf(INITIAL)));
    expect(goalViewSignature(viewOf(PARTIAL))).not.toBe(goalViewSignature(view));
    expect(goalViewSignature(viewOf(COMPLETE))).not.toBe(goalViewSignature(viewOf(PARTIAL)));
    expect(goalViewSignature(null)).toBe('goal:none');

    const progressed = viewOf(evaluate(poweredFactory({ produced: producedOf(1, 0, 0) })));
    const before = viewOf(evaluate(poweredFactory({ produced: producedOf(0, 0, 0) })));
    expect(goalViewSignature(progressed)).not.toBe(goalViewSignature(before));
  });
});

describe('goal view parsing (frontend boundary)', () => {
  it('round-trips a valid view through JSON', () => {
    const view = viewOf(PARTIAL);
    const parsed = parseGoalView(JSON.parse(JSON.stringify(view)));
    expect(parsed).toEqual(view);
  });

  it('recomputes counts from the step list instead of trusting message totals', () => {
    const raw = { ...viewOf(PARTIAL), completedCount: 99, totalCount: 3 };
    const parsed = parseGoalView(JSON.parse(JSON.stringify(raw)));
    expect(parsed?.completedCount).toBe(5);
    expect(parsed?.totalCount).toBe(8);
  });

  it('rejects malformed payloads and falls back to the initialization state', () => {
    expect(parseGoalView(null)).toBeNull();
    expect(parseGoalView('goal')).toBeNull();
    expect(parseGoalView({})).toBeNull();
    expect(parseGoalView({ title: 'x', subtitle: 'y', complete: false, steps: [] })).toBeNull();
    expect(parseGoalView({ title: 'x', subtitle: 'y', complete: false, steps: 'nope' })).toBeNull();
    const view = viewOf(INITIAL);
    const brokenStep = clone(view) as unknown as Record<string, unknown>;
    (brokenStep.steps as Record<string, unknown>[])[0]!.index = -1;
    expect(parseGoalView(brokenStep)).toBeNull();
    (brokenStep.steps as Record<string, unknown>[])[0]!.index = 1;
    (brokenStep.blocker as Record<string, unknown>).code = 3;
    expect(parseGoalView(brokenStep)).toBeNull();
  });

  it('normalizes progress numbers to non-negative integers', () => {
    const raw = clone(viewOf(PARTIAL)) as unknown as { steps: { progress: Record<string, unknown> }[] };
    raw.steps[4]!.progress = { current: 2.9, required: 2.1 };
    const parsed = parseGoalView(raw);
    expect(parsed?.steps[4]?.progress).toEqual({ current: 2, required: 2 });
  });
});
