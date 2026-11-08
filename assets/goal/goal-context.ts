import { ITEM_IDS, type ItemId } from '../items/items.ts';
import type { PartId } from '../mechanical/parts.ts';
import { MACHINE_KINDS, isGoalMachineKind, type GoalMachineKind } from './order.ts';
import type {
  GoalMachineObservation,
  GoalNetworkObservation,
  GoalObservation,
  GoalPartObservation,
  GoalSourceObservation,
} from './observation.ts';
import type { GoalProducedBaseline } from './goal.ts';

/**
 * 订单求值的只读上下文：每帧由 GoalObservation 构建，供状态机（goal.ts）与阻塞判定（goal-blockers.ts）
 * 共用。纯数据、零引擎依赖、不修改输入；从 goal.ts 拆出以守住 20 KB 单文件上限。
 */

export interface GoalContext {
  readonly partById: ReadonlyMap<number, GoalPartObservation>;
  readonly kindOfPart: ReadonlyMap<number, PartId>;
  readonly builtMachineKinds: ReadonlySet<GoalMachineKind>;
  readonly firstPartOfKind: ReadonlyMap<GoalMachineKind, number>;
  readonly machinesByKind: ReadonlyMap<GoalMachineKind, readonly GoalMachineObservation[]>;
  readonly hasPowerSource: boolean;
  /** 同时包含三台机器与动力源、结构可用的网络（没有则为 undefined）。 */
  readonly orderNetwork: GoalNetworkObservation | undefined;
  /** 三机与源已接进同一网络、但被动力系统判为不可用（闭环/多源）的网络。 */
  readonly unsupportedOrderNetwork: GoalNetworkObservation | undefined;
  readonly orderSource: GoalSourceObservation | undefined;
  /** 订单开始后新增的生产数量（已扣基线并夹到 >= 0）。 */
  readonly producedDelta: ReadonlyMap<ItemId, number>;
}

export function producedCountOf(observation: GoalObservation, itemId: ItemId): number {
  return observation.produced.find((entry) => entry.itemId === itemId)?.count ?? 0;
}

function baselineCountOf(baseline: GoalProducedBaseline, itemId: ItemId): number {
  if (itemId === ITEM_IDS.CRUSHED_ORE) return baseline.crushedOre;
  if (itemId === ITEM_IDS.IRON_INGOT) return baseline.ironIngot;
  if (itemId === ITEM_IDS.SHAFT) return baseline.shaft;
  return 0;
}

/** 记录订单开始时的生产累计产出基线。 */
export function captureBaseline(observation: GoalObservation): GoalProducedBaseline {
  return {
    crushedOre: producedCountOf(observation, ITEM_IDS.CRUSHED_ORE),
    ironIngot: producedCountOf(observation, ITEM_IDS.IRON_INGOT),
    shaft: producedCountOf(observation, ITEM_IDS.SHAFT),
  };
}

export function networkHasMachineKind(
  network: GoalNetworkObservation,
  kind: GoalMachineKind,
  kindOfPart: ReadonlyMap<number, PartId>,
): boolean {
  for (const partId of network.partIds) {
    if (kindOfPart.get(partId) === kind) return true;
  }
  return false;
}

export function createContext(observation: GoalObservation, baseline: GoalProducedBaseline): GoalContext {
  const partById = new Map<number, GoalPartObservation>();
  const kindOfPart = new Map<number, PartId>();
  const builtMachineKinds = new Set<GoalMachineKind>();
  const firstPartOfKind = new Map<GoalMachineKind, number>();
  let hasPowerSource = false;
  for (const part of observation.parts) {
    partById.set(part.partId, part);
    kindOfPart.set(part.partId, part.partKind);
    if (isGoalMachineKind(part.partKind)) {
      builtMachineKinds.add(part.partKind);
      if (!firstPartOfKind.has(part.partKind)) firstPartOfKind.set(part.partKind, part.partId);
    }
    if (part.partKind === 'power_source' || part.partKind === 'flywheel_source') hasPowerSource = true;
  }

  const machinesByKind = new Map<GoalMachineKind, GoalMachineObservation[]>();
  for (const machine of [...observation.machines].sort((a, b) => a.partId - b.partId)) {
    const kind = kindOfPart.get(machine.partId);
    if (kind === undefined || !isGoalMachineKind(kind)) continue;
    const list = machinesByKind.get(kind);
    if (list) list.push(machine);
    else machinesByKind.set(kind, [machine]);
  }

  const producedDelta = new Map<ItemId, number>();
  for (const itemId of [ITEM_IDS.CRUSHED_ORE, ITEM_IDS.IRON_INGOT, ITEM_IDS.SHAFT]) {
    producedDelta.set(
      itemId,
      Math.max(0, producedCountOf(observation, itemId) - baselineCountOf(baseline, itemId)),
    );
  }

  const orderNetwork = [...observation.networks]
    .sort((a, b) => a.id - b.id)
    .find(
      (network) =>
        network.status !== 'unsupported'
        && network.sourceIds.length > 0
        && MACHINE_KINDS.every((kind) => networkHasMachineKind(network, kind, kindOfPart)),
    );
  const orderSource = orderNetwork === undefined
    ? undefined
    : observation.sources.find((source) => orderNetwork.sourceIds.includes(source.partId));
  // 闭环/多源：零件都接上了，但动力系统拒绝解算。单独识别出来才能给出正确阻塞原因。
  const unsupportedOrderNetwork = orderNetwork !== undefined
    ? undefined
    : [...observation.networks]
      .sort((a, b) => a.id - b.id)
      .find(
        (network) =>
          network.status === 'unsupported'
          && network.sourceIds.length > 0
          && MACHINE_KINDS.every((kind) => networkHasMachineKind(network, kind, kindOfPart)),
      );

  return {
    partById,
    kindOfPart,
    builtMachineKinds,
    firstPartOfKind,
    machinesByKind,
    hasPowerSource,
    orderNetwork,
    unsupportedOrderNetwork,
    orderSource,
    producedDelta,
  };
}

export function deltaOf(context: GoalContext, itemId: ItemId): number {
  return context.producedDelta.get(itemId) ?? 0;
}

export function hasAllMachines(context: GoalContext): boolean {
  return MACHINE_KINDS.every((kind) => context.builtMachineKinds.has(kind));
}

export function isKindPowered(context: GoalContext, kind: GoalMachineKind, network: GoalNetworkObservation): boolean {
  for (const part of context.partById.values()) {
    if (part.partKind !== kind) continue;
    if (!part.powered || part.stalled) continue;
    if (network.partIds.includes(part.partId)) return true;
  }
  return false;
}

export function isPowerStarted(context: GoalContext): boolean {
  const network = context.orderNetwork;
  if (network === undefined || network.status !== 'powered' || network.speedFactor <= 0) return false;
  if (context.orderSource === undefined || context.orderSource.engaged !== true) return false;
  return MACHINE_KINDS.every((kind) => isKindPowered(context, kind, network));
}

/** 网络里是否有订单机器被支路过载停转（整网 status 可能仍是 powered）。 */
export function hasStalledOrderMachine(context: GoalContext, network: GoalNetworkObservation): boolean {
  for (const part of context.partById.values()) {
    if (!isGoalMachineKind(part.partKind) || !part.stalled) continue;
    if (network.partIds.includes(part.partId)) return true;
  }
  return false;
}

export function networkOfMachine(context: GoalContext, partId: number): GoalNetworkObservation | undefined {
  return context.orderNetwork?.machineIds.includes(partId) ? context.orderNetwork : undefined;
}
