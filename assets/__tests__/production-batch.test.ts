import { describe, expect, it } from 'vitest';
import { MECHANICAL_PART_DEFS, type MechanicalPart, type MechanicalPartDef } from '../mechanical/parts.ts';
import {
  activeRecipe,
  availableRecipesFor,
  createMachineState,
  cycleRecipe,
  ensureRecipeSelected,
  inputCapacity,
  insertInput,
  outputCapacity,
  takeOutput,
  tickMachine,
  type MachineState,
  type RecipeFilter,
} from '../production/production.ts';
import {
  FORGE_BATCH_INTERFACE_BOX_RECIPE,
  FORGE_BATCH_SHAFT_RECIPE,
  FORGE_BATCH_STRUCTURE_FRAME_RECIPE,
  MACHINE_RECIPES,
} from '../production/recipes.ts';
import { ProductionRuntime } from '../production/production-runtime.ts';

/**
 * M2.0-P2-E2 工作包 B2：T3.1 标准化批量加工（同物品多件产出）。
 *
 * 全部走真实 `tickMachine` / `ProductionRuntime`，不重写加工语义。
 * 三条批量配方：forge-batch-shaft 4→2 / 7s、forge-batch-interface-box 6→3 / 9s、
 * forge-batch-structure-frame 6→2 / 8s（docs/m20/P2-E0-TECH-TREE-DESIGN.md §4.11）。
 */

const FORGE: MechanicalPartDef = MECHANICAL_PART_DEFS.forge;
const BATCHES = [
  FORGE_BATCH_SHAFT_RECIPE,
  FORGE_BATCH_INTERFACE_BOX_RECIPE,
  FORGE_BATCH_STRUCTURE_FRAME_RECIPE,
] as const;

/** 以 0.25s 帧长推进 seconds 秒；返回期间完成过几次周期。 */
function runBatch(
  state: MachineState,
  def: MechanicalPartDef,
  seconds: number,
  options: { powered?: boolean; rate?: number; isUnlocked?: RecipeFilter } = {},
): number {
  const powered = options.powered ?? true;
  const rate = options.rate ?? 1;
  let cycles = 0;
  const steps = Math.round(seconds / 0.25);
  for (let index = 0; index < steps; index += 1) {
    if (tickMachine(state, { def, powered, rate, delta: 0.25, isUnlocked: options.isUnlocked })) cycles += 1;
  }
  return cycles;
}

/** 选中某条配方（不清缓冲，配合 createMachineState 使用）。 */
function selectRecipe(state: MachineState, recipeId: string): void {
  state.recipeId = recipeId;
  state.recipeIndex = (MACHINE_RECIPES.forge ?? []).findIndex((recipe) => recipe.id === recipeId);
}

describe('B2-1 批量配方数据契约（E0 §7 / §4.11）', () => {
  it('三条批量配方存在、recipeId 稳定，且同物品多件输入/输出能塞进锻压机缓冲', () => {
    const forgeRecipes = MACHINE_RECIPES.forge ?? [];
    expect(BATCHES.map((recipe) => recipe.id)).toEqual([
      'forge-batch-shaft',
      'forge-batch-interface-box',
      'forge-batch-structure-frame',
    ]);
    for (const recipe of BATCHES) {
      // 配方以稳定 recipeId 为权威身份（不是数组下标）。
      expect(forgeRecipes.find((entry) => entry.id === recipe.id)).toBe(recipe);
      expect(recipe.inputs).toHaveLength(1);
      expect(recipe.outputs).toHaveLength(1);
      // 批量投料是「整笔」的：一批原料必须能一次性放进输入缓冲。
      expect(recipe.inputs[0]!.count).toBeLessThanOrEqual(inputCapacity(FORGE));
      // 多件产出必须能一次性放进输出缓冲（否则永远无法开工）。
      expect(recipe.outputs[0]!.count).toBeLessThanOrEqual(outputCapacity(FORGE));
      expect(recipe.outputs[0]!.count).toBeGreaterThan(1);
    }
    // 三条批量配方的单件时长严格小于单件配方（标准化带来吞吐提升）。
    const perUnit = (recipeId: string, outCount: number): number =>
      (forgeRecipes.find((entry) => entry.id === recipeId)?.seconds ?? 0) / outCount;
    expect(perUnit('forge-batch-shaft', 2)).toBe(3.5);
    expect(perUnit('forge-batch-interface-box', 3)).toBe(3);
    expect(perUnit('forge-batch-structure-frame', 2)).toBe(4);
    expect(FORGE_BATCH_SHAFT_RECIPE.seconds).toBe(7);
    expect(FORGE_BATCH_INTERFACE_BOX_RECIPE.seconds).toBe(9);
    expect(FORGE_BATCH_STRUCTURE_FRAME_RECIPE.seconds).toBe(8);
  });
});

