import { describe, expect, it } from 'vitest';
import { getItemDefinition, itemDefinitions } from '../items/items.ts';
import { itemIconSvg } from '../frontend/icons.ts';
import { MECHANICAL_PART_DEFS, PROTOTYPE_KIT, PROTOTYPE_KIT_SLOTS, partDefForItem } from '../mechanical/parts.ts';
import { recipesFor } from '../production/recipes.ts';
import { STRUCTURE_MODULES, structureModuleForItem, structureModuleForPart } from '../industrial/assembly-module.ts';
import { validateIndustrialCatalog } from '../industrial/integrity.ts';

/**
 * P2-D 结构模块的**数据层**测试：真实物品、真实零件、配方、原型套件与数据完整性。
 * 组合运行时的行为见 `assembly-runtime.test.ts`；与加工/物流/动力的共存见
 * `assembly-compat.test.ts`。
 */

describe('结构模块静态定义', () => {
  it('至少有一个最小可用结构模块，ID/物品/零件稳定且互相绑定', () => {
    expect(STRUCTURE_MODULES.length).toBeGreaterThanOrEqual(1);
    const frame = structureModuleForPart('structure_frame');
    expect(frame).toBeDefined();
    expect(frame?.id).toBe('structure.frame');
    expect(frame?.label).toBe('结构框架');
    expect(frame?.itemId).toBe('structure_frame');
    expect(frame?.partId).toBe('structure_frame');
    expect(frame?.connection).toBe('orthogonal');
    expect(frame?.reach).toBe(1);
    expect(frame?.footprint).toEqual({ w: 1, d: 1 });
    expect(frame?.height).toBe(1);
    expect(frame?.connects).toContain('core');
    expect(frame?.connects).toContain('module');
    expect(structureModuleForItem('structure_frame')?.id).toBe('structure.frame');
  });

  it('结构框架是真实物品：可持有、可制造、有背包描述与图标', () => {
    const item = getItemDefinition('structure_frame');
    expect(item).toBeDefined();
    expect(item?.name).toBe('结构框架');
    expect(item?.maxStack).toBeGreaterThan(1);
    expect(item?.description).toContain('组合机械');
    expect(item?.description).toContain('P');
    expect(itemIconSvg('structure_frame')).toContain('<svg');
    expect(itemDefinitions().length).toBe(19);
  });

  it('结构框架是真实机械零件：kind=structure、无动力端口、不传递扭矩', () => {
    const def = MECHANICAL_PART_DEFS.structure_frame;
    expect(def.kind).toBe('structure');
    expect(def.itemId).toBe('structure_frame');
    expect(def.ports).toEqual([]);
    expect(def.maxTorque).toBe(0);
    expect(def.w).toBe(1);
    expect(def.d).toBe(1);
    expect(partDefForItem('structure_frame')?.id).toBe('structure_frame');
  });

  it('锻压机新增结构框架配方（真实制造）；配方表顺序保持历史条目在前', () => {
    const recipes = recipesFor('forge');
    expect(recipes.map((recipe) => recipe.id)).toEqual([
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
      // P2-E1：科技解锁配方追加在末尾。
      'forge-gear-12',
      'forge-gear-24',
      'forge-flywheel',
      'forge-batch-shaft',
      'forge-batch-interface-box',
      'forge-batch-structure-frame',
    ]);
    const recipe = recipes.find((entry) => entry.id === 'forge-structure-frame');
    expect(recipe?.inputs).toEqual([{ itemId: 'iron_ingot', count: 3 }]);
    expect(recipe?.outputs).toEqual([{ itemId: 'structure_frame', count: 1 }]);
    expect(recipe?.seconds).toBe(5);
  });

  it('结构框架不占快捷栏槽位（保持历史脚本依赖的空槽与 0-11 顺序），套件数量由插件发放', () => {
    expect(PROTOTYPE_KIT_SLOTS.some((entry) => entry.id === 'structure_frame')).toBe(false);
    expect(PROTOTYPE_KIT.structure_frame).toBe(0);
    expect(PROTOTYPE_KIT_SLOTS.filter((entry) => entry.slot === 5)).toHaveLength(0);
  });
});

describe('工业数据完整性（含 P2-D 结构模块约束）', () => {
  it('目录校验零问题：结构模块必须绑定真实物品/真实结构零件且几何一致', () => {
    expect(validateIndustrialCatalog()).toEqual([]);
  });
});
