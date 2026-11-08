import { describe, expect, it } from 'vitest';
import { MACHINE_RECIPES } from '../production/recipes.ts';
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
  runRuntimeUntil,
  runUntil,
  startOrder,
  takeIntoInventory,
  tick,
} from './goal-e2e-fixtures.ts';

/**
 * M2.0-P1-D 场景 5~8：生产链层面的订单阻塞与恢复。
 * 阻塞原因来自真实 ProductionRuntime 的机器状态，恢复后订单只按真实 produced 增量推进。
 */

describe('M2.0-P1-D 场景 5：生产链堵塞', () => {
  it('reports output-full on a really full machine buffer and recovers after taking output', () => {
    const rig = new GoalRig(POWERED_LINE);
    rig.inventory.add('iron_ore', 10);
    engageFlywheel(rig);

    // 订单开始前先真实生产 4 个碎铁矿并留在输出缓冲（订单基线会扣掉这段历史产量）。
    expect(feedFromInventory(rig, CRUSHER_ID, 4)).toBe(4);
    runRuntimeUntil(rig, () => producedCount(rig, 'crushed_ore') >= 4);
    expect(producedCount(rig, 'crushed_ore')).toBe(4);
    expect(rig.production.snapshot().machines.find((machine) => machine.partId === CRUSHER_ID)?.outputCount).toBe(4);
    // 再真实投入 4 个铁矿：机器有料、输出满 → 真实 tickMachine 报 output-full。
    expect(feedFromInventory(rig, CRUSHER_ID, 4)).toBe(4);
    expect(rig.inventory.count('iron_ore')).toBe(2);

    const { progress, snapshot: blocked } = startOrder(rig);
    expect(progress.state().baseline.crushedOre).toBe(4);
    expect(blocked.currentStep.id).toBe('crush-ore');
    expect(blocked.blocker?.code).toBe('output-full');
    expect(blocked.blocker?.message).toContain('输出缓冲已满');
    expect(blocked.steps.find((step) => step.id === 'crush-ore')?.progress).toEqual({ current: 0, required: 2 });
    expect(blocked.complete).toBe(false);
    expect(rig.production.snapshot().machines.find((machine) => machine.partId === CRUSHER_ID)?.block).toBe('output-full');
    expectGoalViewMatches(blocked);

    // 真实取走成品后：阻塞消失，机器重新开工，再产 2 个才满足订单增量。
    expect(takeIntoInventory(rig, CRUSHER_ID)?.count).toBe(4);
    expect(rig.inventory.count('crushed_ore')).toBe(4);
    let snapshot = tick(rig, progress);
    expect(snapshot.blocker).toBeNull();
    expect(snapshot.steps.find((step) => step.id === 'crush-ore')?.progress).toEqual({ current: 0, required: 2 });

    snapshot = runUntil(rig, progress, () => producedCount(rig, 'crushed_ore') >= 6);
    expect(producedCount(rig, 'crushed_ore')).toBe(6);
    expect(snapshot.currentStep.id).toBe('smelt-ingot');
    expect(progress.state().completed).toContain('crush-ore');
    expect(snapshot.steps.find((step) => step.id === 'crush-ore')?.progress).toEqual({ current: 2, required: 2 });
    expectGoalViewMatches(snapshot);
  });
});

describe('M2.0-P1-D 场景 6：原材料不足', () => {
  it('reports no-input with the iron ore hint and clears it after real feeding', () => {
    const rig = new GoalRig(POWERED_LINE);
    rig.inventory.add('iron_ore', 2);
    engageFlywheel(rig);
    const { progress, snapshot: waiting } = startOrder(rig);

    expect(waiting.currentStep.id).toBe('crush-ore');
    expect(waiting.blocker?.code).toBe('no-input');
    expect(waiting.blocker?.message).toContain('铁矿石');
    expect(rig.production.snapshot().machines.find((machine) => machine.partId === CRUSHER_ID)?.block).toBe('no-input');
    expectGoalViewMatches(waiting);

    expect(feedFromInventory(rig, CRUSHER_ID, 2)).toBe(2);
    let snapshot = tick(rig, progress);
    expect(snapshot.blocker).toBeNull();
    snapshot = runUntil(rig, progress, () => producedCount(rig, 'crushed_ore') >= 2);
    expect(snapshot.currentStep.id).toBe('smelt-ingot');
    expect(progress.state().completed).toContain('crush-ore');
    expectGoalViewMatches(snapshot);
  });
});