describe('B2-2 多件产出真的进入输出缓冲（不是只产 1 件）', () => {
  it('批量传动轴：4 铁锭 → 2 根轴，整笔扣料、产物计数为 2', () => {
    const state = createMachineState(1);
    selectRecipe(state, 'forge-batch-shaft');
    expect(insertInput(state, FORGE, 'iron_ingot', 4)).toBe(4);

    expect(runBatch(state, FORGE, 7.5)).toBe(1); // 7s/0.25s 帧长会有浮点尾差，多推一帧
    expect(state.outputItem).toBe('shaft');
    expect(state.outputCount).toBe(2);
    expect(state.producedTotal).toBe(2);
    expect(state.inputCount).toBe(0);
    expect(state.inputItem).toBeNull();
    expect(state.progress).toBe(0);
  });

  it('批量接口盒：6 铁锭 → 3 个（输出容量 4，3 件能放下）', () => {
    const state = createMachineState(2);
    selectRecipe(state, 'forge-batch-interface-box');
    expect(insertInput(state, FORGE, 'iron_ingot', 6)).toBe(6);
    expect(runBatch(state, FORGE, 9)).toBe(1);
    expect(state.outputItem).toBe('interface_box');
    expect(state.outputCount).toBe(3);
    expect(state.producedTotal).toBe(3);
    expect(state.inputCount).toBe(0);
  });

  it('批量结构框架：6 铁锭 → 2 个', () => {
    const state = createMachineState(3);
    selectRecipe(state, 'forge-batch-structure-frame');
    expect(insertInput(state, FORGE, 'iron_ingot', 6)).toBe(6);
    expect(runBatch(state, FORGE, 8)).toBe(1);
    expect(state.outputItem).toBe('structure_frame');
    expect(state.outputCount).toBe(2);
    expect(state.producedTotal).toBe(2);
  });
});

describe('B2-3 材料守恒：整笔扣除、不凭空产生物料', () => {
  it('批量传动轴 3 个周期：消耗 12 铁锭、产出 6 轴，缓冲账目对得上', () => {
    const state = createMachineState(4);
    selectRecipe(state, 'forge-batch-shaft');
    let inserted = 0;
    let producedItems = 0;
    let cycles = 0;
    for (let batch = 0; batch < 3; batch += 1) {
      inserted += insertInput(state, FORGE, 'iron_ingot', 4);
      cycles += runBatch(state, FORGE, 7.5);
      const taken = takeOutput(state, Number.MAX_SAFE_INTEGER);
      expect(taken).toEqual({ itemId: 'shaft', count: 2 });
      producedItems += taken?.count ?? 0;
    }
    expect(inserted).toBe(12);
    expect(cycles).toBe(3);
    expect(producedItems).toBe(6);
    expect(state.producedTotal).toBe(6);
    // 消耗 = 3 周期 × 4 = 12；输入缓冲已被逐批取空（不蒸发也不增殖）。
    expect(state.inputCount).toBe(0);
    expect(state.inputItem).toBeNull();
    expect(state.outputCount).toBe(0);
    expect(state.outputItem).toBeNull();
    expect(cycles * 4 + state.inputCount).toBe(inserted);
    expect(state.producedTotal).toBe(cycles * 2);
  });
});

