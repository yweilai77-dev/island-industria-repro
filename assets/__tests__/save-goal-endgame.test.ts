import { describe, expect, it } from 'vitest';
import { restoreGoalState } from '../goal/goal.ts';
import { createGoalProgress } from '../goal/goal-service.ts';
import { decodeSnapshot, emptySnapshot, encodeSnapshot } from '../save/save-codec.ts';

/**
 * 订单恢复（goal-service restoreState）+ 终局切片（endgame serialize/restore 接入快照 v1）。
 * 纯逻辑，不启动引擎。
 */

describe('goal restoreState（纯函数）', () => {
  it('baseline + completed 前缀往返相等', () => {
    const raw = {
      baseline: { crushedOre: 2, ironIngot: 1, shaft: 0 },
      completed: ['gather-ore', 'build-machines', 'connect-power'],
    };
    const restored = restoreGoalState(JSON.parse(JSON.stringify(raw)));
    expect(restored.repaired).toBe(false);
    expect(restored.state).toEqual(raw);
  });

  it('未知/乱序步骤丢弃，只保留 GOAL_STEPS 前缀', () => {
    const restored = restoreGoalState({
      baseline: {},
      completed: ['crush-ore', 'gather-ore', 'bogus-step', 'complete'],
    });
    expect(restored.state.completed).toEqual(['gather-ore']);
    expect(restored.repaired).toBe(true);
    expect(restored.issues.join(' ')).toMatch(/unknown goal step|not a prefix/);
  });

  it('baseline 非法值钳制/归零，缺字段补 0', () => {
    const restored = restoreGoalState({
      baseline: { crushedOre: -3, ironIngot: 1.9, shaft: 'x' },
      completed: [],
    });
    expect(restored.state.baseline).toEqual({ crushedOre: 0, ironIngot: 1, shaft: 0 });
    expect(restored.repaired).toBe(true);
  });

  it('非对象/空数据安全降级，且恢复幂等', () => {
    const empty = restoreGoalState(undefined);
    expect(empty.state).toEqual({ baseline: { crushedOre: 0, ironIngot: 0, shaft: 0 }, completed: [] });
    const broken = restoreGoalState('not-an-object');
    expect(broken.repaired).toBe(true);
    const once = restoreGoalState({ baseline: { crushedOre: 4, ironIngot: 0, shaft: 0 }, completed: ['gather-ore'] });
    const twice = restoreGoalState(once.state);
    expect(twice.state).toEqual(once.state);
  });
});

describe('goalProgress restoreState（服务层）', () => {
  const source = {
    parts: [],
    mechanical: { revision: 0, sources: [], networks: [], parts: [], machines: [] },
    production: { machines: [], chutes: [], produced: [] },
    inventory: { count: () => 0 },
  };

  it('恢复后首帧不再重置订单基线', () => {
    const reader = createGoalProgress();
    // 先正常跑一帧，模拟「订单已开始」。
    reader.update(source as never);
    const restored = reader.restoreState({
      baseline: { crushedOre: 5, ironIngot: 2, shaft: 1 },
      completed: ['gather-ore'],
    });
    expect(restored.issues).toEqual([]);
    expect(reader.state()).toEqual({
      baseline: { crushedOre: 5, ironIngot: 2, shaft: 1 },
      completed: ['gather-ore'],
    });
    // 后续 update 不能把基线重置为当前观测（全 0）。
    reader.update(source as never);
    expect(reader.state().baseline).toEqual({ crushedOre: 5, ironIngot: 2, shaft: 1 });
    expect(reader.state().completed).toEqual(['gather-ore']);
  });

  it('日志/追踪不因恢复而回退已完成步骤', () => {
    const reader = createGoalProgress();
    reader.restoreState({ baseline: {}, completed: ['gather-ore', 'build-machines'] });
    const snapshot = reader.update(source as never);
    expect(snapshot.steps.find((step) => step.id === 'gather-ore')?.completed).toBe(true);
    expect(snapshot.steps.find((step) => step.id === 'build-machines')?.completed).toBe(true);
  });
});

describe('endgame 切片接入快照 v1', () => {
  const endgameState = {
    version: 1,
    state: 'running',
    startedAt: 10,
    elapsedSeconds: 12.5,
    produced: 4,
    baseline: { '5': 8 },
    passed: false,
    failureReason: null,
    lastConclusion: null,
  };

  it('snapshot<->JSON 往返保留终局窗口状态', () => {
    const saved = { ...emptySnapshot(), endgame: endgameState };
    const decoded = decodeSnapshot(encodeSnapshot(saved));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.snapshot.endgame).toEqual(endgameState);
  });

  it('终局切片损坏时丢弃并记录 issue，不影响其它切片', () => {
    const saved = { ...emptySnapshot(), endgame: { state: 'running' } };
    const decoded = decodeSnapshot(encodeSnapshot(saved as never));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.snapshot.endgame).toBeUndefined();
    expect(decoded.repaired).toBe(true);
    expect(decoded.issues.join(' ')).toMatch(/endgame/);
  });
});
