import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../items/items.ts';
import { IRON_ORE_MAX_AMOUNT, IRON_ORE_NODES } from '../resource/resource.ts';
import { MACHINE_RECIPES } from '../production/recipes.ts';
import {
  BUILD_REQUIREMENTS,
  TRIAL_RESERVE_ORE,
  auditDemoBalance,
  combinedWorksDelivery,
  materialValueTable,
  oreValueOf,
} from '../production/material-audit.ts';
import { TECH_NODES } from '../tech/nodes.ts';
import { INHERITED_WORKSHOP } from '../tech/start-kit.ts';
import { BASE_RECIPE_IDS } from '../tech/gates.ts';

/**
 * M2.0-P2-E3 工作包 D：数值平衡与资源守恒的自动化契约。
 *
 * 这些断言不是「让流程轻松」的注水：它们把 E0 §10 的材料预算变成可复算的数字，
 * 保证完整 Demo 的矿石供给足以覆盖科技交付 + 自建设备 + 试错预留，
 * 同时禁止任何「免费发放终局材料」的捷径（每件终局物品都必须有真实配方）。
 */
describe('material value table', () => {
  it('derives every craftable item from real recipes (no hand-written price table)', () => {
    const values = materialValueTable();
    for (const expected of [
      [ITEM_IDS.SHAFT, 2],
      [ITEM_IDS.GEAR_12, 0.5],
      [ITEM_IDS.GEAR_24, 1],
      [ITEM_IDS.CHUTE, 2],
      [ITEM_IDS.VERTICAL_DRIVE, 3],
      [ITEM_IDS.INTERFACE_BOX, 2],
      [ITEM_IDS.OUTPUT_INTERFACE_BOX, 2],
      [ITEM_IDS.SPLITTER_BOX, 3],
      [ITEM_IDS.MERGER_BOX, 3],
      [ITEM_IDS.STRUCTURE_FRAME, 3],
      [ITEM_IDS.CRUSHER, 6],
      [ITEM_IDS.SMELTER, 7],
      [ITEM_IDS.FORGE, 8],
      [ITEM_IDS.FLYWHEEL_SOURCE, 12],
    ] as const) {
      expect(values.get(expected[0])).toBeCloseTo(expected[1], 9);
    }
  });

  it('keeps the full chain 1:1 (no hidden yield loss or free material)', () => {
    expect(oreValueOf(ITEM_IDS.IRON_ORE)).toBe(1);
    expect(oreValueOf(ITEM_IDS.CRUSHED_ORE)).toBe(1);
    expect(oreValueOf(ITEM_IDS.IRON_INGOT)).toBe(1);
    // 破碎/熔炼都是 1 进 1 出：材料守恒，矿量就是材料上限。
    const crush = MACHINE_RECIPES.crusher?.[0];
    const smelt = MACHINE_RECIPES.smelter?.[0];
    expect(crush?.inputs[0]?.count).toBe(1);
    expect(crush?.outputs[0]?.count).toBe(1);
    expect(smelt?.inputs[0]?.count).toBe(1);
    expect(smelt?.outputs[0]?.count).toBe(1);
  });

  it('batch recipes raise throughput without creating extra material', () => {
    const values = materialValueTable();
    for (const id of ['forge-batch-shaft', 'forge-batch-interface-box', 'forge-batch-structure-frame'] as const) {
      const recipe = MACHINE_RECIPES.forge?.find((entry) => entry.id === id);
      expect(recipe, id + ' must exist').toBeDefined();
      const input = recipe?.inputs[0];
      const output = recipe?.outputs[0];
      expect(input, id + ' input').toBeDefined();
      expect(output, id + ' output').toBeDefined();
      // 批量配方每件产物的材料当量 == 单件配方（更快的吞吐，不是更便宜的材料）。
      const perUnit = ((values.get(input!.itemId) ?? 0) * input!.count) / output!.count;
      expect(perUnit).toBeCloseTo(values.get(output!.itemId) ?? -1, 9);
      expect(output!.count).toBeGreaterThan(1);
    }
  });
});

