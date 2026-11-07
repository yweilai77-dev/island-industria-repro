import type { ItemId } from '../items/items.ts';
import type { PartId } from '../mechanical/parts.ts';
import type { NetworkReason, NetworkStatus } from '../mechanical/power.ts';
import type { MachineBlockReason } from '../production/production.ts';

/**
 * M2.0-P1-A 目标系统的只读输入快照（纯数据、零引擎依赖）。
 *
 * 这些类型是「目标系统能看到的世界」的边界：阶段 B 在 mechanical/runtime.ts 内
 * 把 MechanicalSnapshot / ProductionSnapshot / InventoryService / parts() 映射成它们，
 * 目标逻辑永远不接触可变运行时对象。
 */

/** 目标系统看到的单个机械零件（只读摘要；来自 MechanicalService.parts + 动力解算）。 */
export interface GoalPartObservation {
  readonly partId: number;
  readonly partKind: PartId;
  /** 本帧是否处于有效动力网络并转动。 */
  readonly powered: boolean;
  readonly stalled: boolean;
}

/** 目标系统看到的加工机器状态（来自 ProductionRuntime.snapshot().machines）。 */
export interface GoalMachineObservation {
  readonly partId: number;
  readonly recipeId: string | null;
  readonly progress: number;
  readonly block: MachineBlockReason;
  readonly inputItem: ItemId | null;
  readonly inputCount: number;
  readonly outputItem: ItemId | null;
  readonly outputCount: number;
  readonly running: boolean;
}

/** 目标系统看到的动力源状态（来自 MechanicalSnapshot.sources）。 */
export interface GoalSourceObservation {
  readonly partId: number;
  /** 是否真的在输出动力（飞轮：离合挂上且有储能；测试源：开关打开）。 */
  readonly engaged: boolean;
  readonly energy: number | null;
  readonly energyCapacity: number | null;
}

/** 目标系统看到的动力网络组件（来自 MechanicalSnapshot.networks）。 */
export interface GoalNetworkObservation {
  readonly id: number;
  readonly status: NetworkStatus;
  readonly reason: NetworkReason | null;
  readonly sourceIds: readonly number[];
  readonly machineIds: readonly number[];
  readonly partIds: readonly number[];
  readonly stalledPartIds: readonly number[];
  readonly speedFactor: number;
}

/** 目标系统每帧读取的只读快照。 */
export interface GoalObservation {
  /** 库存铁矿石数量（步骤 1 用；生产步骤不读库存）。 */
  readonly ironOre: number;
  /** 当前世界里的全部机械零件。 */
  readonly parts: readonly GoalPartObservation[];
  /** 当前加工机器状态。 */
  readonly machines: readonly GoalMachineObservation[];
  /** 当前动力源状态。 */
  readonly sources: readonly GoalSourceObservation[];
  /** 当前动力网络组件。 */
  readonly networks: readonly GoalNetworkObservation[];
  /** 生产累计产出（**运行时生命周期累计**，订单判定只看相对基线的增量）。 */
  readonly produced: readonly { readonly itemId: ItemId; readonly count: number }[];
}
