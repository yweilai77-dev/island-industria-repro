/**
 * M2.0-P2-E1 科技树 · 阶段 3「初级自动化工业」（3 个节点）。
 * 数据来源：docs/m20/P2-E0-TECH-TREE-DESIGN.md §4.11–§4.13。
 * E1 只登记数据与解锁关系；终局运行证明与结算属于 E3。
 */
import { ITEM_IDS } from '../items/items.ts';
import type { TechNodeDef } from './types.ts';

export const TECH_NODES_STAGE3: readonly TechNodeDef[] = Object.freeze([
  {
    id: 'tech:batch-processing',
    name: '标准化批量加工',
    description: '同一批材料一次锻出多件产品，单机吞吐更高。',
    stage: 3,
    route: 'industry',
    purpose: '用标准化提升单机吞吐，让阶段 3 的产线在同样机器数量下产出更多。',
    requires: ['tech:core-replication'],
    cost: [
      { itemId: ITEM_IDS.SHAFT, count: 2 },
      { itemId: ITEM_IDS.GEAR_24, count: 2 },
      { itemId: ITEM_IDS.IRON_INGOT, count: 4 },
    ],
    unlocks: [
      { kind: 'recipe', id: 'forge-batch-shaft' },
      { kind: 'recipe', id: 'forge-batch-interface-box' },
      { kind: 'recipe', id: 'forge-batch-structure-frame' },
    ],
  },
  {
    id: 'tech:line-integration',
    name: '多级产线整合',
    description: '交付三台真实机器，证明你能制造并组织多级产线。',
    stage: 3,
    route: 'cross',
    purpose: '玩家必须证明自己「能造机器」——交三台样机，而不是交一堆矿石。',
    requires: ['tech:structure-assembly', 'tech:batch-processing'],
    cost: [
      { itemId: ITEM_IDS.CRUSHER, count: 1 },
      { itemId: ITEM_IDS.SMELTER, count: 1 },
      { itemId: ITEM_IDS.FORGE, count: 1 },
    ],
    unlocks: [{ kind: 'capability', id: 'line-diagnostics' }],
  },
  {
    id: 'tech:combined-works',
    name: '联合工厂总成',
    description: '交付成套工业设备，并证明组合机械产线真的在运转。',
    stage: 3,
    route: 'cross',
    purpose: 'Demo 终点：一座能持续运转的联合工厂，而不是一个结算数字。',
    requires: ['tech:line-integration'],
    cost: [
      { itemId: ITEM_IDS.SHAFT, count: 6 },
      { itemId: ITEM_IDS.INTERFACE_BOX, count: 3 },
      { itemId: ITEM_IDS.OUTPUT_INTERFACE_BOX, count: 1 },
      { itemId: ITEM_IDS.SPLITTER_BOX, count: 1 },
      { itemId: ITEM_IDS.MERGER_BOX, count: 1 },
      { itemId: ITEM_IDS.STRUCTURE_FRAME, count: 3 },
      { itemId: ITEM_IDS.VERTICAL_DRIVE, count: 1 },
    ],
    unlocks: [{ kind: 'project', id: 'combined-works' }],
  },
]);
