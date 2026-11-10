/**
 * M2.0-P2-E3 数值平衡核算（纯函数、零引擎依赖）。
 *
 * 目的：把「一整局 Demo 到底要多少铁矿」从口头估算变成**可复算、可断言**的数据，
 * 供资源平衡（工作包 D）与资源守恒测试使用。所有材料当量都由真实配方表推导，
 * 不手写第二份价格表；科技交付成本直接读 12 个节点的 cost。
 *
 * 口径：1 铁矿石 = 1 铁锭当量（现有全链路 1:1，无收率损耗）。
 */
import { ITEM_IDS, type ItemId } from '../items/items.ts';
import { TECH_NODES } from '../tech/nodes.ts';
import { TECH_NODES_STAGE3 } from '../tech/nodes-stage3.ts';
import { MACHINE_RECIPES } from './recipes.ts';
import { INHERITED_WORKSHOP } from '../tech/start-kit.ts';

/** 基础资源：1 铁矿石直接计 1 当量；破碎/熔炼都是 1:1。 */
const BASE_VALUES: ReadonlyArray<readonly [ItemId, number]> = [
  [ITEM_IDS.IRON_ORE, 1],
  [ITEM_IDS.CRUSHED_ORE, 1],
  [ITEM_IDS.IRON_INGOT, 1],
];

/**
 * 由配方表推导每件物品的铁锭当量。
 * 迭代到稳定：配方都是「把已知当量的原料变成产物」，没有环。
 */
export function materialValueTable(): ReadonlyMap<ItemId, number> {
  const values = new Map<ItemId, number>(BASE_VALUES.map(([id, value]) => [id, value]));
  let changed = true;
  let guard = 0;
  while (changed && guard < 32) {
    changed = false;
    guard += 1;
    for (const list of Object.values(MACHINE_RECIPES)) {
      for (const recipe of list ?? []) {
        const out = recipe.outputs[0];
        if (out === undefined || out.count <= 0) continue;
        let total = 0;
        let known = true;
        for (const input of recipe.inputs) {
          const value = values.get(input.itemId);
          if (value === undefined) { known = false; break; }
          total += input.count * value;
        }
        if (!known) continue;
        const next = total / out.count;
        const previous = values.get(out.itemId);
        if (previous === undefined || Math.abs(previous - next) > 1e-9) {
          values.set(out.itemId, next);
          changed = true;
        }
      }
    }
  }
  return values;
}

/** 单件物品的铁锭当量；未知物品返回 undefined。 */
export function oreValueOf(itemId: string): number | undefined {
  return MATERIAL_VALUES.get(itemId as ItemId);
}

const MATERIAL_VALUES: ReadonlyMap<ItemId, number> = materialValueTable();

/**
 * 自建设备假设（Demo 全流程，不含科技交付里要求交付的成品）：
 * - 为满足「组合机械 >=3 核 + 多级产线」，在起步包 3 核之外再建 1 破碎机 + 1 熔炼炉；
 * - 第二台飞轮（独立动力网络，任务书 §2.2 明确允许）；
 * - 组合机械需要结构框架 2 个（交付的 3 个是交货品，不进世界）；
 * - 世界内真实物流：输入盒 2、输出盒 2、分流盒 1、合流盒 1；
 * - 溜槽 4、立式传动带 1。
 * 这些是「推荐解」的下限，玩家多建即多耗，审计按保守下限计。
 */