describe('B2-4 输出满载：progress 停在 1.0、不丢产物、下游腾空后恢复', () => {
  it('周期中途输出被塞满时停在 1.0；腾出恰好空间后完成并保留全部产物', () => {
    const state = createMachineState(5);
    selectRecipe(state, 'forge-batch-shaft');
    expect(insertInput(state, FORGE, 'iron_ingot', 4)).toBe(4);
    // 先跑一个周期进度但不开工完成：直接推进到接近结束（7s → 6.75s）。
    runBatch(state, FORGE, 6.75);
    expect(state.progress).toBeGreaterThan(0.9);
    expect(state.inputCount).toBe(0); // 开工时已整笔扣除
    // 模拟下游在这时把输出缓冲塞满（真实场景：输出盒/溜槽没腾空）。
    state.outputItem = 'shaft';
    state.outputCount = 4;

    expect(runBatch(state, FORGE, 5)).toBe(0);
    expect(state.progress).toBe(1);
    expect(state.block).toBe('output-full');
    expect(state.outputCount).toBe(4);
    expect(state.producedTotal).toBe(0); // 没丢，也没提前记产出

    // 腾出 2 格（恰好够这一批 2 件）→ 下一次 tick 完成，产物全部进缓冲。
    expect(takeOutput(state, 2)).toEqual({ itemId: 'shaft', count: 2 });
    expect(tickMachine(state, { def: FORGE, powered: true, rate: 1, delta: 0.25 })).toBe(true);
    expect(state.progress).toBe(0);
    expect(state.outputCount).toBe(4); // 2 残留 + 2 产出
    expect(state.producedTotal).toBe(2);
  });

  it('开工前输出空间不足 2 件时不开工也不扣料', () => {
    const state = createMachineState(6);
    selectRecipe(state, 'forge-batch-interface-box');
    expect(insertInput(state, FORGE, 'iron_ingot', 6)).toBe(6);
    state.outputItem = 'interface_box';
    state.outputCount = 2; // 2 + 3 > 4，无法容纳一批 3 件

    runBatch(state, FORGE, 2);
    expect(state.block).toBe('output-full');
    expect(state.progress).toBe(0);
    expect(state.inputCount).toBe(6); // 一个都没扣

    // 输出腾到 1 件后（1 + 3 = 4）开工。
    takeOutput(state, 1);
    tickMachine(state, { def: FORGE, powered: true, rate: 1, delta: 0.25 });
    expect(state.progress).toBeGreaterThan(0);
    expect(state.inputCount).toBe(0);
  });
});

describe('B2-5 动力不足/断轴：进度冻结、恢复后继续（批量配方同样成立）', () => {
  it('掉电期间进度与原料都不变，恢复后从原进度完成整批', () => {
    const state = createMachineState(7);
    selectRecipe(state, 'forge-batch-interface-box');
    insertInput(state, FORGE, 'iron_ingot', 6);
    runBatch(state, FORGE, 3);
    const frozen = state.progress;
    expect(frozen).toBeGreaterThan(0);

    expect(runBatch(state, FORGE, 4, { powered: false })).toBe(0);
    expect(state.progress).toBe(frozen);
    expect(state.block).toBe('no-power');
    expect(state.inputCount).toBe(0); // 已在开工时扣过一次，掉电不重复扣

    const cycles = runBatch(state, FORGE, 6);
    expect(cycles).toBe(1);
    expect(state.progress).toBe(0);
    expect(state.outputCount).toBe(3);
    expect(state.producedTotal).toBe(3);
  });

  it('rate=0（转速被负载压停）等同无动力', () => {
    const state = createMachineState(8);
    selectRecipe(state, 'forge-batch-shaft');
    insertInput(state, FORGE, 'iron_ingot', 4);
    runBatch(state, FORGE, 1, { rate: 0 });
    expect(state.progress).toBe(0);
    expect(state.block).toBe('no-power');
    expect(state.inputCount).toBe(4);
  });
});

