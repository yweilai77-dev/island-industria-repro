import { getItemDefinition } from '../items/items.ts';
import {
  MECHANICAL_PART_DEFS,
  PORT_HEIGHT,
  PRODUCTION_MACHINE_IDS,
  isProductionMachine,
} from '../mechanical/parts.ts';
import { inputCapacity, outputCapacity } from '../production/production.ts';
import { recipesFor } from '../production/recipes.ts';
import { INDUSTRIAL_CATALOG, type IndustrialCatalog } from './catalog.ts';
import { PORT_SLOT_ROLES, PROCESS_KINDS, isStableId } from './ids.ts';

/**
 * M2.0-P2-A 工业数据完整性校验（纯函数、零引擎依赖）。
 *
 * 目的：把所有「数据与环境必须一致」的约束集中成一份可执行清单，让 `pnpm test` 一次跑完。
 * 约束分三类：
 * 1. **ID 合法性 + 唯一性**：定义类 ID 必须匹配稳定 ID 格式，且全局不重复；
 * 2. **与现有真源一致**：额定动力、缓冲、几何、配方必须等于 parts.ts / recipes.ts 的实际值，
 *    接口盒不得提前绑定物品，安装位不得与机械动力端口同面、输出位必须在 +X；
 * 3. **静态/运行时不得混用**：静态定义里不得出现运行时字段名。
 *
 * 本函数不在引擎启动路径上跑（没有插件 import 它），只被测试与将来的工具调用。
 */

export interface IndustrialIssue {
  /** 机器可读的问题代码，例：`core.load-torque`。 */
  readonly code: string;
  /** 出问题的对象路径，例：`core:crusher`。 */
  readonly path: string;
  readonly message: string;
}

/** 静态定义里绝不允许出现的运行时字段名（防止把运行时状态写进定义表）。 */
const RUNTIME_ONLY_FIELDS: readonly string[] = Object.freeze([
  'entityId',
  'partId',
  'ports',
  'assemblyId',
  'progress',
  'running',
  'inputCount',
  'outputCount',
  'producedTotal',
  'powered',
  'stalled',
]);

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = sorted(left);
  const b = sorted(right);
  return a.every((value, index) => value === b[index]);
}

