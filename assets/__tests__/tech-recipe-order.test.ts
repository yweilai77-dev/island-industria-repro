import { describe, expect, it } from 'vitest';
import { MECHANICAL_PART_DEFS } from '../mechanical/parts.ts';
import {
  activeRecipe,
  availableRecipesFor,
  createMachineState,
  cycleRecipe,
  ensureRecipeSelected,
  type RecipeFilter,
} from '../production/production.ts';
import { recipesFor } from '../production/recipes.ts';

/**
 * P2-E1 配方门控顺序测试（任务书 §六）：
 * availableRecipesFor 只过滤不重排、cycleRecipe 跳过未解锁配方、
 * activeRecipe 在 recipeId 已解锁时稳定、解锁集合变化时 recipeId 不漂移（D3 回归）。
 */

const FORGE = MECHANICAL_PART_DEFS.forge;
const FORGE_IDS = recipesFor(FORGE.id).map((recipe) => recipe.id);

/** 完整锻压配方表顺序（既有 11 条在前，P2-E1 的 6 条追加在末尾）。 */
const FULL_FORGE_ORDER = [
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
  'forge-structure-frame',
  'forge-gear-12',
  'forge-gear-24',
  'forge-flywheel',
  'forge-batch-shaft',
  'forge-batch-interface-box',
  'forge-batch-structure-frame',
];

function filterOf(ids: readonly string[]): RecipeFilter {
  const unlocked = new Set(ids);
  return (recipeId) => unlocked.has(recipeId);
}

describe('availableRecipesFor：过滤但不重排', () => {
  it('不给过滤器时返回完整配方表（引用与顺序都不变）', () => {
    expect(FORGE_IDS).toEqual(FULL_FORGE_ORDER);
    expect(availableRecipesFor(FORGE.id)).toBe(recipesFor(FORGE.id));
    expect(availableRecipesFor(FORGE.id).map((recipe) => recipe.id)).toEqual(FULL_FORGE_ORDER);
  });

  it('过滤器只裁剪集合，保留配方表原始相对顺序', () => {
    const allowed = ['forge-shaft', 'forge-chute', 'forge-gear-12', 'forge-batch-shaft'];
    const result = availableRecipesFor(FORGE.id, filterOf(allowed));
    expect(result.map((recipe) => recipe.id)).toEqual([
      'forge-shaft',
      'forge-chute',
      'forge-gear-12',
      'forge-batch-shaft',
    ]);
    // 顺序 = 完整表中出现顺序，而不是传入集合顺序。
    expect(result.map((recipe) => recipe.id)).toEqual(
      FULL_FORGE_ORDER.filter((id) => allowed.includes(id)),
    );
  });

  it('过滤器对每个配方按配方表顺序恰好求值一次', () => {
    const calls: string[] = [];
    const result = availableRecipesFor(FORGE.id, (recipeId) => {
      calls.push(recipeId);
      return recipeId.startsWith('forge-batch-');
    });
    expect(calls).toEqual(FULL_FORGE_ORDER);
    expect(result.map((recipe) => recipe.id)).toEqual([
      'forge-batch-shaft',
      'forge-batch-interface-box',
      'forge-batch-structure-frame',
    ]);
    // 过滤不修改权威配方表。
    expect(recipesFor(FORGE.id).map((recipe) => recipe.id)).toEqual(FULL_FORGE_ORDER);
  });

  it('全部锁定返回空列表；非加工机器同样返回空列表', () => {
    expect(availableRecipesFor(FORGE.id, () => false)).toEqual([]);
    expect(availableRecipesFor('crusher', () => false)).toEqual([]);
    expect(availableRecipesFor('crusher').map((recipe) => recipe.id)).toEqual(['crush-iron-ore']);
    expect(availableRecipesFor('chute')).toEqual([]);
  });
});

