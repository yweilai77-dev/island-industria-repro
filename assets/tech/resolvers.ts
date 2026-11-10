/**
 * M2.0-P2-E1 科技数据校验使用的「目录存在性解析器」。
 * 把科技层与真实物品/配方/机器/接口盒/结构模块目录连起来，避免科技数据引用不存在的对象。
 */
import { getItemDefinition, type ItemId } from '../items/items.ts';
import { MACHINE_RECIPES } from '../production/recipes.ts';
import { MECHANICAL_PART_DEFS } from '../mechanical/parts.ts';
import { portModuleOfId } from '../industrial/port-module.ts';
import { STRUCTURE_MODULES } from '../industrial/assembly-module.ts';
import type { TechValidationResolvers } from './validate.ts';

/** 基于真实目录的校验解析器（纯数据、无引擎依赖）。 */
export function createCatalogResolvers(): TechValidationResolvers {
  const recipeIds = new Set<string>();
  for (const list of Object.values(MACHINE_RECIPES)) {
    for (const recipe of list ?? []) recipeIds.add(recipe.id);
  }
  const partIds = new Set<string>(Object.keys(MECHANICAL_PART_DEFS));
  const portIds = new Set<string>();
  const structureIds = new Set<string>();
  return {
    itemExists: (id) => getItemDefinition(id as ItemId) !== undefined,
    recipeExists: (id) => recipeIds.has(id),
    partExists: (id) => partIds.has(id),
    portExists: (id) => portModuleOfId(id as never) !== undefined || portIds.has(id),
    structureExists: (id) => structureIds.has(id) || STRUCTURE_MODULES.some((module) => module.id === id),
  };
}