export function validateIndustrialCatalog(
  catalog: IndustrialCatalog = INDUSTRIAL_CATALOG,
): readonly IndustrialIssue[] {
  const issues: IndustrialIssue[] = [];
  const add = (code: string, path: string, message: string): void => {
    issues.push(Object.freeze({ code, path, message }));
  };

  // ---- 1. ID 格式与唯一性 -------------------------------------------------
  for (const core of catalog.cores) {
    if (!isStableId(core.id)) add('id.format', `core:${core.id}`, `core id must be a stable id: ${core.id}`);
  }
  for (const module of catalog.portModules) {
    if (!isStableId(module.id)) add('id.format', `module:${module.id}`, `port module id must be a stable id: ${module.id}`);
  }
  for (const entry of catalog.slotById.values()) {
    if (!isStableId(entry.slot.id)) add('id.format', `slot:${entry.slot.id}`, `slot id must be a stable id: ${entry.slot.id}`);
  }
  for (const recipe of catalog.recipes) {
    if (!isStableId(recipe.id)) add('id.format', `recipe:${recipe.id}`, `recipe id must be a stable id: ${recipe.id}`);
  }
  if (catalog.coreById.size !== catalog.cores.length) {
    add('id.duplicate-core', 'catalog.cores', 'duplicate core id detected');
  }
  if (catalog.portModuleById.size !== catalog.portModules.length) {
    add('id.duplicate-module', 'catalog.portModules', 'duplicate port module id detected');
  }
  const slotCount = catalog.cores.reduce((total, core) => total + core.portSlots.length, 0);
  if (catalog.slotById.size !== slotCount) {
    add('id.duplicate-slot', 'catalog.slotById', 'duplicate port slot id detected');
  }
  if (catalog.recipeById.size !== catalog.recipes.length) {
    add('id.duplicate-recipe', 'catalog.recipes', 'duplicate recipe id detected');
  }

  // ---- 2. 核心覆盖与派生一致性 -------------------------------------------
  if (catalog.cores.length !== PRODUCTION_MACHINE_IDS.length) {
    add(
      'core.count',
      'catalog.cores',
      `expected ${PRODUCTION_MACHINE_IDS.length} processing cores, got ${catalog.cores.length}`,
    );
  }
  for (const partId of PRODUCTION_MACHINE_IDS) {
    if (!catalog.coreByPartId.has(partId)) {
      add('core.part-missing', `part:${partId}`, `production machine ${partId} has no processing core definition`);
    }
  }

  for (const core of catalog.cores) {
    const path = `core:${core.id}`;
    const def = MECHANICAL_PART_DEFS[core.corePartId];
    if (!def) {
      add('core.part-missing', path, `corePartId ${core.corePartId} is not a registered mechanical part`);
      continue;
    }
    if (!isProductionMachine(def)) {
      add('core.part-not-production', path, `${core.corePartId} is not a production machine`);
    }
    if (def.loadTorque === undefined) {
      add('core.load-torque', path, `${core.corePartId} has no loadTorque in MechanicalPartDef`);
    } else if (core.ratedLoadTorque !== def.loadTorque) {
      add(
        'core.load-torque',
        path,
        `ratedLoadTorque ${core.ratedLoadTorque} must equal MechanicalPartDef.loadTorque ${def.loadTorque}`,
      );
    }
    if (!(core.ratedLoadTorque > 0) || !Number.isFinite(core.ratedLoadTorque)) {
      add('core.load-torque', path, 'ratedLoadTorque must be a positive finite number');
    }
    if (core.buffers.input !== inputCapacity(def)) {
      add('core.buffers', path, `input buffer ${core.buffers.input} must equal ${inputCapacity(def)}`);
    }
    if (core.buffers.output !== outputCapacity(def)) {
      add('core.buffers', path, `output buffer ${core.buffers.output} must equal ${outputCapacity(def)}`);
    }
    if (core.footprint.w !== def.w || core.footprint.d !== def.d) {
      add('core.geometry', path, `footprint ${core.footprint.w}x${core.footprint.d} must equal ${def.w}x${def.d}`);
    }
    if (core.height !== def.height) {
      add('core.geometry', path, `height ${core.height} must equal ${def.height}`);
    }
    if (!PROCESS_KINDS.includes(core.process)) {
      add('core.process-kind', path, `unknown process kind: ${core.process}`);
    }
    if (!(core.speedMultiplier > 0) || !Number.isFinite(core.speedMultiplier)) {
      add('core.speed', path, 'speedMultiplier must be a positive finite number');
    }
    const expectedRecipes = recipesFor(core.corePartId).map((recipe) => recipe.id);
    if (!sameList(expectedRecipes, core.recipeIds)) {
      add(
        'core.recipes',
        path,
        `recipeIds [${core.recipeIds.join(', ')}] must equal recipesFor(${core.corePartId}) [${expectedRecipes.join(', ')}]`,
      );
    }

    // 安装位
    const roleCount = (role: (typeof PORT_SLOT_ROLES)[number]): number =>
      core.portSlots.filter((slot) => slot.role === role).length;
    if (roleCount('input') === 0) add('slot.role-missing', path, 'core has no input port slot');
    if (roleCount('output') === 0) add('slot.role-missing', path, 'core has no output port slot');
    for (const slot of core.portSlots) {
      const slotPath = `slot:${slot.id}`;
      const expectedCapacity = slot.role === 'input' ? inputCapacity(def) : outputCapacity(def);
      if (slot.capacity !== expectedCapacity) {
        add('slot.capacity', slotPath, `capacity ${slot.capacity} must equal ${expectedCapacity}`);
      }
      if (slot.localY !== PORT_HEIGHT) {
        add('slot.local-y', slotPath, `localY ${slot.localY} must equal PORT_HEIGHT ${PORT_HEIGHT}`);
      }
      const { gx, gz } = slot.localCell;
      if (
        !Number.isInteger(gx) || !Number.isInteger(gz)
        || gx < 0 || gx >= def.w || gz < 0 || gz >= def.d
      ) {
        add('slot.local-cell', slotPath, `localCell (${gx}, ${gz}) is outside footprint ${def.w}x${def.d}`);
      }
      // 运行时 pushMachineOutputs() 固定把产物推到本地 +X；输出位必须与它一致。
      if (slot.role === 'output' && slot.face !== 'px') {
        add('slot.output-face', slotPath, `output slot must be on the 'px' face, got '${slot.face}'`);
      }
      // 三台机器的机械动力输入都在 nx；接口盒不得盖住传动轴。
      if (def.ports.some((port) => port.face === slot.face)) {
        add('slot.face-conflict', slotPath, `face '${slot.face}' is already used by a mechanical drive port`);
      }
    }
  }

  // ---- 3. 接口盒 ----------------------------------------------------------
  for (const module of catalog.portModules) {
    const path = `module:${module.id}`;
    // P2-B：基础直通盒已是真实物品（可在锻压机上制造、拿在背包里、安装到机器上）；
    // 分流/合流盒属于 P2-C 的拓扑能力，仍必须是「未接入物品」的纯定义。
    if (module.kind === 'through') {
      if (module.itemId === null) {
        add('module.item-required', path, 'the through module must bind a real item since P2-B');
      } else if (getItemDefinition(module.itemId) === undefined) {
        add('module.item-id', path, `unknown item id bound to port module: ${module.itemId}`);
      }
    } else if (module.itemId !== null) {
      add('module.item-null', path, 'splitter/merger modules must not bind a real item before P2-C');
    }
    if (module.inputs < 1 || module.outputs < 1) {
      add('module.flow', path, 'port module needs at least one input and one output');
    }
    if (module.kind === 'through' && (module.inputs !== 1 || module.outputs !== 1)) {
      add('module.kind-flow', path, 'through module must be 1 input / 1 output');
    }
    if (module.kind === 'splitter' && (module.inputs !== 1 || module.outputs < 2)) {
      add('module.kind-flow', path, 'splitter module must be 1 input / >=2 outputs');
    }
    if (module.kind === 'merger' && (module.inputs < 2 || module.outputs !== 1)) {
      add('module.kind-flow', path, 'merger module must be >=2 inputs / 1 output');
    }
    if (module.fitsSlotRoles.length === 0) {
      add('module.slot-roles', path, 'port module must fit at least one slot role');
    }
    for (const role of module.fitsSlotRoles) {
      if (!PORT_SLOT_ROLES.includes(role)) add('module.slot-roles', path, `unknown slot role: ${role}`);
    }
  }

  // ---- 4. 配方 ------------------------------------------------------------
  for (const definition of catalog.recipes) {
    const path = `recipe:${definition.id}`;
    const recipe = definition.recipe;
    if (!Number.isFinite(recipe.seconds) || recipe.seconds <= 0) {
      add('recipe.seconds', path, 'recipe seconds must be a positive finite number');
    }
    if (recipe.inputs.length === 0) add('recipe.items', path, 'recipe has no inputs');
    if (recipe.outputs.length === 0) add('recipe.items', path, 'recipe has no outputs');
    for (const ingredient of [...recipe.inputs, ...recipe.outputs]) {
      if (getItemDefinition(ingredient.itemId) === undefined) {
        add('recipe.items', path, `unknown item id: ${ingredient.itemId}`);
      }
      if (!Number.isInteger(ingredient.count) || ingredient.count <= 0) {
        add('recipe.count', path, `ingredient count must be a positive integer, got ${ingredient.count}`);
      }
    }
    if (!PROCESS_KINDS.includes(definition.process)) {
      add('recipe.process', path, `unknown process kind: ${definition.process}`);
    }
    if (definition.coreIds.length === 0) {
      add('recipe.process', path, 'recipe is not reachable from any processing core');
    }
    for (const coreId of definition.coreIds) {
      if (!catalog.coreById.has(coreId)) add('recipe.process', path, `unknown core id: ${coreId}`);
    }
  }

  // ---- 5. 静态定义不得混入运行时字段 ---------------------------------------
  for (const core of catalog.cores) {
    for (const field of RUNTIME_ONLY_FIELDS) {
      if (field in core) add('static.runtime-field', `core:${core.id}`, `static def must not carry runtime field '${field}'`);
    }
  }
  for (const module of catalog.portModules) {
    for (const field of RUNTIME_ONLY_FIELDS) {
      if (field in module) add('static.runtime-field', `module:${module.id}`, `static def must not carry runtime field '${field}'`);
    }
  }
  for (const entry of catalog.slotById.values()) {
    for (const field of RUNTIME_ONLY_FIELDS) {
      if (field in entry.slot) add('static.runtime-field', `slot:${entry.slot.id}`, `static slot must not carry runtime field '${field}'`);
    }
  }

  return Object.freeze(issues);
}