describe('activeRecipe：recipeId 指向已解锁配方时保持稳定', () => {
  it('新机器默认选中配方表第一条（无过滤器 = 全解锁）', () => {
    const state = createMachineState(0);
    expect(activeRecipe(state, FORGE)?.id).toBe('forge-shaft');
    ensureRecipeSelected(state, FORGE);
    expect(state.recipeId).toBe('forge-shaft');
    expect(state.recipeIndex).toBe(0);
  });

  it('recipeId 已解锁时优先于（过期/无关的）recipeIndex', () => {
    const state = createMachineState(0);
    state.recipeId = 'forge-gear-12';
    state.recipeIndex = 0;
    expect(activeRecipe(state, FORGE)?.id).toBe('forge-gear-12');
    // 新鲜解锁集合里仍然包含它，ensure 只把下标同步到权威位置。
    ensureRecipeSelected(state, FORGE);
    expect(state.recipeId).toBe('forge-gear-12');
    expect(state.recipeIndex).toBe(11);
    expect(activeRecipe(state, FORGE)?.id).toBe('forge-gear-12');
  });

  it('recipeId 指向未解锁配方时回退到当前可用配方，ensure 同步 recipeId', () => {
    const state = createMachineState(0);
    state.recipeId = 'forge-gear-12';
    state.recipeIndex = 0;
    const filter = filterOf(['forge-shaft', 'forge-chute']);
    expect(activeRecipe(state, FORGE, filter)?.id).toBe('forge-shaft');
    ensureRecipeSelected(state, FORGE, filter);
    expect(state.recipeId).toBe('forge-shaft');
    expect(state.recipeIndex).toBe(0);
  });

  it('全部配方锁定 / 非加工机器时没有生效配方', () => {
    const forgeState = createMachineState(0);
    expect(activeRecipe(forgeState, FORGE, () => false)).toBeUndefined();
    ensureRecipeSelected(forgeState, FORGE, () => false);
    expect(forgeState.recipeId).toBeNull();
    expect(forgeState.recipeIndex).toBe(0);

    const crusherState = createMachineState(1);
    expect(activeRecipe(crusherState, MECHANICAL_PART_DEFS.crusher)?.id).toBe('crush-iron-ore');
    expect(activeRecipe(crusherState, MECHANICAL_PART_DEFS.crusher, () => false)).toBeUndefined();
    const chuteState = createMachineState(2);
    expect(activeRecipe(chuteState, MECHANICAL_PART_DEFS.chute)).toBeUndefined();
  });
});

describe('cycleRecipe：跳过未解锁配方', () => {
  it('在解锁子集内按完整表顺序循环，未解锁配方被跳过', () => {
    const filter = filterOf(['forge-shaft', 'forge-chute', 'forge-gear-12']);
    const state = createMachineState(0);
    ensureRecipeSelected(state, FORGE, filter);
    expect(state.recipeId).toBe('forge-shaft');

    expect(cycleRecipe(state, FORGE, filter)).toBe(true);
    expect(state.recipeId).toBe('forge-chute');
    expect(state.recipeIndex).toBe(2);

    expect(cycleRecipe(state, FORGE, filter)).toBe(true);
    expect(state.recipeId).toBe('forge-gear-12');
    expect(state.recipeIndex).toBe(11);

    expect(cycleRecipe(state, FORGE, filter)).toBe(true);
    expect(state.recipeId).toBe('forge-shaft');
    expect(state.recipeIndex).toBe(0);
  });

  it('无过滤器时循环完整配方表（历史行为不变）', () => {
    const state = createMachineState(0);
    ensureRecipeSelected(state, FORGE);
    expect(cycleRecipe(state, FORGE)).toBe(true);
    expect(state.recipeId).toBe('forge-vertical-drive');
    expect(cycleRecipe(state, FORGE)).toBe(true);
    expect(state.recipeId).toBe('forge-chute');
  });

  it('只有一条配方/无配方时返回 false 且不改状态；只解锁一条时不会选到未解锁配方', () => {
    const onlyShaft = createMachineState(0);
    const shaftOnly = filterOf(['forge-shaft']);
    ensureRecipeSelected(onlyShaft, FORGE, shaftOnly);
    // 实现会在唯一可用配方上自环（返回 true），但绝不会落到未解锁配方。
    expect(cycleRecipe(onlyShaft, FORGE, shaftOnly)).toBe(true);
    expect(onlyShaft.recipeId).toBe('forge-shaft');
    expect(activeRecipe(onlyShaft, FORGE, shaftOnly)?.id).toBe('forge-shaft');

    const crusherState = createMachineState(1);
    expect(cycleRecipe(crusherState, MECHANICAL_PART_DEFS.crusher)).toBe(false);
    expect(crusherState.recipeId).toBeNull();

    const chuteState = createMachineState(2);
    expect(cycleRecipe(chuteState, MECHANICAL_PART_DEFS.chute)).toBe(false);
  });

  it('周期已开始（有进度或已缓冲原料）时拒绝切换', () => {
    const state = createMachineState(0);
    ensureRecipeSelected(state, FORGE);
    state.progress = 0.4;
    expect(cycleRecipe(state, FORGE)).toBe(false);
    expect(state.recipeId).toBe('forge-shaft');
    state.progress = 0;
    state.inputItem = 'iron_ingot';
    state.inputCount = 1;
    expect(cycleRecipe(state, FORGE)).toBe(false);
    expect(state.recipeId).toBe('forge-shaft');
  });
});

