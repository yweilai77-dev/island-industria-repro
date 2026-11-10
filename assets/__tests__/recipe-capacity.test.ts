import { describe, expect, it } from 'vitest';
import { MACHINE_RECIPES, recipesFor } from '../production/recipes.ts';
import { inputCapacity, outputCapacity } from '../production/production.ts';
import { MECHANICAL_PART_DEFS } from '../mechanical/parts.ts';

/**
 * M2.0-P2-E3：机器缓冲容量 vs 配方「整笔原料/整笔产出」的契约。
 *
 * 加工状态机是「整笔扣料、整笔检查输出空间」：配方需要的原料总量必须放得进输入缓冲，
 * 单次产出总量必须放得进输出缓冲，否则该配方永远无法开工/永远无法完成。
 * 这个测试锁定 P2-E3 修复的真实缺陷：锻压机输入缓冲 6 装不下 7/8/12 件的配方。
 */
describe('machine buffer capacity covers every recipe', () => {
  for (const [partId, recipes] of Object.entries(MACHINE_RECIPES)) {
    if (!recipes || recipes.length === 0) continue;
    const def = MECHANICAL_PART_DEFS[partId as keyof typeof MECHANICAL_PART_DEFS];
    it(partId + ' input buffer fits every recipe batch', () => {
      expect(def, 'missing mechanical part def for ' + partId).toBeDefined();
      const capacity = inputCapacity(def!);
      for (const recipe of recipes) {
        const total = recipe.inputs.reduce((sum, entry) => sum + entry.count, 0);
        expect(total, partId + '/' + recipe.id + ' needs ' + total + ' input items, capacity ' + capacity)
          .toBeLessThanOrEqual(capacity);
      }
    });
    it(partId + ' output buffer fits every recipe batch', () => {
      const capacity = outputCapacity(def!);
      for (const recipe of recipes) {
        const total = recipe.outputs.reduce((sum, entry) => sum + entry.count, 0);
        expect(total, partId + '/' + recipe.id).toBeLessThanOrEqual(capacity);
      }
    });
  }

  it('keeps the forge able to craft the three heavy recipes used by T2.3/T2.4/T3.2', () => {
    const forge = recipesFor('forge');
    for (const id of ['forge-smelter', 'forge-processing-core', 'forge-flywheel', 'forge-crusher']) {
      const recipe = forge.find((entry) => entry.id === id);
      expect(recipe, id + ' must exist').toBeDefined();
      const total = recipe!.inputs.reduce((sum, entry) => sum + entry.count, 0);
      const def = MECHANICAL_PART_DEFS.forge;
      expect(total).toBeLessThanOrEqual(inputCapacity(def));
    }
  });
});