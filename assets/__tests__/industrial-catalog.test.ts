import { describe, expect, it } from 'vitest';
import {
  INDUSTRIAL_CATALOG,
  coreForPart,
  coreOfId,
  portModuleOfId,
  recipeOfId,
  recipesForCore,
  slotOfId,
  type IndustrialCatalog,
} from '../industrial/catalog.ts';
import { validateIndustrialCatalog } from '../industrial/integrity.ts';
import { isStableId, type CoreId } from '../industrial/ids.ts';
import { PORT_MODULES } from '../industrial/port-module.ts';
import { PROCESSING_CORES, type ProcessingCoreDef } from '../industrial/processing-core.ts';

/**
 * M2.0-P2-A 工业目录：ID 唯一性、数据完整性、索引可反查、定义深度冻结。
 * 全部为纯逻辑测试，不启动引擎。
 */

function definitionIds(): readonly string[] {
  return [
    ...INDUSTRIAL_CATALOG.cores.map((core) => core.id),
    ...INDUSTRIAL_CATALOG.portModules.map((module) => module.id),
    ...[...INDUSTRIAL_CATALOG.slotById.values()].map((entry) => entry.slot.id),
    ...INDUSTRIAL_CATALOG.recipes.map((recipe) => recipe.id),
  ];
}

/** 用一份被改坏的目录验证校验器确实会报问题（防止出现「永远返回空」的假校验）。 */
function catalogWithCore(partIndex: number, mutate: (core: ProcessingCoreDef) => ProcessingCoreDef): IndustrialCatalog {
  const cores = INDUSTRIAL_CATALOG.cores.map((core, index) => (index === partIndex ? mutate(core) : core));
  return {
    ...INDUSTRIAL_CATALOG,
    cores,
    coreById: new Map(cores.map((core) => [core.id, core])),
    coreByPartId: new Map(cores.map((core) => [core.corePartId, core])),
  };
}

describe('工业目录：完整性', () => {
  it('真实目录的完整性校验零问题', () => {
    expect(validateIndustrialCatalog()).toEqual([]);
  });

  it('校验器能报出额定动力与零件定义不一致', () => {
    const catalog = catalogWithCore(0, (core) => ({ ...core, ratedLoadTorque: core.ratedLoadTorque + 1 }));
    expect(validateIndustrialCatalog(catalog).map((issue) => issue.code)).toContain('core.load-torque');
  });

  it('校验器能报出输出安装位不在 +X 面', () => {
    const catalog = catalogWithCore(0, (core) => ({
      ...core,
      portSlots: Object.freeze(core.portSlots.map((slot) =>
        (slot.role === 'output' ? Object.freeze({ ...slot, face: 'pz' as const }) : slot))),
    }));
    expect(validateIndustrialCatalog(catalog).map((issue) => issue.code)).toContain('slot.output-face');
  });

  it('校验器能报出安装位盖住机械动力端口', () => {
    const catalog = catalogWithCore(0, (core) => ({
      ...core,
      portSlots: Object.freeze(core.portSlots.map((slot) =>
        (slot.role === 'input' ? Object.freeze({ ...slot, face: 'nx' as const }) : slot))),
    }));
    expect(validateIndustrialCatalog(catalog).map((issue) => issue.code)).toContain('slot.face-conflict');
  });

  it('校验器能报出配方列表与现有配方不一致', () => {
    const catalog = catalogWithCore(0, (core) => ({ ...core, recipeIds: Object.freeze([] as const) }));
    expect(validateIndustrialCatalog(catalog).map((issue) => issue.code)).toContain('core.recipes');
  });
});