describe('D3 回归：解锁集合变化后 recipeId 不漂移', () => {
  it('新增解锁不会让已选中的机器改配方', () => {
    const unlocked = new Set(['forge-shaft', 'forge-chute']);
    const filter: RecipeFilter = (recipeId) => unlocked.has(recipeId);
    const state = createMachineState(0);
    ensureRecipeSelected(state, FORGE, filter);
    expect(cycleRecipe(state, FORGE, filter)).toBe(true);
    expect(state.recipeId).toBe('forge-chute');
    expect(state.recipeIndex).toBe(2);

    // 玩家后续解锁了更多配方（新条目追加在配方表末尾）。
    unlocked.add('forge-gear-12');
    unlocked.add('forge-batch-shaft');
    expect(activeRecipe(state, FORGE, filter)?.id).toBe('forge-chute');
    ensureRecipeSelected(state, FORGE, filter);
    expect(state.recipeId).toBe('forge-chute');
    expect(state.recipeIndex).toBe(2);
    expect(activeRecipe(state, FORGE, filter)?.id).toBe('forge-chute');
  });

  it('解锁之前未解锁的「前面」配方也不会改变 recipeId', () => {
    const unlocked = new Set(['forge-gear-12']);
    const filter: RecipeFilter = (recipeId) => unlocked.has(recipeId);
    const state = createMachineState(0);
    ensureRecipeSelected(state, FORGE, filter);
    expect(state.recipeId).toBe('forge-gear-12');

    unlocked.add('forge-shaft');
    unlocked.add('forge-chute');
    expect(activeRecipe(state, FORGE, filter)?.id).toBe('forge-gear-12');
    ensureRecipeSelected(state, FORGE, filter);
    expect(state.recipeId).toBe('forge-gear-12');
    expect(state.recipeIndex).toBe(11);
  });

  it('新机器在解锁集合增长前后都稳定选中第一条可用配方', () => {
    const unlocked = new Set(['forge-shaft']);
    const filter: RecipeFilter = (recipeId) => unlocked.has(recipeId);
    const state = createMachineState(0);
    expect(activeRecipe(state, FORGE, filter)?.id).toBe('forge-shaft');
    ensureRecipeSelected(state, FORGE, filter);
    expect(state.recipeId).toBe('forge-shaft');
    expect(state.recipeIndex).toBe(0);

    unlocked.add('forge-gear-12');
    unlocked.add('forge-batch-structure-frame');
    expect(activeRecipe(state, FORGE, filter)?.id).toBe('forge-shaft');
    ensureRecipeSelected(state, FORGE, filter);
    expect(state.recipeId).toBe('forge-shaft');
    expect(state.recipeIndex).toBe(0);
  });

  it('ensureRecipeSelected 不改变加工进度与输入缓冲', () => {
    const filter = filterOf(['forge-shaft', 'forge-chute']);
    const state = createMachineState(0);
    ensureRecipeSelected(state, FORGE, filter);
    state.progress = 0.5;
    state.inputItem = 'iron_ingot';
    state.inputCount = 1;
    ensureRecipeSelected(state, FORGE, filter);
    expect(state.recipeId).toBe('forge-shaft');
    expect(state.progress).toBe(0.5);
    expect(state.inputItem).toBe('iron_ingot');
    expect(state.inputCount).toBe(1);
  });
});
