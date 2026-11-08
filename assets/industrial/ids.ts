/**
 * M2.0-P2-A 工业对象的稳定 ID 与枚举（纯类型 + 纯函数、零引擎依赖）。
 *
 * 设计要点（详见 docs/m20/P2-A-DESIGN.md §2）：
 * - 「稳定」= 一旦发布不再修改；新增对象只能追加新 ID，因为存档/科技树/市场会引用它们。
 * - 定义类 ID 用 TypeScript 模板字面量类型表达，编译期就挡住「把 PartId 当 CoreId 用」。
 * - 运行时复合 ID（接口实例键 / 物料连接 / 组合机械）不是定义 ID，不要求匹配 STABLE_ID_PATTERN。
 *
 * 命名空间一览：
 *   core.<name>                        加工核心            core.crusher
 *   port.<name>                        接口盒              port.through
 *   slot.<core>.<in|out>.<face>        机器表面安装位        slot.crusher.in.pz
 *   <kebab>                            配方（沿用现有）      crush-iron-ore
 *   <entityId>:<slotId>                接口实例键           7:slot.crusher.in.pz
 *   link:<from>-><to>                  物料连接             link:7:slot.crusher.out.px->8:...
 *   assembly:<n>                       组合机械             assembly:1
 */

/** 定义类稳定 ID 的通用格式：小写字母开头，至少两段，用 `.` 或 `-` 分隔。 */
export const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;

/** 是否是合法稳定 ID（只校验**定义类** ID）。 */
export function isStableId(value: string): boolean {
  return STABLE_ID_PATTERN.test(value);
}

/** 断言稳定 ID；不合法抛 RangeError（编程错误，不是玩家可见错误）。 */
export function assertStableId(value: string, label: string): string {
  if (!isStableId(value)) {
    throw new RangeError(`${label} must be a stable id, received ${JSON.stringify(value)}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// 加工工艺
// ---------------------------------------------------------------------------

/**
 * 加工工艺种类。决定「这个核心能把什么变成什么」。
 * 新增工艺必须同时更新 `PROCESS_KINDS`（完整性校验会检查一致性）。
 */
export type ProcessKind = 'crushing' | 'smelting' | 'forging';

/** 全部加工工艺（只读；校验与遍历用）。 */
export const PROCESS_KINDS: readonly ProcessKind[] = Object.freeze([
  'crushing',
  'smelting',
  'forging',
]);

// ---------------------------------------------------------------------------
// 定义类 ID
// ---------------------------------------------------------------------------

/** 加工核心 ID。例：`core.crusher`。 */
export type CoreId = `core.${string}`;

/** 接口盒 ID。例：`port.through`。 */
export type PortModuleId = `port.${string}`;

/** 机器表面安装位 ID。例：`slot.crusher.in.pz`。 */
export type PortSlotId = `slot.${string}`;

/** 配方 ID。**沿用现有 `Recipe.id`**，不迁移、不改名（订单判定与测试依赖它）。 */
export type RecipeId = string;

/** 构造加工核心 ID。 */
export function makeCoreId(name: string): CoreId {
  return `core.${name}` as CoreId;
}

/** 加工核心 ID 去掉 `core.` 前缀，得到可读短名（用于安装位 ID）。 */
export function coreNameOf(id: CoreId): string {
  return id.slice('core.'.length);
}

/** 构造接口盒 ID。 */
export function makePortModuleId(name: string): PortModuleId {
  return `port.${name}` as PortModuleId;
}

// ---------------------------------------------------------------------------
// 运行时 ID（复合键，不是定义 ID）
// ---------------------------------------------------------------------------

/**
 * 机器实体 ID = 现有 `MechanicalPart.id` 的**同一身份空间**。
 * 绝不另建实体 ID：否则 registry / SpatialIndex / 视图 / 存档会出现两套身份。
 */
export type MachineEntityId = number;

/** 接口实例唯一键：`<entityId>:<slotId>`。 */
export type PortInstanceKey = `${number}:${PortSlotId}`;

/** 物料连接 ID。 */
export type MaterialLinkId = `link:${string}`;

/** 组合机械 ID。 */
export type AssemblyId = `assembly:${string}`;

/** 构造接口实例键。 */
export function portInstanceKey(entityId: MachineEntityId, slotId: PortSlotId): PortInstanceKey {
  return `${entityId}:${slotId}`;
}

/** 构造组合机械 ID。 */
export function makeAssemblyId(serial: number): AssemblyId {
  return `assembly:${serial}` as AssemblyId;
}

// ---------------------------------------------------------------------------
// 物料方向与接口盒种类
// ---------------------------------------------------------------------------

/** 安装位的物料方向。`input` = 物料进入机器；`output` = 物料离开机器。 */
export type PortSlotRole = 'input' | 'output';

/** 全部安装位方向（只读；校验用）。 */
export const PORT_SLOT_ROLES: readonly PortSlotRole[] = Object.freeze(['input', 'output']);

/** 接口盒种类：直通 / 分流 / 合流。 */
export type PortModuleKind = 'through' | 'splitter' | 'merger';

/** 全部接口盒种类（只读；校验用）。 */
export const PORT_MODULE_KINDS: readonly PortModuleKind[] = Object.freeze([
  'through',
  'splitter',
  'merger',
]);