describe('工业目录：稳定 ID', () => {
  it('全部定义类 ID 符合稳定 ID 格式', () => {
    const ids = definitionIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(isStableId(id)).toBe(true);
  });

  it('全部定义类 ID 全局唯一', () => {
    const ids = definitionIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('加工核心 / 接口盒的 ID 使用各自命名空间', () => {
    expect(INDUSTRIAL_CATALOG.cores.map((core) => core.id)).toEqual([
      'core.crusher',
      'core.smelter',
      'core.forge',
    ]);
    expect(INDUSTRIAL_CATALOG.portModules.map((module) => module.id)).toEqual([
      'port.through',
      'port.output',
      'port.splitter',
      'port.merger',
    ]);
    // 核心 ID 不能与机械零件 ID 同名，两者在类型层是不同概念。
    for (const core of INDUSTRIAL_CATALOG.cores) {
      expect(core.id).toBe(`core.${core.corePartId}`);
      expect(core.id).not.toBe(core.corePartId);
    }
  });

  it('安装位 ID 编码核心名、方向与面', () => {
    for (const core of INDUSTRIAL_CATALOG.cores) {
      for (const slot of core.portSlots) {
        const short = core.id.slice('core.'.length);
        const direction = slot.role === 'input' ? 'in' : 'out';
        expect(slot.id).toBe(`slot.${short}.${direction}.${slot.face}`);
      }
    }
  });
});

describe('工业目录：索引可反查', () => {
  it('核心可按 ID 与机械零件双向反查', () => {
    for (const core of PROCESSING_CORES) {
      expect(coreOfId(core.id)).toBe(core);
      expect(coreForPart(core.corePartId)).toBe(core);
    }
    expect(coreForPart('shaft')).toBeUndefined();
  });

  it('配方索引覆盖现有全部配方，且能从核心反查', () => {
    expect(INDUSTRIAL_CATALOG.recipes.map((recipe) => recipe.id)).toEqual([
      'crush-iron-ore',
      'forge-chute',
      'forge-crusher',
      'forge-interface-box',
      'forge-merger-box',
      'forge-output-box',
      'forge-processing-core',
      'forge-shaft',
      'forge-smelter',
      'forge-splitter-box',
      'forge-vertical-drive',
      'smelt-crushed-ore',
    ]);
    for (const definition of INDUSTRIAL_CATALOG.recipes) {
      expect(recipeOfId(definition.id)).toBe(definition);
      expect(definition.coreIds).toHaveLength(1);
      const coreId = definition.coreIds[0] as CoreId;
      expect(recipesForCore(coreId)).toContain(definition);
    }
    expect(recipeOfId('not-a-recipe')).toBeUndefined();
  });

  it('安装位可按 ID 反查到所属核心', () => {
    for (const core of INDUSTRIAL_CATALOG.cores) {
      for (const slot of core.portSlots) {
        const entry = slotOfId(slot.id);
        expect(entry?.slot).toBe(slot);
        expect(entry?.coreId).toBe(core.id);
        expect(entry?.corePartId).toBe(core.corePartId);
      }
    }
  });

  it('接口盒可按 ID 反查，四种功能齐全', () => {
    expect(portModuleOfId('port.through')?.kind).toBe('through');
    expect(portModuleOfId('port.output')?.kind).toBe('through');
    expect(portModuleOfId('port.splitter')?.kind).toBe('splitter');
    expect(portModuleOfId('port.merger')?.kind).toBe('merger');
    expect(PORT_MODULES).toHaveLength(4);
  });
});

describe('工业目录：静态定义不可变', () => {
  it('核心、安装位、接口盒、配方视图均深度冻结', () => {
    for (const core of PROCESSING_CORES) {
      expect(Object.isFrozen(core)).toBe(true);
      expect(Object.isFrozen(core.portSlots)).toBe(true);
      expect(Object.isFrozen(core.recipeIds)).toBe(true);
      expect(Object.isFrozen(core.buffers)).toBe(true);
      expect(Object.isFrozen(core.footprint)).toBe(true);
      for (const slot of core.portSlots) {
        expect(Object.isFrozen(slot)).toBe(true);
        expect(Object.isFrozen(slot.localCell)).toBe(true);
      }
    }
    for (const module of PORT_MODULES) {
      expect(Object.isFrozen(module)).toBe(true);
      expect(Object.isFrozen(module.fitsSlotRoles)).toBe(true);
    }
    for (const definition of INDUSTRIAL_CATALOG.recipes) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.coreIds)).toBe(true);
    }
  });

  it('改写静态定义会抛错（ESM 严格模式）', () => {
    const core = PROCESSING_CORES[0] as ProcessingCoreDef;
    expect(() => { (core as unknown as { label: string }).label = '被改了'; }).toThrow(TypeError);
    expect(core.label).not.toBe('被改了');
  });
});
