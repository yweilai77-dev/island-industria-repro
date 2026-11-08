import type { Placement } from '../grid/grid.ts';
import { isProductionMachine, type MechanicalPart } from '../mechanical/parts.ts';
import { coreForPart, portModuleOfId } from './catalog.ts';
import {
  portInstanceKey,
  type AssemblyId,
  type CoreId,
  type MachineEntityId,
  type MaterialLinkId,
  type PortInstanceKey,
  type PortModuleId,
  type PortSlotId,
} from './ids.ts';
import type { ProcessingCoreDef } from './processing-core.ts';

/**
 * M2.0-P2-A 工业对象的**运行时**类型（纯数据、可序列化、零引擎依赖）。
 *
 * 这一层只有类型定义和纯函数，**没有**注册表、没有服务、没有每帧系统 ——
 * 因为 P2-A 不实现接口盒安装（P2-B）、核心间物流（P2-C）、组合机械管理（P2-D）。
 *
 * 三条硬规则（用测试锁死，详见 docs/m20/P2-A-DESIGN.md §3.6）：
 * 1. `MachineEntity.entityId` **就是** `MechanicalPart.id`，绝不另建实体 ID 空间；
 * 2. `MachineEntity` **不持有加工状态**（进度/缓冲仍在 `MachineState`，由 `ProductionRuntime` 拥有）；
 * 3. `MachineEntity` **不持有动力状态**（转速/扭矩/停转仍在 `power.ts` / `MechanicalSnapshot`）。
 *
 * 因此本文件里没有任何字段与现有运行时重复。
 */

/** 一台机器上已安装的一个接口盒实例。 */
export interface PortInstance {
  /** 装在哪一个预留安装位（`slot.*`）。 */
  readonly slotId: PortSlotId;
  /** 装的是哪种接口盒（`port.*`）。 */
  readonly moduleId: PortModuleId;
}

/**
 * 世界中的机器实体（加工核心的运行时视图）。
 * 由 `machineEntityOf(part)` 从真实 `MechanicalPart` 投影得到，不单独存储。
 */
export interface MachineEntity {
  /** = `MechanicalPart.id`（同一身份空间）。 */
  readonly entityId: MachineEntityId;
  /** 它实现的是哪一个加工核心。 */
  readonly coreId: CoreId;
  /** 真实放置（复制值，不与 registry 内部对象共享引用）。 */
  readonly placement: Placement;
  /** 已安装接口（P2-A 恒为空数组；安装属于 P2-B）。 */
  readonly ports: readonly PortInstance[];
  /** 所属组合机械（P2-A 恒为 null；组合属于 P2-D）。 */
  readonly assemblyId: AssemblyId | null;
}

/** 物料连接的一端：某台机器的某个安装位。 */
export interface PortEndpoint {
  readonly entityId: MachineEntityId;
  readonly slotId: PortSlotId;
}

/**
 * 真实物料连接。
 *
 * ⚠ 与 `assets/mechanical/ports.ts` 的 `Connection` **不是同一个东西**：
 * 那个是机械动力连接（带传动比 `ratio`），这个是物料流向。两者绝不混用。
 */
export interface MaterialLink {
  readonly id: MaterialLinkId;
  /** 起点，必须是 `output` 方向的安装位。 */
  readonly from: PortEndpoint;
  /** 终点，必须是 `input` 方向的安装位。 */
  readonly to: PortEndpoint;
}

/**
 * 组合机械的管理对象（长期架构方向，P2-D 实现）。
 *
 * 它**只**维护成员关系，不合并成员身份、不接管成员状态：
 * 每个成员核心仍然保留自己的实体 ID、加工状态、接口、缓冲与动力需求。
 * 拆卸连接模块后成员恢复为独立核心，不需要销毁重建。
 */
export interface Assembly {
  readonly id: AssemblyId;
  /** 成员核心的实体 ID（去重、无顺序语义）。 */
  readonly memberIds: readonly MachineEntityId[];
}

