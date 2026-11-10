import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import { INDUSTRIAL_CATALOG, coreForPart, recipeOfId } from '../industrial/catalog.ts';
import { getItemDefinition, itemDefinitions } from '../items/items.ts';
import {
  MECHANICAL_PART_DEFS,
  PRODUCTION_MACHINE_IDS,
  type MechanicalPart,
  type PartId,
} from '../mechanical/parts.ts';
import type { Connection } from '../mechanical/ports.ts';
import { buildPowerTopology, solvePower } from '../mechanical/power.ts';
import { inputCapacity, outputCapacity } from '../production/production.ts';
import { CRUSH_RECIPE, FORGE_SHAFT_RECIPE, recipesFor } from '../production/recipes.ts';
import { chuteDirectionOf } from '../production/transport.ts';

/**
 * M2.0-P2-A 新旧兼容测试：证明工业数据层与现有运行时**逐项一致**。
 *
 * 这里的断言全部是「等值/等价」检查，不是行为变更检查：
 * 如果哪天有人改了 parts.ts / recipes.ts 而没同步工业定义，这些测试会先红。
 */

function part(id: number, defId: PartId): MechanicalPart {
  return {
    id,
    def: MECHANICAL_PART_DEFS[defId],
    placement: createPlacement(id, 0, 1, 1, 0, 0),
  };
}

function edge(a: number, b: number): Connection {
  return {
    id: `${a}-${b}`,
    aPartId: a,
    bPartId: b,
    aPortId: 'p',
    bPortId: 'p',
    kind: 'axial',
    ratio: 1,
  };
}

describe('工业数据 ↔ 现有零件定义', () => {
  it('每个加工核心的派生字段都与 MechanicalPartDef 相等', () => {
    for (const core of INDUSTRIAL_CATALOG.cores) {
      const def = MECHANICAL_PART_DEFS[core.corePartId];
      expect(core.label).toBe(def.label);
      expect(core.ratedLoadTorque).toBe(def.loadTorque);
      expect(core.buffers.input).toBe(inputCapacity(def));
      expect(core.buffers.output).toBe(outputCapacity(def));
      expect(core.footprint.w).toBe(def.w);
      expect(core.footprint.d).toBe(def.d);
      expect(core.height).toBe(def.height);
    }
  });

  it('加工核心集合与 PRODUCTION_MACHINE_IDS 一一对应，不收录非加工机器', () => {
    expect(INDUSTRIAL_CATALOG.cores.map((core) => core.corePartId)).toEqual([...PRODUCTION_MACHINE_IDS]);
    expect(coreForPart('machine')).toBeUndefined();
    expect(coreForPart('chute')).toBeUndefined();
    expect(coreForPart('flywheel_source')).toBeUndefined();
  });

  it('速度倍率当前一律 1（与现有加工时长行为完全一致）', () => {
    for (const core of INDUSTRIAL_CATALOG.cores) expect(core.speedMultiplier).toBe(1);
  });
});

describe('工业数据 ↔ 现有配方', () => {
  it('每个核心的配方列表与 recipesFor 完全一致，且顺序保持（R 键切换顺序不变）', () => {
    for (const core of INDUSTRIAL_CATALOG.cores) {
      const expected = recipesFor(core.corePartId).map((recipe) => recipe.id);
      expect(core.recipeIds).toEqual(expected);
    }
    // 锻压机有 10 条配方（P2-B 追加基础接口盒；P2-C 追加输出/分流/合流盒与三种核心复制配方），
    // 切换顺序是历史验收行为，前 4 条不能变。
    expect(coreForPart('forge')?.recipeIds).toEqual([
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
    ]);
  });

  it('配方 ID 与配方对象都没有被改名或复制', () => {
    expect(recipeOfId('crush-iron-ore')?.recipe).toBe(CRUSH_RECIPE);
    expect(recipeOfId('forge-shaft')?.recipe).toBe(FORGE_SHAFT_RECIPE);
    for (const core of INDUSTRIAL_CATALOG.cores) {
      for (const recipe of recipesFor(core.corePartId)) {
        expect(recipeOfId(recipe.id)?.recipe).toBe(recipe);
      }
    }
  });

  it('配方工艺归属成立：破碎/熔炼/锻造各归其核心', () => {
    expect(recipeOfId('crush-iron-ore')?.process).toBe('crushing');
    expect(recipeOfId('smelt-crushed-ore')?.process).toBe('smelting');
    expect(recipeOfId('forge-shaft')?.process).toBe('forging');
    expect(recipeOfId('forge-vertical-drive')?.process).toBe('forging');
    expect(recipeOfId('forge-chute')?.process).toBe('forging');
  });
});

