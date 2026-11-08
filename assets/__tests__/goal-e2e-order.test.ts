import { describe, expect, it } from 'vitest';
import {
  CRUSHER_ID,
  FORGE_ID,
  GoalRig,
  POWERED_LINE,
  SMELTER_ID,
  engageFlywheel,
  expectGoalViewMatches,
  feedFromInventory,
  producedCount,
  producedSummary,
  reachForgeStage,
  runUntil,
  startOrder,
  takeIntoInventory,
  tick,
} from './goal-e2e-fixtures.ts';

/**
 * M2.0-P1-D 场景 1 / 9：真实运行时下的八步订单完整闭环。
 *
 * 证据链全部来自真实系统：飞轮真实储能与离合、真实动力解算、真实投料/加工/缓冲，
 * 订单判定只读 production.produced 相对订单开始基线的增量（绝不用库存或 HUD 显示值）。
 */

describe('M2.0-P1-D 场景 1：正常机械网络与完整生产闭环', () => {
  it('drives the eight-step order to complete with real power, feeding and production', () => {
    const rig = new GoalRig(POWERED_LINE);
    rig.inventory.add('iron_ore', 2);
    engageFlywheel(rig);
    const { progress, snapshot: first } = startOrder(rig);

    // 第 1~4 步：真实库存矿石 + 三机齐 + 同网 + 飞轮真实储能且离合挂上 → 一次锁存。
    expect(first.currentStep.id).toBe('crush-ore');
    expect(progress.state().completed).toEqual([
      'gather-ore',
      'build-machines',
      'connect-power',
      'start-power',
    ]);
    expect(progress.state().baseline).toEqual({ crushedOre: 0, ironIngot: 0, shaft: 0 });
    expect(first.blocker?.code).toBe('no-input');
    expect(first.steps.find((step) => step.id === 'crush-ore')?.progress).toEqual({ current: 0, required: 2 });
    expect(first.complete).toBe(false);
    expectGoalViewMatches(first);

    // 第 5 步：真实投料（等价悬停按 C），破碎机真实产出 2 个碎铁矿。
    expect(feedFromInventory(rig, CRUSHER_ID, 2)).toBe(2);
    let snapshot = tick(rig, progress);
    expect(snapshot.blocker).toBeNull();
    snapshot = runUntil(rig, progress, () => producedCount(rig, 'crushed_ore') >= 2);
    expect(producedCount(rig, 'crushed_ore')).toBe(2);
    expect(snapshot.currentStep.id).toBe('smelt-ingot');
    expect(progress.state().completed).toContain('crush-ore');
    expect(snapshot.steps.find((step) => step.id === 'crush-ore')?.progress).toEqual({ current: 2, required: 2 });
    expectGoalViewMatches(snapshot);

    // 第 6 步：取出碎铁矿并真实投入熔炼炉，熔炼 2 个铁锭。
    expect(takeIntoInventory(rig, CRUSHER_ID)?.count).toBe(2);
    expect(rig.inventory.count('crushed_ore')).toBe(2);
    expect(feedFromInventory(rig, SMELTER_ID, 2)).toBe(2);
    snapshot = runUntil(rig, progress, () => producedCount(rig, 'iron_ingot') >= 2);
    expect(producedCount(rig, 'iron_ingot')).toBe(2);
    expect(snapshot.currentStep.id).toBe('forge-shaft');
    expect(progress.state().completed).toContain('smelt-ingot');
    expect(snapshot.steps.find((step) => step.id === 'smelt-ingot')?.progress).toEqual({ current: 2, required: 2 });
    expectGoalViewMatches(snapshot);

    // 第 7~8 步：铁锭投入锻压机，真实锻出 1 根传动轴 → 前七步锁存即完成。
    expect(takeIntoInventory(rig, SMELTER_ID)?.count).toBe(2);
    expect(rig.inventory.count('iron_ingot')).toBe(2);
    expect(feedFromInventory(rig, FORGE_ID, 2)).toBe(2);
    snapshot = runUntil(rig, progress, () => producedCount(rig, 'shaft') >= 1);

    expect(producedCount(rig, 'shaft')).toBe(1);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.steps.every((step) => step.completed)).toBe(true);
    expect(snapshot.blocker).toBeNull();
    expect(snapshot.currentStep.id).toBe('complete');
    expect(snapshot.steps.find((step) => step.id === 'forge-shaft')?.progress).toEqual({ current: 1, required: 1 });
    expect(progress.state().completed).toHaveLength(8);
    // 订单证据是真实累计产出（相对基线的增量），不是库存/显示值。
    expect(producedSummary(rig)).toEqual({ crushed_ore: 2, iron_ingot: 2, shaft: 1 });
    expectGoalViewMatches(snapshot);
  });
});

describe('M2.0-P1-D 场景 9：开局已有 24 根轴时的误判防护', () => {
  it('never treats the 24 prototype shafts as forged evidence; only real produced shaft completes the order', () => {
    const rig = new GoalRig(POWERED_LINE);
    rig.inventory.add('iron_ore', 2);
    rig.inventory.add('shaft', 24);
    engageFlywheel(rig);
    const { progress, snapshot: first } = startOrder(rig);

    expect(rig.inventory.count('shaft')).toBe(24);
    expect(first.currentStep.id).toBe('crush-ore');
    expect(first.complete).toBe(false);
    const forgeAtStart = first.steps.find((step) => step.id === 'forge-shaft');
    expect(forgeAtStart?.completed).toBe(false);
    expect(forgeAtStart?.progress).toEqual({ current: 0, required: 1 });
    expectGoalViewMatches(first);

    // 真实破碎 + 真实熔炼后停在锻压步：库存 24 根轴仍然不算任何证据。
    reachForgeStage(rig, progress);
    let snapshot = progress.snapshot();
    expect(snapshot.currentStep.id).toBe('forge-shaft');
    expect(rig.inventory.count('shaft')).toBe(24);
    expect(snapshot.steps.find((step) => step.id === 'forge-shaft')?.completed).toBe(false);
    expect(snapshot.steps.find((step) => step.id === 'forge-shaft')?.progress).toEqual({ current: 0, required: 1 });
    expect(snapshot.complete).toBe(false);
    expectGoalViewMatches(snapshot);

    expect(feedFromInventory(rig, FORGE_ID, 2)).toBe(2);
    snapshot = runUntil(rig, progress, () => producedCount(rig, 'shaft') >= 1);
    expect(snapshot.complete).toBe(true);
    expect(producedCount(rig, 'shaft')).toBe(1);
    // 真实锻出的那根还在机器输出缓冲里，库存数量没有被改写。
    expect(rig.inventory.count('shaft')).toBe(24);
    expectGoalViewMatches(snapshot);
  });
});
