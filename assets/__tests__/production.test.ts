import { describe, expect, it } from 'vitest';
import { MECHANICAL_PART_DEFS, type MechanicalPartDef } from '../mechanical/parts.ts';
import {
  activeRecipe,
  canSwitchRecipe,
  createMachineState,
  cycleRecipe,
  flushMachine,
  insertInput,
  takeOutput,
  tickMachine,
  type MachineState,
} from '../production/production.ts';
import {
  FORGE_SHAFT_RECIPE,
  MACHINE_RECIPES,
} from '../production/recipes.ts';

const CRUSHER: MechanicalPartDef = MECHANICAL_PART_DEFS.crusher;
const FORGE: MechanicalPartDef = MECHANICAL_PART_DEFS.forge;

/** 以 0.25s 帧长推进 seconds 秒；返回期间是否完成过周期。 */
function run(
  state: MachineState,
  def: MechanicalPartDef,
  seconds: number,
  powered = true,
  rate = 1,
): boolean {
  let completed = false;
  const steps = Math.round(seconds / 0.25);
  for (let index = 0; index < steps; index += 1) {
    completed = tickMachine(state, { def, powered, rate, delta: 0.25 }) || completed;
  }
  return completed;
}

describe('M1.8-C machine state machine', () => {
  it('advances progress only while powered and consuming one batch of input', () => {
    const state = createMachineState(1);
    expect(insertInput(state, CRUSHER, 'iron_ore', 4)).toBe(4);

    expect(tickMachine(state, { def: CRUSHER, powered: true, rate: 1, delta: 0.25 })).toBe(false);
    expect(state.progress).toBeCloseTo(0.25 / 4, 12);
    expect(state.block).toBe('ok');
    // 开工时整笔扣 1 个原料。
    expect(state.inputCount).toBe(3);
    expect(state.inputItem).toBe('iron_ore');

    expect(tickMachine(state, { def: CRUSHER, powered: true, rate: 1, delta: 0.25 })).toBe(false);
    expect(state.progress).toBeCloseTo(0.5 / 4, 12);
  });

  it('freezes progress without power and resumes from the frozen progress', () => {
    const state = createMachineState(1);
    insertInput(state, CRUSHER, 'iron_ore', 4);
    run(state, CRUSHER, 0.5);
    const frozen = state.progress;
    expect(frozen).toBeGreaterThan(0);

    const consumedBefore = state.inputCount;
    run(state, CRUSHER, 1, false);
    expect(state.progress).toBe(frozen);
    expect(state.block).toBe('no-power');
    expect(state.inputCount).toBe(consumedBefore);

    run(state, CRUSHER, 0.25, true);
    expect(state.progress).toBeCloseTo(frozen + 0.25 / 4, 12);
    expect(state.progress).not.toBe(0);
  });

  it('consumes exactly one input and stores one output when a cycle completes', () => {
    const state = createMachineState(1);
    insertInput(state, CRUSHER, 'iron_ore', 1);

    const completed = run(state, CRUSHER, 4);
    expect(completed).toBe(true);
    expect(state.progress).toBe(0);
    expect(state.inputCount).toBe(0);
    expect(state.inputItem).toBeNull();
    expect(state.outputItem).toBe('crushed_ore');
    expect(state.outputCount).toBe(1);
    expect(state.producedTotal).toBe(1);

    // 第二个周期：再扣 1，产出累计 2。
    insertInput(state, CRUSHER, 'iron_ore', 1);
    expect(run(state, CRUSHER, 4)).toBe(true);
    expect(state.outputCount).toBe(2);
    expect(state.producedTotal).toBe(2);
  });

  it('does not consume input when the batch is too small', () => {
    const state = createMachineState(1);
    // 锻压传动轴需要 2 个铁锭。
    expect(insertInput(state, FORGE, 'iron_ingot', 1)).toBe(1);

    run(state, FORGE, 0.5);
    expect(state.progress).toBe(0);
    expect(state.block).toBe('no-input');
    expect(state.inputCount).toBe(1);
    expect(state.producedTotal).toBe(0);

    expect(insertInput(state, FORGE, 'iron_ingot', 1)).toBe(1);
    run(state, FORGE, 0.25);
    expect(state.progress).toBeGreaterThan(0);
    expect(state.inputCount).toBe(0);
  });

  it('stops at progress 1 with output-full and resumes after takeOutput frees space', () => {
    const state = createMachineState(1);
    insertInput(state, CRUSHER, 'iron_ore', 1);
    tickMachine(state, { def: CRUSHER, powered: true, rate: 1, delta: 0.25 });
    expect(state.progress).toBeGreaterThan(0);

    // 本周期进行中输出缓冲被塞满（容量 4）。
    state.outputItem = 'crushed_ore';
    state.outputCount = 4;

    run(state, CRUSHER, 5);
    expect(state.progress).toBe(1);
    expect(state.block).toBe('output-full');
    expect(state.outputCount).toBe(4);
    expect(state.producedTotal).toBe(0);

    const taken = takeOutput(state, 1);
    expect(taken).toEqual({ itemId: 'crushed_ore', count: 1 });
    expect(state.outputCount).toBe(3);

    expect(tickMachine(state, { def: CRUSHER, powered: true, rate: 1, delta: 0.25 })).toBe(true);
    expect(state.progress).toBe(0);
    expect(state.outputCount).toBe(4);
    expect(state.producedTotal).toBe(1);
  });

  it('refuses to start a cycle when output is already full (no input consumed)', () => {
    const state = createMachineState(1);
    state.outputItem = 'crushed_ore';
    state.outputCount = 4;
    expect(insertInput(state, CRUSHER, 'iron_ore', 1)).toBe(1);

    run(state, CRUSHER, 1);
    expect(state.block).toBe('output-full');
    expect(state.progress).toBe(0);
    expect(state.inputCount).toBe(1);
  });

  it('inserts only the active recipe input, never beyond capacity, and returns the amount', () => {
    const state = createMachineState(1);
    expect(insertInput(state, CRUSHER, 'iron_ingot', 1)).toBe(0);
    expect(state.inputCount).toBe(0);

    expect(insertInput(state, CRUSHER, 'iron_ore', 3)).toBe(3);
    expect(insertInput(state, CRUSHER, 'iron_ore', 5)).toBe(1);
    expect(state.inputCount).toBe(4);
    expect(insertInput(state, CRUSHER, 'iron_ore', 1)).toBe(0);
    expect(insertInput(state, CRUSHER, 'iron_ore', 0)).toBe(0);
    expect(insertInput(state, CRUSHER, 'iron_ore', -2)).toBe(0);
  });

  it('cycles the forge recipe only when the cycle has not consumed input', () => {
    // P2-C：锻压机新增输出/分流/合流接口盒与三种加工核心复制配方，列表 4 → 10；
    // 既有 4 条顺序保持不变（历史验收脚本按这个顺序记 R 的按法）。
    expect(MACHINE_RECIPES.forge).toHaveLength(10);
    expect(MACHINE_RECIPES.forge?.map((recipe) => recipe.id)).toEqual([
      'forge-shaft',
      'forge-vertical-drive',
      'forge-chute',
      'forge-interface-box',
      'forge-output-box',
      'forge-splitter-box',
      'forge-merger-box',
      'forge-crusher',
      'forge-smelter',
      'forge-processing-core',
    ]);
    const state = createMachineState(1);
    expect(activeRecipe(state, FORGE)?.id).toBe(FORGE_SHAFT_RECIPE.id);
    expect(canSwitchRecipe(state)).toBe(true);

    // 完整回绕一圈：每条配方都能切到，最后回到第一条（比逐个硬编码更抗新增）。
    const forgeRecipes = MACHINE_RECIPES.forge ?? [];
    for (let step = 1; step < forgeRecipes.length; step += 1) {
      expect(cycleRecipe(state, FORGE)).toBe(true);
      expect(state.recipeIndex).toBe(step);
      expect(activeRecipe(state, FORGE)?.id).toBe(forgeRecipes[step]?.id);
    }
    expect(cycleRecipe(state, FORGE)).toBe(true);
    expect(state.recipeIndex).toBe(0);
    expect(activeRecipe(state, FORGE)?.id).toBe(FORGE_SHAFT_RECIPE.id);

    // 有进度时不能切。
    state.progress = 0.4;
    expect(canSwitchRecipe(state)).toBe(false);
    expect(cycleRecipe(state, FORGE)).toBe(false);
    expect(state.recipeIndex).toBe(0);

    // 有已缓冲原料时不能切。
    state.progress = 0;
    expect(insertInput(state, FORGE, 'iron_ingot', 1)).toBe(1);
    expect(canSwitchRecipe(state)).toBe(false);
    expect(cycleRecipe(state, FORGE)).toBe(false);
    expect(state.recipeIndex).toBe(0);

    // 单配方机器不接受切换。
    expect(cycleRecipe(createMachineState(2), CRUSHER)).toBe(false);
  });

  it('flushes input and output back out when the machine is dismantled', () => {
    const state = createMachineState(7);
    expect(insertInput(state, FORGE, 'iron_ingot', 2)).toBe(2);
    state.outputItem = 'shaft';
    state.outputCount = 1;
    state.progress = 0.5;

    const flushed = flushMachine(state);
    expect(flushed).toHaveLength(2);
    expect(flushed).toContainEqual({ itemId: 'iron_ingot', count: 2 });
    expect(flushed).toContainEqual({ itemId: 'shaft', count: 1 });

    expect(state.inputItem).toBeNull();
    expect(state.inputCount).toBe(0);
    expect(state.outputItem).toBeNull();
    expect(state.outputCount).toBe(0);
    expect(state.progress).toBe(0);
  });

  it('scales cycle speed linearly with the rate reading', () => {
    const fast = createMachineState(1);
    const slow = createMachineState(2);
    insertInput(fast, CRUSHER, 'iron_ore', 1);
    insertInput(slow, CRUSHER, 'iron_ore', 1);

    tickMachine(fast, { def: CRUSHER, powered: true, rate: 1, delta: 0.25 });
    tickMachine(slow, { def: CRUSHER, powered: true, rate: 0.5, delta: 0.25 });
    expect(slow.progress).toBeCloseTo(fast.progress / 2, 12);

    // rate=0 等同于没有动力。
    const stalled = createMachineState(3);
    insertInput(stalled, CRUSHER, 'iron_ore', 1);
    tickMachine(stalled, { def: CRUSHER, powered: true, rate: 0, delta: 0.25 });
    expect(stalled.block).toBe('no-power');
    expect(stalled.progress).toBe(0);
  });
});

describe('M1.8 回归：零长度时间步不吞原料', () => {
  it('does not consume inputs when delta is zero', () => {
    const def = MECHANICAL_PART_DEFS.crusher;
    const state = createMachineState(1);
    insertInput(state, def, 'iron_ore', 2);
    expect(state.inputCount).toBe(2);
    const completed = tickMachine(state, { def, powered: true, rate: 1, delta: 0 });
    expect(completed).toBe(false);
    expect(state.inputCount).toBe(2);
    expect(state.progress).toBe(0);
    // 之后用正常帧长会真的开工并扣料。
    tickMachine(state, { def, powered: true, rate: 1, delta: 0.1 });
    expect(state.inputCount).toBe(1);
    expect(state.progress).toBeGreaterThan(0);
  });
});