describe('B2-6 输入缓冲容量与批量投料（4 件/批）的交互', () => {
  it('锻压机输入缓冲覆盖所有配方整笔原料（7/8/12 件重配方缺陷回归）', () => {
    const forgeRecipes = MACHINE_RECIPES.forge ?? [];
    const heaviest = Math.max(...forgeRecipes.map((recipe) => recipe.inputs[0]!.count));
    // 缺陷背景：容量 6 时 forge-smelter(7)/forge-processing-core(8)/forge-flywheel(12) 永远开不了工。
    expect(heaviest).toBe(12);
    expect(inputCapacity(FORGE)).toBeGreaterThanOrEqual(heaviest);
  });

  it('投料到容量上限：按空格数部分接收，满了返回 0', () => {
    const state = createMachineState(9);
    selectRecipe(state, 'forge-batch-shaft');
    const capacity = inputCapacity(FORGE);
    expect(insertInput(state, FORGE, 'iron_ingot', 4)).toBe(4);
    expect(state.inputCount).toBe(4);
    // 只剩 capacity - 4 格：超出的部分不接收。
    expect(insertInput(state, FORGE, 'iron_ingot', capacity)).toBe(capacity - 4);
    expect(state.inputCount).toBe(capacity);
    expect(insertInput(state, FORGE, 'iron_ingot', 1)).toBe(0);
  });

  it('不足一批（3 件）时不开工：进度 0、一件都不扣，补到 4 件立即开工', () => {
    const state = createMachineState(10);
    selectRecipe(state, 'forge-batch-shaft');
    expect(insertInput(state, FORGE, 'iron_ingot', 3)).toBe(3);
    runBatch(state, FORGE, 2);
    expect(state.progress).toBe(0);
    expect(state.block).toBe('no-input');
    expect(state.inputCount).toBe(3);

    expect(insertInput(state, FORGE, 'iron_ingot', 1)).toBe(1);
    tickMachine(state, { def: FORGE, powered: true, rate: 1, delta: 0.25 });
    expect(state.inputCount).toBe(0);
    expect(state.progress).toBeGreaterThan(0);
  });
});

describe('B2-7 配方解锁门控：未解锁时批量配方不可切、不可加工', () => {
  const baseOnly: RecipeFilter = (recipeId) => ['forge-shaft', 'forge-chute'].includes(recipeId);

  it('未解锁的批量配方不出现在可用配方表、不可被 R 切到', () => {
    const available = availableRecipesFor('forge', baseOnly).map((recipe) => recipe.id);
    expect(available).toEqual(['forge-shaft', 'forge-chute']);
    expect(available.some((id) => id.startsWith('forge-batch-'))).toBe(false);

    const state = createMachineState(11);
    ensureRecipeSelected(state, FORGE, baseOnly);
    expect(state.recipeId).toBe('forge-shaft');
    // 完整回绕一圈：只能在上锁表内切换，绝不进入批量配方。
    for (let step = 0; step < available.length * 2; step += 1) {
      expect(cycleRecipe(state, FORGE, baseOnly)).toBe(true);
      expect(state.recipeId === 'forge-shaft' || state.recipeId === 'forge-chute').toBe(true);
    }
  });

  it('即使选中状态残留批量 recipeId，加工也只会走已解锁配方（不会产出批量结果）', () => {
    const state = createMachineState(12);
    selectRecipe(state, 'forge-batch-shaft'); // 模拟存档/模式切换残留
    insertInput(state, FORGE, 'iron_ingot', 6);
    const cycles = runBatch(state, FORGE, 10, { isUnlocked: baseOnly });
    // 回落配方是 forge-shaft（2 铁锭 → 1 轴）：不会出现一次 2 件的批量产出。
    expect(activeRecipe(state, FORGE, baseOnly)?.id).toBe('forge-shaft');
    expect(cycles).toBeGreaterThan(0);
    expect(state.producedTotal).toBe(cycles);
    expect(state.outputCount).toBe(cycles);
    expect(state.outputItem).toBe('shaft');
  });

  it('解锁后批量配方可切、真实进入加工（同一 tickMachine 路径）', () => {
    const unlocked = new Set(['forge-shaft', 'forge-batch-shaft']);
    const filter: RecipeFilter = (recipeId) => unlocked.has(recipeId);
    const state = createMachineState(13);
    ensureRecipeSelected(state, FORGE, filter);
    expect(cycleRecipe(state, FORGE, filter)).toBe(true);
    expect(state.recipeId).toBe('forge-batch-shaft');
    insertInput(state, FORGE, 'iron_ingot', 4, filter);
    expect(runBatch(state, FORGE, 7.5, { isUnlocked: filter })).toBe(1);
    expect(state.outputCount).toBe(2);
    expect(state.producedTotal).toBe(2);
  });
});

