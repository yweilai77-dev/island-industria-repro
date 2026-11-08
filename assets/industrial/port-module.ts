import type { ItemId } from '../items/items.ts';
import {
  makePortModuleId,
  type PortModuleId,
  type PortModuleKind,
  type PortSlotRole,
} from './ids.ts';

/**
 * M2.0-P2-A 接口盒定义（纯数据、零引擎依赖、深度冻结）。
 *
 * 本阶段只定义「接口盒是什么形态」，**不实现安装**：
 * - 没有真实物品：`itemId` 一律 `null`。接口盒必须由玩家真实制造/放置/安装，
 *   但那属于 P2-B；现在注册成 ItemId 会连带改动物品表、图标、快捷栏与 HUD，
 *   既超出 P2-A 范围，也违反「不得修改玩家 HUD」。
 * - 没有运行时代码：没有注册表、没有安装服务、没有端口实例管理。
 *
 * 完整性校验（integrity.ts）会断言：所有接口盒 `itemId === null`，
 * 且流量方向与 `fitsSlotRoles` 自洽（直通 1/1、分流 1→N、合流 M→1）。
 */

/** 接口盒静态定义。 */
export interface PortModuleDef {
  /** 稳定 ID，例：`port.through`。 */
  readonly id: PortModuleId;
  /** 显示名。 */
  readonly label: string;
  /** 种类：直通 / 分流 / 合流。 */
  readonly kind: PortModuleKind;
  /** 输入端数量（>= 1）。 */
  readonly inputs: number;
  /** 输出端数量（>= 1）。 */
  readonly outputs: number;
  /** 可安装在哪种角色的机器安装位上。 */
  readonly fitsSlotRoles: readonly PortSlotRole[];
  /** 绑定的真实物品；P2-A 一律 `null`（P2-B 才接）。 */
  readonly itemId: ItemId | null;
}

interface PortModuleSpec {
  readonly name: string;
  readonly label: string;
  readonly kind: PortModuleKind;
  readonly inputs: number;
  readonly outputs: number;
  readonly fitsSlotRoles: readonly PortSlotRole[];
}

function definePortModule(spec: PortModuleSpec): PortModuleDef {
  return Object.freeze({
    id: makePortModuleId(spec.name),
    label: spec.label,
    kind: spec.kind,
    inputs: spec.inputs,
    outputs: spec.outputs,
    fitsSlotRoles: Object.freeze([...spec.fitsSlotRoles]),
    itemId: null,
  });
}

/**
 * 全部接口盒定义（只读、冻结）。
 *
 * 三种方向（任务书 §3.2）：
 * - `port.through`  基础直通盒：1 输入 1 输出，输入位与输出位都能装；
 * - `port.splitter` 分流盒：1 输入 2 输出，装在机器**输出位**，把产物分到两条下游；
 * - `port.merger`   合流盒：2 输入 1 输出，装在机器**输入位**，把两路来料合入机器。
 */
export const PORT_MODULES: readonly PortModuleDef[] = Object.freeze([
  definePortModule({
    name: 'through',
    label: '基础直通盒',
    kind: 'through',
    inputs: 1,
    outputs: 1,
    fitsSlotRoles: ['input', 'output'],
  }),
  definePortModule({
    name: 'splitter',
    label: '分流盒',
    kind: 'splitter',
    inputs: 1,
    outputs: 2,
    fitsSlotRoles: ['output'],
  }),
  definePortModule({
    name: 'merger',
    label: '合流盒',
    kind: 'merger',
    inputs: 2,
    outputs: 1,
    fitsSlotRoles: ['input'],
  }),
]);

/** 按 ID 查接口盒定义；未注册返回 undefined。 */
export function portModuleOfId(id: PortModuleId): PortModuleDef | undefined {
  return PORT_MODULES.find((module) => module.id === id);
}

/** 给定安装位方向，返回可装在该位的接口盒（P2-B 的安装校验会用到）。 */
export function portModulesForRole(role: PortSlotRole): readonly PortModuleDef[] {
  return PORT_MODULES.filter((module) => module.fitsSlotRoles.includes(role));
}
