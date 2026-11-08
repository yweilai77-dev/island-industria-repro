import type { PartId } from '../mechanical/parts.ts';
import { recipesFor, type Recipe } from '../production/recipes.ts';
import type { CoreId, PortModuleId, PortSlotId, ProcessKind, RecipeId } from './ids.ts';
import { PROCESSING_CORES, type PortSlotDef, type ProcessingCoreDef } from './processing-core.ts';
import { PORT_MODULES, type PortModuleDef } from './port-module.ts';

/**
 * M2.0-P2-A 工业目录：把散在各处的静态定义汇成**一个只读入口**，并补两个派生索引
 * （配方全局索引、安装位全局索引）。纯数据、零引擎依赖。
 *
 * 它只做三件事：
 * 1. 汇总：加工核心 / 接口盒 / 配方视图 / 安装位；
 * 2. 建索引：按稳定 ID 查询；
 * 3. 校验：`integrity.ts` 读取本目录做完整性与一致性检查（测试里跑，不在引擎启动路径上跑）。
 *
 * 它**不**创建任何运行时状态、不注册 Cordis 服务、不新增 GameRead。
 * 方向是单向的：本目录依赖现有模块，现有模块永不 import `assets/industrial/`。
 */

/**
 * 配方的派生视图：在现有 `Recipe` 之上补两件事 ——
 * 它属于哪门加工工艺（`process`），以及哪些加工核心能执行它（`coreIds`）。
 *
 * P2-D 会把 `process` 翻成配方自带的字段；在那之前它是从加工核心反推出来的。
 * `recipe` 指向 `assets/production/recipes.ts` 里的原对象（真源不复制）。
 */
export interface RecipeDefinition {
  /** 稳定 ID，即 `recipe.id`。 */
  readonly id: RecipeId;
  /** 原配方（真源：production/recipes.ts）。 */
  readonly recipe: Recipe;
  /** 加工工艺。 */
  readonly process: ProcessKind;
  /** 能执行该配方的加工核心（当前每配方恰好一个）。 */
  readonly coreIds: readonly CoreId[];
}

/** 安装位的全局索引项：安装位 + 它属于哪个核心。 */
export interface PortSlotEntry {
  readonly slot: PortSlotDef;
  readonly coreId: CoreId;
  readonly corePartId: PartId;
}

/** 工业目录（只读）。 */
export interface IndustrialCatalog {
  readonly cores: readonly ProcessingCoreDef[];
  readonly coreById: ReadonlyMap<CoreId, ProcessingCoreDef>;
  readonly coreByPartId: ReadonlyMap<PartId, ProcessingCoreDef>;
  readonly portModules: readonly PortModuleDef[];
  readonly portModuleById: ReadonlyMap<PortModuleId, PortModuleDef>;
  readonly recipes: readonly RecipeDefinition[];
  readonly recipeById: ReadonlyMap<RecipeId, RecipeDefinition>;
  readonly recipesByCore: ReadonlyMap<CoreId, readonly RecipeDefinition[]>;
  readonly slotById: ReadonlyMap<PortSlotId, PortSlotEntry>;
}

function buildRecipeDefinitions(): readonly RecipeDefinition[] {
  const byId = new Map<RecipeId, { recipe: Recipe; process: ProcessKind; coreIds: CoreId[] }>();
  for (const core of PROCESSING_CORES) {
    for (const recipe of recipesFor(core.corePartId)) {
      const existing = byId.get(recipe.id);
      if (existing) {
        if (!existing.coreIds.includes(core.id)) existing.coreIds.push(core.id);
        continue;
      }
      byId.set(recipe.id, { recipe, process: core.process, coreIds: [core.id] });
    }
  }
  return Object.freeze(
    [...byId.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([id, entry]) => Object.freeze({
        id,
        recipe: entry.recipe,
        process: entry.process,
        coreIds: Object.freeze([...entry.coreIds]),
      })),
  );
}

function buildCatalog(): IndustrialCatalog {
  const coreById = new Map<CoreId, ProcessingCoreDef>();
  const coreByPartId = new Map<PartId, ProcessingCoreDef>();
  const slotById = new Map<PortSlotId, PortSlotEntry>();
  for (const core of PROCESSING_CORES) {
    coreById.set(core.id, core);
    coreByPartId.set(core.corePartId, core);
    for (const slot of core.portSlots) {
      slotById.set(slot.id, Object.freeze({ slot, coreId: core.id, corePartId: core.corePartId }));
    }
  }

  const portModuleById = new Map<PortModuleId, PortModuleDef>();
  for (const module of PORT_MODULES) portModuleById.set(module.id, module);

  const recipes = buildRecipeDefinitions();
  const recipeById = new Map<RecipeId, RecipeDefinition>();
  const recipesByCoreMutable = new Map<CoreId, RecipeDefinition[]>();
  for (const core of PROCESSING_CORES) recipesByCoreMutable.set(core.id, []);
  for (const definition of recipes) {
    recipeById.set(definition.id, definition);
    for (const coreId of definition.coreIds) {
      const list = recipesByCoreMutable.get(coreId);
      if (list) list.push(definition);
    }
  }
  const recipesByCore = new Map<CoreId, readonly RecipeDefinition[]>();
  for (const [coreId, list] of recipesByCoreMutable) {
    recipesByCore.set(coreId, Object.freeze([...list]));
  }

  return Object.freeze({
    cores: PROCESSING_CORES,
    coreById,
    coreByPartId,
    portModules: PORT_MODULES,
    portModuleById,
    recipes,
    recipeById,
    recipesByCore,
    slotById,
  });
}

/** 唯一只读工业目录。 */
export const INDUSTRIAL_CATALOG: IndustrialCatalog = buildCatalog();

/** 按机械零件 ID 查加工核心；非加工机器返回 undefined。 */
export function coreForPart(partId: PartId): ProcessingCoreDef | undefined {
  return INDUSTRIAL_CATALOG.coreByPartId.get(partId);
}

/** 按核心 ID 查加工核心定义。 */
export function coreOfId(coreId: CoreId): ProcessingCoreDef | undefined {
  return INDUSTRIAL_CATALOG.coreById.get(coreId);
}

/** 某核心能执行的配方（派生视图，按 ID 排序）。 */
export function recipesForCore(coreId: CoreId): readonly RecipeDefinition[] {
  return INDUSTRIAL_CATALOG.recipesByCore.get(coreId) ?? [];
}

/** 按配方 ID 查派生视图。 */
export function recipeOfId(recipeId: RecipeId): RecipeDefinition | undefined {
  return INDUSTRIAL_CATALOG.recipeById.get(recipeId);
}

/** 按安装位 ID 查全局索引项。 */
export function slotOfId(slotId: PortSlotId): PortSlotEntry | undefined {
  return INDUSTRIAL_CATALOG.slotById.get(slotId);
}

/** 按接口盒 ID 查定义。 */
export function portModuleOfId(moduleId: PortModuleId): PortModuleDef | undefined {
  return INDUSTRIAL_CATALOG.portModuleById.get(moduleId);
}