describe('B2-8 ProductionRuntime 集成：多件产出计入累计产出与快照', () => {
  function part(id: number, def: MechanicalPartDef): MechanicalPart {
    return { id, def, placement: { gx: id, gz: 0, level: 0, w: def.w, d: def.d, rotation: 0 } };
  }

  it('完整帧推进后 produced 按件数累计（2 件/周期），机器快照 outputCount=2', () => {
    const runtime = new ProductionRuntime({
      partAt: () => undefined,
      addItem: () => {},
    });
    const forge = part(21, FORGE);
    runtime.sync([forge]);
    const state = runtime.machineState(21);
    expect(state).toBeDefined();
    state!.recipeId = 'forge-batch-shaft';
    expect(runtime.insertInto(21, 'iron_ingot', 4)).toBe(4);
    runtime.setPowerReading(21, { powered: true, rate: 1 });

    for (let index = 0; index < 30; index += 1) runtime.tick(0.25);
    const snapshot = runtime.snapshot();
    const machine = snapshot.machines.find((entry) => entry.partId === 21);
    expect(machine?.recipeId).toBe('forge-batch-shaft');
    expect(machine?.outputItem).toBe('shaft');
    expect(machine?.outputCount).toBe(2);
    expect(machine?.producedTotal).toBe(2);
    expect(snapshot.produced).toEqual([{ itemId: 'shaft', count: 2 }]);
  });
});

describe('B2-9 重配方真实可加工（锻压机缓冲容量缺陷回归）', () => {
  it('forge-flywheel：12 铁锭真实锻出 1 台手摇飞轮储能机', () => {
    const state = createMachineState(31);
    selectRecipe(state, 'forge-flywheel');
    // 容量 6 的老缺陷下这里只会收 6 件、然后永远 no-input；修复后必须整笔 12 件可投。
    expect(insertInput(state, FORGE, 'iron_ingot', 12)).toBe(12);
    expect(runBatch(state, FORGE, 12.5)).toBe(1);
    expect(state.outputItem).toBe('flywheel_source');
    expect(state.outputCount).toBe(1);
    expect(state.producedTotal).toBe(1);
    expect(state.inputCount).toBe(0);
    expect(state.progress).toBe(0);
    // 完成后多推的帧会因为原料耗尽转成 no-input（不是 no-power/容量不足）。
    expect(state.block).not.toBe('no-power');
  });

  it('forge-smelter(7) 与 forge-processing-core(8) 同样能整笔投料并完成', () => {
    const cases = [
      { recipeId: 'forge-smelter', count: 7, outputItem: 'smelter', seconds: 9 },
      { recipeId: 'forge-processing-core', count: 8, outputItem: 'forge', seconds: 10 },
    ] as const;
    for (const item of cases) {
      const state = createMachineState(32);
      selectRecipe(state, item.recipeId);
      expect(insertInput(state, FORGE, 'iron_ingot', item.count)).toBe(item.count);
      expect(runBatch(state, FORGE, item.seconds + 1)).toBe(1);
      expect(state.outputItem).toBe(item.outputItem);
      expect(state.outputCount).toBe(1);
      expect(state.producedTotal).toBe(1);
    }
  });
});