/** 把真实机械零件投影成机器实体；非加工机器（轴/齿轮/动力源/溜槽）返回 undefined。 */
export function machineEntityOf(part: MechanicalPart): MachineEntity | undefined {
  if (!isProductionMachine(part.def)) return undefined;
  const core = coreForPart(part.def.id);
  if (!core) return undefined;
  return {
    entityId: part.id,
    coreId: core.id,
    // 复制值：MachineEntity 是运行时视图，不得与 registry 内部对象共享引用。
    placement: {
      gx: part.placement.gx,
      gz: part.placement.gz,
      level: part.placement.level,
      w: part.placement.w,
      d: part.placement.d,
      rotation: part.placement.rotation,
    },
    ports: [],
    assemblyId: null,
  };
}

/** 接口实例的唯一键：`<entityId>:<slotId>`（P2-B 用它建索引）。 */
export function portInstanceOf(entityId: MachineEntityId, instance: PortInstance): PortInstanceKey {
  return portInstanceKey(entityId, instance.slotId);
}

/** 两端之间的物料连接（生成规范 ID；不做合法性判断，判断用 validateMaterialLink）。 */
export function materialLinkBetween(from: PortEndpoint, to: PortEndpoint): MaterialLink {
  const id = `link:${portInstanceKey(from.entityId, from.slotId)}->${portInstanceKey(to.entityId, to.slotId)}`;
  return { id: id as MaterialLinkId, from, to };
}

/**
 * 校验一个接口实例能否装在该核心上。
 * 返回 `null` 表示合法，否则返回可读原因（P2-B 的安装预览/拒绝提示可直接用）。
 *
 * 注意：P2-A 的接口盒 `itemId` 仍是 null，本函数不检查「物品是否存在」——
 * 那是 P2-B 绑定真实物品之后的事。
 */
export function validatePortInstance(core: ProcessingCoreDef, instance: PortInstance): string | null {
  const slot = core.portSlots.find((entry) => entry.id === instance.slotId);
  if (!slot) return `slot ${instance.slotId} is not defined on core ${core.id}`;
  const module = portModuleOfId(instance.moduleId);
  if (!module) return `unknown port module: ${instance.moduleId}`;
  if (!module.fitsSlotRoles.includes(slot.role)) {
    return `port module ${module.id} cannot be installed on a ${slot.role} slot`;
  }
  return null;
}

/**
 * 校验一条物料连接的方向是否成立：起点必须是 output 位、终点必须是 input 位、两端不同机器。
 * 返回 `null` 表示合法，否则返回可读原因。
 */
export function validateMaterialLink(
  link: MaterialLink,
  fromCore: ProcessingCoreDef,
  toCore: ProcessingCoreDef,
): string | null {
  if (link.from.entityId === link.to.entityId) {
    return 'material link cannot connect a machine to itself';
  }
  const fromSlot = fromCore.portSlots.find((entry) => entry.id === link.from.slotId);
  if (!fromSlot) return `slot ${link.from.slotId} is not defined on core ${fromCore.id}`;
  if (fromSlot.role !== 'output') {
    return `material link must start from an output slot, got ${fromSlot.role}`;
  }
  const toSlot = toCore.portSlots.find((entry) => entry.id === link.to.slotId);
  if (!toSlot) return `slot ${link.to.slotId} is not defined on core ${toCore.id}`;
  if (toSlot.role !== 'input') {
    return `material link must end at an input slot, got ${toSlot.role}`;
  }
  return null;
}

/** 构造组合机械（仅校验成员非空、唯一；没有任何管理逻辑，P2-D 才实现）。 */
export function createAssembly(id: AssemblyId, memberIds: readonly MachineEntityId[]): Assembly {
  if (memberIds.length === 0) throw new RangeError('assembly needs at least one member');
  if (new Set(memberIds).size !== memberIds.length) {
    throw new RangeError('assembly members must be unique');
  }
  return { id, memberIds: [...memberIds] };
}
