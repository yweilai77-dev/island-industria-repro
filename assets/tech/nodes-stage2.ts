/**
 * M2.0-P2-E1 科技树 · 阶段 2「机械化生产」（5 个节点）。
 * 数据来源：docs/m20/P2-E0-TECH-TREE-DESIGN.md §4.6–§4.10。
 */
import { ITEM_IDS } from '../items/items.ts';
import type { TechNodeDef } from './types.ts';

export const TECH_NODES_STAGE2: readonly TechNodeDef[] = Object.freeze([
  {
    id: 'tech:output-interface',
    name: '输出接口与物料连接',
    description: '输出接口盒 + 物料连接，把产物送到下游核心。',
    stage: 2,
    route: 'industry',
    purpose: '打通「机器 → 接口 → 连接 → 机器」的完整物料流。',
    requires: ['tech:input-interface'],
    cost: [
      { itemId: ITEM_IDS.INTERFACE_BOX, count: 2 },
      { itemId: ITEM_IDS.IRON_INGOT, count: 4 },
    ],
    unlocks: [
      { kind: 'recipe', id: 'forge-output-box' },
      { kind: 'port', id: 'port.output' },
      { kind: 'capability', id: 'port-output-install' },
      { kind: 'capability', id: 'material-link' },
    ],
  },
  {
    id: 'tech:split-merge',
    name: '分流与合流',
    description: '一路进两路出、两路进一路出，产线开始有拓扑结构。',
    stage: 2,
    route: 'industry',
    purpose: '让一条线可以分叉或汇合。',
    requires: ['tech:output-interface'],
    cost: [
      { itemId: ITEM_IDS.OUTPUT_INTERFACE_BOX, count: 1 },
      { itemId: ITEM_IDS.INTERFACE_BOX, count: 1 },
      { itemId: ITEM_IDS.IRON_INGOT, count: 3 },
    ],
    unlocks: [
      { kind: 'recipe', id: 'forge-splitter-box' },
      { kind: 'recipe', id: 'forge-merger-box' },
      { kind: 'port', id: 'port.splitter' },
      { kind: 'port', id: 'port.merger' },
      { kind: 'capability', id: 'split-merge' },
    ],
  },
  {
    id: 'tech:core-replication',
    name: '加工核心批量制造',
    description: '用锻压机复制破碎机、熔炼炉与锻压机。',
    stage: 2,
    route: 'industry',
    purpose: '从「只有一套设备」到「能开第二车间」。',
    requires: ['tech:output-interface'],
    cost: [
      { itemId: ITEM_IDS.SHAFT, count: 1 },
      { itemId: ITEM_IDS.GEAR_12, count: 2 },
      { itemId: ITEM_IDS.IRON_INGOT, count: 4 },
    ],
    unlocks: [
      { kind: 'recipe', id: 'forge-crusher' },
      { kind: 'recipe', id: 'forge-smelter' },
      { kind: 'recipe', id: 'forge-processing-core' },
    ],
  },
  {
    id: 'tech:flywheel-production',
    name: '飞轮储能机制造',
    description: '制造第二台手摇飞轮储能机（独立动力网络，不是并联增容）。',
    stage: 2,
    route: 'power',
    purpose: '动力从「只有一台」到「可以扩容」：多机产线的功率瓶颈第一次可被工程手段解决。',
    requires: ['tech:cross-level-drive'],
    cost: [
      { itemId: ITEM_IDS.GEAR_24, count: 2 },
      { itemId: ITEM_IDS.SHAFT, count: 2 },
      { itemId: ITEM_IDS.IRON_INGOT, count: 3 },
    ],
    unlocks: [{ kind: 'recipe', id: 'forge-flywheel' }],
  },
  {
    id: 'tech:structure-assembly',
    name: '结构框架与组合机械',
    description: '用结构框架把多台核心组织成一个可整体识别的组合机械。',
    stage: 2,
    route: 'cross',
    purpose: '把「一堆机器」变成「一个车间」：可整体识别、可整体查看、可拆解恢复。',
    requires: ['tech:split-merge', 'tech:flywheel-production'],
    cost: [
      { itemId: ITEM_IDS.OUTPUT_INTERFACE_BOX, count: 1 },
      { itemId: ITEM_IDS.MERGER_BOX, count: 1 },
      { itemId: ITEM_IDS.SHAFT, count: 2 },
      { itemId: ITEM_IDS.IRON_INGOT, count: 4 },
    ],
    unlocks: [
      { kind: 'recipe', id: 'forge-structure-frame' },
      // 结构框架本身既是可放置零件（machine）也是结构模块（structure）：
      // 两个门控目标都必须显式登记，否则组合机械会被自己的门控锁死。
      { kind: 'machine', id: 'structure_frame' },
      { kind: 'structure', id: 'structure.frame' },
      { kind: 'capability', id: 'assembly' },
    ],
  },
]);