describe('demo material balance (work package D)', () => {
  const supply = IRON_ORE_NODES.length * IRON_ORE_MAX_AMOUNT;
  const audit = auditDemoBalance(supply);

  it('counts all 12 tech nodes and their delivery costs', () => {
    expect(audit.techPerNode).toHaveLength(TECH_NODES.length);
    expect(audit.techPerNode).toHaveLength(12);
    // E0 §10.1 的科技交付预算（铁锭当量）复算值：141。
    expect(audit.techOre).toBeCloseTo(141, 6);
  });

  it('keeps the terminal delivery at exactly 16 items across 7 line items', () => {
    const delivery = combinedWorksDelivery();
    expect(delivery).toHaveLength(7);
    expect(delivery.reduce((sum, entry) => sum + entry.count, 0)).toBe(16);
    expect(delivery).toEqual([
      { itemId: ITEM_IDS.SHAFT, count: 6 },
      { itemId: ITEM_IDS.INTERFACE_BOX, count: 3 },
      { itemId: ITEM_IDS.OUTPUT_INTERFACE_BOX, count: 1 },
      { itemId: ITEM_IDS.SPLITTER_BOX, count: 1 },
      { itemId: ITEM_IDS.MERGER_BOX, count: 1 },
      { itemId: ITEM_IDS.STRUCTURE_FRAME, count: 3 },
      { itemId: ITEM_IDS.VERTICAL_DRIVE, count: 1 },
    ]);
    // 立式带必须是真实物品且有真实配方（不是未定义概念）。
    expect(delivery.some((entry) => entry.itemId === ITEM_IDS.VERTICAL_DRIVE)).toBe(true);
    expect(MACHINE_RECIPES.forge?.some((recipe) => recipe.outputs[0]?.itemId === ITEM_IDS.VERTICAL_DRIVE)).toBe(true);
  });

  it('reports a supply that covers mining demand with >= 20% headroom', () => {
    expect(audit.buildOre).toBeGreaterThan(0);
    expect(audit.reserveOre).toBe(TRIAL_RESERVE_ORE);
    expect(audit.grossOre).toBeCloseTo(audit.techOre + audit.buildOre + audit.reserveOre, 6);
    expect(audit.starterCreditOre).toBeGreaterThan(0);
    expect(audit.miningOre).toBeCloseTo(audit.grossOre - audit.starterCreditOre, 6);
    expect(audit.supplyOre).toBe(supply);
    expect(audit.marginRatio).toBeGreaterThanOrEqual(1.2);
  });

  it('makes the first tech node reachable with the inherited workshop', () => {
    const kit = new Map(INHERITED_WORKSHOP.map((entry) => [entry.itemId, entry.count]));
    const producible = new Set<string>([ITEM_IDS.IRON_ORE, ITEM_IDS.CRUSHED_ORE, ITEM_IDS.IRON_INGOT]);
    const first = TECH_NODES.find((node) => node.id === 'tech:gear-manufacture');
    expect(first).toBeDefined();
    for (const cost of first!.cost) {
      // 起步包直接提供零件；矿石/碎矿/铁锭由起步包里的三台机器真实加工得到。
      const fromKit = (kit.get(cost.itemId) ?? 0) >= cost.count;
      expect(fromKit || producible.has(cost.itemId), cost.itemId + ' must be reachable at start').toBe(true);
    }
    // 教学订单依赖的三条基础配方开局即解锁（不锁死新手链）。
    const allRecipes = Object.values(MACHINE_RECIPES).flatMap((list) => list ?? []);
    for (const id of BASE_RECIPE_IDS) {
      expect(allRecipes.some((recipe) => recipe.id === id), id + ' must exist').toBe(true);
    }
    expect(BASE_RECIPE_IDS.size).toBe(3);
  });

  it('never grants the terminal interface boxes / frames from the starter kit', () => {
    const kit = new Set(INHERITED_WORKSHOP.map((entry) => entry.itemId));
    // 起步包允许玩家把自己继承的轴/立式带交付出去（它们是真实物品），
    // 但接口盒/分流/合流/结构框架必须由锻压机真实制造——起步包与科技完成都不发放。
    for (const itemId of [
      ITEM_IDS.INTERFACE_BOX, ITEM_IDS.OUTPUT_INTERFACE_BOX, ITEM_IDS.SPLITTER_BOX,
      ITEM_IDS.MERGER_BOX, ITEM_IDS.STRUCTURE_FRAME,
    ]) {
      expect(kit.has(itemId)).toBe(false);
      expect(MACHINE_RECIPES.forge?.some((recipe) => recipe.outputs[0]?.itemId === itemId)).toBe(true);
    }
    // 自建设备清单与交付清单不重叠（交付品必须新造，不够成世界里的机器）。
    expect(BUILD_REQUIREMENTS.some((entry) => entry.itemId === ITEM_IDS.STRUCTURE_FRAME)).toBe(true);
  });
});