describe('工业数据 ↔ 现有动力网络', () => {
  it('三台加工核心的动力需求相加 = 64 N·m，且现有 solver 直接给出同一个数', () => {
    const expectedLoad = (MECHANICAL_PART_DEFS.crusher.loadTorque as number)
      + (MECHANICAL_PART_DEFS.smelter.loadTorque as number)
      + (MECHANICAL_PART_DEFS.forge.loadTorque as number);
    const industrialLoad = INDUSTRIAL_CATALOG.cores.reduce((total, core) => total + core.ratedLoadTorque, 0);
    expect(industrialLoad).toBe(expectedLoad);
    expect(industrialLoad).toBe(64);

    // 真实 solver：飞轮源(140) → 轴 → 三台加工机器。手写拓扑，不依赖网格摆放。
    const parts = [
      part(1, 'flywheel_source'),
      part(2, 'shaft'),
      part(3, 'crusher'),
      part(4, 'smelter'),
      part(5, 'forge'),
    ];
    const connections = [edge(1, 2), edge(2, 3), edge(2, 4), edge(2, 5)];
    const topology = buildPowerTopology(parts, connections, 1);
    expect(topology.components).toHaveLength(1);
    const solution = solvePower(topology, parts, new Set([1]));
    expect(solution.components[0]?.status).toBe('powered');
    expect(solution.demandByComponent.get(0)).toBeCloseTo(industrialLoad, 12);
    expect(solution.poweredMachines.size).toBe(3);
    // 速度下垂：1 − 64/140。
    expect(solution.speedFactorByComponent.get(0)).toBeCloseTo(1 - industrialLoad / 140, 12);
  });
});

describe('工业数据 ↔ 现有物料方向', () => {
  it('运行时产物固定推向本地 +X', () => {
    // production-runtime 的 pushMachineOutputs 用同一套 rotation → 世界方向映射。
    expect(chuteDirectionOf(0)).toEqual({ dx: 1, dz: 0 });
    expect(chuteDirectionOf(90)).toEqual({ dx: 0, dz: -1 });
    expect(chuteDirectionOf(180)).toEqual({ dx: -1, dz: 0 });
    expect(chuteDirectionOf(270)).toEqual({ dx: 0, dz: 1 });
  });

  it('每个核心的输出安装位都在 +X 面，与推料方向一致', () => {
    for (const core of INDUSTRIAL_CATALOG.cores) {
      const outputs = core.portSlots.filter((slot) => slot.role === 'output');
      expect(outputs).toHaveLength(1);
      expect(outputs[0]?.face).toBe('px');
    }
  });

  it('安装位不占用机械动力端口所在的面', () => {
    for (const core of INDUSTRIAL_CATALOG.cores) {
      const driveFaces = new Set(MECHANICAL_PART_DEFS[core.corePartId].ports.map((port) => port.face));
      for (const slot of core.portSlots) expect(driveFaces.has(slot.face)).toBe(false);
    }
  });
});

describe('接口盒物品接入（P2-C）', () => {
  it('物品总数 19：P2-C 三种新接口盒 + P2-D 结构框架', () => {
    expect(itemDefinitions()).toHaveLength(19);
  });

  it('四种接口盒全部绑定真实物品，且分属明确的输入/输出功能', () => {
    const byId = new Map(INDUSTRIAL_CATALOG.portModules.map((module) => [module.id, module]));
    expect(byId.get('port.through')?.itemId).toBe('interface_box');
    expect(byId.get('port.output')?.itemId).toBe('output_interface_box');
    expect(byId.get('port.splitter')?.itemId).toBe('splitter_box');
    expect(byId.get('port.merger')?.itemId).toBe('merger_box');
    for (const module of INDUSTRIAL_CATALOG.portModules) {
      expect(module.itemId).not.toBeNull();
      expect(getItemDefinition(module.itemId ?? 'iron_ore')).toBeDefined();
    }
    // 输入/输出是明确区分的功能类型：输出盒不能装输入位，合流盒不能装输出位。
    expect(byId.get('port.output')?.fitsSlotRoles).toEqual(['output']);
    expect(byId.get('port.splitter')?.fitsSlotRoles).toEqual(['output']);
    expect(byId.get('port.merger')?.fitsSlotRoles).toEqual(['input']);
  });

  it('新接口盒都能由锻压机真实制造', () => {
    expect(recipeOfId('forge-output-box')?.recipe.outputs).toEqual([
      { itemId: 'output_interface_box', count: 1 },
    ]);
    expect(recipeOfId('forge-splitter-box')?.recipe.outputs).toEqual([
      { itemId: 'splitter_box', count: 1 },
    ]);
    expect(recipeOfId('forge-merger-box')?.recipe.outputs).toEqual([
      { itemId: 'merger_box', count: 1 },
    ]);
  });

  it('加工核心复制配方只产出既有零件，不新增机器种类', () => {
    expect(recipeOfId('forge-crusher')?.recipe.outputs).toEqual([{ itemId: 'crusher', count: 1 }]);
    expect(recipeOfId('forge-smelter')?.recipe.outputs).toEqual([{ itemId: 'smelter', count: 1 }]);
    expect(recipeOfId('forge-processing-core')?.recipe.outputs).toEqual([{ itemId: 'forge', count: 1 }]);
  });
});
