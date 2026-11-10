import { ITEM_IDS, type ItemId } from '../items/items.ts';
import type { PartId } from '../mechanical/parts.ts';
import { makeStructureModuleId, type StructureModuleId } from './ids.ts';

/**
 * M2.0-P2-D 结构模块的**静态定义**（纯数据、零引擎依赖、深度冻结）。
 *
 * 边界（与 P2-A 一样严格分离）：
 * - 静态：本文件描述「结构模块是什么形态、能连接什么、用什么物品」；
 * - 运行时：`assembly-runtime.ts` 根据世界里的真实 `MechanicalPart` 推导组合机械实例。
 *
 * 本阶段只实现一种最小结构模块：1×1「结构框架」。
 * 它没有动力端口、没有物料端口，只提供真实空间占用与「正交相邻」的结构关系；
 * 组装/拆解、成员关系与整体边界全部由运行时从真实零件推导，不做 UI 虚拟分组。
 */

/** 结构模块允许连接的节点种类（P2-D 只允许加工核心；结构模块彼此也可以相连）。 */
export type StructureNodeKind = 'core' | 'module';

export interface StructureModuleDef {
  /** 稳定 ID，例：`structure.frame`。 */
  readonly id: StructureModuleId;
  /** 显示名。 */
  readonly label: string;
  /** 绑定的真实物品。 */
  readonly itemId: ItemId;
  /** 它在机械零件层的本体（同一身份空间，复用 MechanicalPart.id）。 */
  readonly partId: PartId;
  /** 占地（格）。 */
  readonly footprint: { readonly w: number; readonly d: number };
  /** 高度（米）。 */
  readonly height: number;
  /** 结构连接方式：本阶段只有「同层正交相邻」。 */
  readonly connection: 'orthogonal';
  /** 允许被本模块直接连接的节点种类。 */
  readonly connects: readonly StructureNodeKind[];
  /** 结构连接的格子距离（1 = 正交相邻）。 */
  readonly reach: number;
}

const FRAME: StructureModuleDef = Object.freeze({
  id: makeStructureModuleId('frame'),
  label: '结构框架',
  itemId: ITEM_IDS.STRUCTURE_FRAME,
  partId: 'structure_frame',
  footprint: Object.freeze({ w: 1, d: 1 }),
  height: 1,
  connection: 'orthogonal',
  connects: Object.freeze<StructureNodeKind[]>(['core', 'module']),
  reach: 1,
});

/** 全部结构模块定义（只读、冻结）。 */
export const STRUCTURE_MODULES: readonly StructureModuleDef[] = Object.freeze([FRAME]);

/** 按 ID 查结构模块。 */
export function structureModuleOfId(id: StructureModuleId): StructureModuleDef | undefined {
  return STRUCTURE_MODULES.find((module) => module.id === id);
}

/** 按机械零件 ID 查结构模块；不是结构模块返回 undefined。 */
export function structureModuleForPart(partId: PartId): StructureModuleDef | undefined {
  return STRUCTURE_MODULES.find((module) => module.partId === partId);
}

/** 按真实物品反查结构模块。 */
export function structureModuleForItem(itemId: ItemId): StructureModuleDef | undefined {
  return STRUCTURE_MODULES.find((module) => module.itemId === itemId);
}