describe('M2.0-P1-D 场景 7：配方错误', () => {
  it('reports wrong-recipe on the forge and resumes after cycling back to the shaft recipe', () => {
    const rig = new GoalRig(POWERED_LINE);
    rig.inventory.add('iron_ore', 2);
    engageFlywheel(rig);
    const { progress } = startOrder(rig);
    reachForgeStage(rig, progress);

    let snapshot = progress.snapshot();
    expect(snapshot.currentStep.id).toBe('forge-shaft');
    expect(rig.inventory.count('iron_ingot')).toBe(2);

    // 真实按 R 切到「锻压立式传动带」：订单当前步判定 wrong-recipe。
    expect(rig.production.cycleMachineRecipe(FORGE_ID)).toBe(true);
    snapshot = tick(rig, progress);
    expect(rig.production.snapshot().machines.find((machine) => machine.partId === FORGE_ID)?.recipeId)
      .toBe('forge-vertical-drive');
    expect(snapshot.currentStep.id).toBe('forge-shaft');
    expect(snapshot.blocker?.code).toBe('wrong-recipe');
    expect(snapshot.blocker?.message).toContain('锻压传动轴');
    expect(snapshot.steps.find((step) => step.id === 'forge-shaft')?.progress).toEqual({ current: 0, required: 1 });
    expect(snapshot.complete).toBe(false);
    expectGoalViewMatches(snapshot);

    // 切回正确配方：按真实配方列表长度循环，配方数量变化时本用例仍然成立
    // （P2-B 锻压机新增第 4 条配方，这里不再硬编码「两次」）。
    for (let guard = 0; guard < MACHINE_RECIPES.forge!.length; guard += 1) {
      const current = rig.production.snapshot().machines.find((machine) => machine.partId === FORGE_ID)?.recipeId;
      if (current === 'forge-shaft') break;
      expect(rig.production.cycleMachineRecipe(FORGE_ID)).toBe(true);
    }
    expect(rig.production.snapshot().machines.find((machine) => machine.partId === FORGE_ID)?.recipeId).toBe('forge-shaft');
    snapshot = tick(rig, progress);
    expect(snapshot.blocker?.code).toBe('no-input');

    expect(feedFromInventory(rig, FORGE_ID, 2)).toBe(2);
    snapshot = runUntil(rig, progress, () => producedCount(rig, 'shaft') >= 1);
    expect(snapshot.complete).toBe(true);
    expect(producedSummary(rig)).toEqual({ crushed_ore: 2, iron_ingot: 2, shaft: 1 });
    expectGoalViewMatches(snapshot);
  });
});

describe('M2.0-P1-D 场景 8：拆除机器后重新建设', () => {
  it('reports missing-machine after dismantling the forge and completes after rebuilding it', () => {
    const rig = new GoalRig(POWERED_LINE);
    rig.inventory.add('iron_ore', 2);
    engageFlywheel(rig);
    const { progress } = startOrder(rig);
    reachForgeStage(rig, progress);
    expect(progress.snapshot().currentStep.id).toBe('forge-shaft');
    expect(rig.inventory.count('iron_ingot')).toBe(2);

    // 真实拆除锻压机：parts 移除并同步两个运行时。
    rig.setParts(POWERED_LINE.filter((spec) => spec.id !== FORGE_ID));
    let snapshot = tick(rig, progress);
    expect(rig.parts.some((part) => part.def.id === 'forge')).toBe(false);
    expect(snapshot.currentStep.id).toBe('forge-shaft');
    expect(snapshot.blocker?.code).toBe('missing-machine');
    expect(snapshot.blocker?.message).toContain('锻压机');
    expect(snapshot.steps.find((step) => step.id === 'forge-shaft')?.completed).toBe(false);
    expect(snapshot.steps.find((step) => step.id === 'forge-shaft')?.progress).toEqual({ current: 0, required: 1 });
    expect(snapshot.complete).toBe(false);
    expectGoalViewMatches(snapshot);

    // 重新放回锻压机：真实生产状态重建，阻塞回到 no-input，继续推进到完成。
    rig.setParts(POWERED_LINE);
    snapshot = tick(rig, progress);
    expect(rig.parts.some((part) => part.def.id === 'forge')).toBe(true);
    expect(snapshot.blocker?.code).toBe('no-input');
    expect(rig.production.snapshot().machines.find((machine) => machine.partId === FORGE_ID)?.recipeId).toBe('forge-shaft');

    expect(feedFromInventory(rig, FORGE_ID, 2)).toBe(2);
    snapshot = runUntil(rig, progress, () => producedCount(rig, 'shaft') >= 1);
    expect(snapshot.complete).toBe(true);
    expect(producedSummary(rig)).toEqual({ crushed_ore: 2, iron_ingot: 2, shaft: 1 });
    expectGoalViewMatches(snapshot);
  });
});