export const BUILD_REQUIREMENTS: ReadonlyArray<{ readonly itemId: ItemId; readonly count: number; readonly note: string }> = Object.freeze([
  { itemId: ITEM_IDS.CRUSHER, count: 1, note: '第二台破碎机（多级产线上游）' },
  { itemId: ITEM_IDS.SMELTER, count: 1, note: '第二台熔炼炉（并联产线）' },
  { itemId: ITEM_IDS.FLYWHEEL_SOURCE, count: 1, note: '第二动力网络（不并联）' },
  { itemId: ITEM_IDS.STRUCTURE_FRAME, count: 2, note: '把 >=3 核连成组合机械' },
  { itemId: ITEM_IDS.INTERFACE_BOX, count: 2, note: '输入接口盒（自动进料）' },
  { itemId: ITEM_IDS.OUTPUT_INTERFACE_BOX, count: 2, note: '输出接口盒（机器产物外送）' },
  { itemId: ITEM_IDS.SPLITTER_BOX, count: 1, note: '分流盒（一进两出）' },
  { itemId: ITEM_IDS.MERGER_BOX, count: 1, note: '合流盒（两进一出）' },
  { itemId: ITEM_IDS.CHUTE, count: 4, note: '重力溜槽（起步包 2 个之外的补充）' },
  { itemId: ITEM_IDS.VERTICAL_DRIVE, count: 1, note: '跨层传动（起步包 1 个之外的补充）' },
]);

/** 试错/返工预留（按经验给固定值，不随配置漂移）。 */
export const TRIAL_RESERVE_ORE = 15;

export interface DemoBalanceAudit {
  /** 12 个科技节点的交付成本（铁锭当量）。 */
  readonly techOre: number;
  /** 科技节点逐项。 */
  readonly techPerNode: ReadonlyArray<{ readonly id: string; readonly ore: number }>;
  /** 自建设备成本。 */
  readonly buildOre: number;
  /** 试错预留。 */
  readonly reserveOre: number;
  /** 毛需求 = 科技 + 自建 + 预留。 */
  readonly grossOre: number;
  /** 起步包能直接抵扣的交付材料当量（只算会被交付消耗的零件，不含机器/飞轮）。 */
  readonly starterCreditOre: number;
  /** 实际需要开采的矿石量。 */
  readonly miningOre: number;
  /** 世界供给（4 个矿点 × 单点储量）。 */
  readonly supplyOre: number;
  /** 供给 / 采矿需求。 */
  readonly marginRatio: number;
}

/** 起步包里会被科技交付直接消耗的零件（机器与飞轮留在世界使用，不计抵扣）。 */
const STARTER_CREDIT_ITEMS: ReadonlyArray<ItemId> = [
  ITEM_IDS.SHAFT, ITEM_IDS.GEAR_12, ITEM_IDS.GEAR_24, ITEM_IDS.CHUTE, ITEM_IDS.VERTICAL_DRIVE,
];

function starterCredit(): number {
  let credit = 0;
  for (const entry of INHERITED_WORKSHOP) {
    if (!STARTER_CREDIT_ITEMS.includes(entry.itemId)) continue;
    const value = oreValueOf(entry.itemId) ?? 0;
    credit += value * entry.count;
  }
  return credit;
}

/** 计算整局 Demo 的资源需求与供给对比。 */
export function auditDemoBalance(supplyOre: number): DemoBalanceAudit {
  const techPerNode: Array<{ id: string; ore: number }> = [];
  let techOre = 0;
  for (const node of TECH_NODES) {
    let ore = 0;
    for (const entry of node.cost) ore += (oreValueOf(entry.itemId) ?? 0) * entry.count;
    techPerNode.push({ id: node.id, ore });
    techOre += ore;
  }
  let buildOre = 0;
  for (const entry of BUILD_REQUIREMENTS) buildOre += (oreValueOf(entry.itemId) ?? 0) * entry.count;
  const grossOre = techOre + buildOre + TRIAL_RESERVE_ORE;
  const credit = starterCredit();
  const miningOre = grossOre - credit;
  return {
    techOre,
    techPerNode,
    buildOre,
    reserveOre: TRIAL_RESERVE_ORE,
    grossOre,
    starterCreditOre: credit,
    miningOre,
    supplyOre,
    marginRatio: miningOre > 0 ? supplyOre / miningOre : Number.POSITIVE_INFINITY,
  };
}

/** 终局成套交付清单（T3.3 节点 cost；用于交叉校验 16 件与总当量）。 */
export function combinedWorksDelivery(): ReadonlyArray<{ readonly itemId: string; readonly count: number }> {
  const node = TECH_NODES_STAGE3.find((entry) => entry.id === 'tech:combined-works');
  return (node?.cost ?? []).map((entry) => ({ itemId: entry.itemId, count: entry.count }));
}