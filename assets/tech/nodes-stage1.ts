/**
 * M2.0-P2-E1 科技树 · 阶段 1「基础工业」（4 个节点）。
 * 数据来源：docs/m20/P2-E0-TECH-TREE-DESIGN.md §4.2–§4.5。
 * 纯数据；交付材料只能使用已注册 ItemId（校验器会检查）。
 */
import { ITEM_IDS } from '../items/items.ts';
import type { TechNodeDef } from './types.ts';

export const TECH_NODES_STAGE1: readonly TechNodeDef[] = Object.freeze([
  {
    id: 'tech:gear-manufacture',
    name: '齿轮制造',
    description: '把铁锭锻成 12 齿与 24 齿齿轮。',
    stage: 1,
    route: 'power',
    purpose: '让齿轮可以自己生产，解开传动网络扩建的数量限制。',
    requires: [],
    cost: [
      { itemId: ITEM_IDS.IRON_INGOT, count: 3 },
      { itemId: ITEM_IDS.SHAFT, count: 2 },
    ],
    unlocks: [
      { kind: 'recipe', id: 'forge-gear-12' },
      { kind: 'recipe', id: 'forge-gear-24' },
    ],
  },
  {
    id: 'tech:chute-logistics',
    name: '溜槽物流',
    description: '用重力溜槽把机器产物送进下一格设备。',
    stage: 1,
    route: 'industry',
    purpose: '第一次把「机器到机器」的搬运交给产线，减少手动搬运。',
    requires: ['tech:gear-manufacture'],
    cost: [
      { itemId: ITEM_IDS.SHAFT, count: 2 },
      { itemId: ITEM_IDS.GEAR_12, count: 2 },
      { itemId: ITEM_IDS.CRUSHED_ORE, count: 3 },
    ],
    unlocks: [{ kind: 'recipe', id: 'forge-chute' }],
  },
  {
    id: 'tech:cross-level-drive',
    name: '跨层传动',
    description: '用立式传动带把动力送过楼板。',
    stage: 1,
    route: 'power',
    purpose: '第一次把动力送过楼板，工厂从平面变成空间。',
    requires: ['tech:gear-manufacture'],
    cost: [
      { itemId: ITEM_IDS.GEAR_24, count: 2 },
      { itemId: ITEM_IDS.SHAFT, count: 2 },
      { itemId: ITEM_IDS.IRON_INGOT, count: 2 },
    ],
    unlocks: [{ kind: 'recipe', id: 'forge-vertical-drive' }],
  },
  {
    id: 'tech:input-interface',
    name: '输入接口盒',
    description: '在加工核心的输入安装位装接口盒，溜槽即可自动送料。',
    stage: 1,
    route: 'industry',
    purpose: '解锁「机器自己吃饭」：溜槽不再只能末端入背包，而是能自动进料。',
    requires: ['tech:chute-logistics'],
    cost: [
      { itemId: ITEM_IDS.CHUTE, count: 1 },
      { itemId: ITEM_IDS.IRON_INGOT, count: 3 },
    ],
    unlocks: [
      { kind: 'recipe', id: 'forge-interface-box' },
      { kind: 'port', id: 'port.through' },
      { kind: 'capability', id: 'port-input-install' },
    ],
  },
]);
