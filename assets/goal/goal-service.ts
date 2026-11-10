import { ITEM_IDS } from '../items/items.ts';
import { createGoalState, evaluateGoal } from './goal.ts';
import type {
  GoalMachineObservation,
  GoalNetworkObservation,
  GoalObservation,
  GoalPartObservation,
  GoalSnapshot,
  GoalSourceObservation,
  GoalState,
} from './goal.ts';
import type { InventoryService } from '../inventory/inventory.ts';
import type { MechanicalPart } from '../mechanical/parts.ts';
import type { MechanicalSnapshot } from '../mechanical/runtime-state.ts';
import type { MachineBlockReason } from '../production/production.ts';
import type { ProductionSnapshot } from '../production/production-runtime.ts';

/**
 * M2.0-P1-B 目标进度服务（P2-B 从 `mechanical/runtime.ts` 拆出，原样迁移、行为不变）。
 *
 * 为什么单独一个文件：`mechanical/runtime.ts` 在 P2-B 还要接接口盒网关与读投影，
 * 会超过工程 20 KB 单文件上限（提交钩子会拒绝）。这里搬出「只读映射 + 订单求值器」，
 * 它是纯函数组合，不接触引擎，搬走后 runtime 只保留一帧编排。
 *
 * 边界：只读映射现有快照，不修改运行时、不暴露运行时实例。
 */

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    /** 目标系统只读进度（每帧由 mechanical-runtime 刷新）。 */
    goalProgress: GoalProgressService;
  }
}

/** 目标系统一帧数据的真实来源。 */
export interface GoalFrameSource {
  readonly parts: readonly MechanicalPart[];
  readonly mechanical: MechanicalSnapshot;
  readonly production: ProductionSnapshot;
  readonly inventory: InventoryService;
}

/** 外部可读取的只读进度服务。 */
export interface GoalProgressService {
  /** 最近一帧的目标进度快照（纯 JSON）。 */
  snapshot(): GoalSnapshot;
  /** 最近一帧的订单观测（只读纯数据，用于调试/验收）。 */
  observation(): GoalObservation;
  /** 订单状态（基线 + 已锁存步骤）的只读副本。 */
  state(): GoalState;
}

/** 机械运行时内部使用。 */
export interface GoalProgressReader extends GoalProgressService {
  /** 推进一帧并返回本帧目标快照。 */
  update(source: GoalFrameSource): GoalSnapshot;
}

const EMPTY_GOAL_OBSERVATION: GoalObservation = Object.freeze({
  ironOre: 0,
  parts: Object.freeze([]),
  machines: Object.freeze([]),
  sources: Object.freeze([]),
  networks: Object.freeze([]),
  produced: Object.freeze([]),
});

/** 宽类型 block 收敛为合法阻塞原因。 */
function asMachineBlockReason(value: string): MachineBlockReason {
  switch (value) {
    case 'ok':
    case 'no-power':
    case 'no-input':
    case 'output-full':
    case 'no-recipe':
      return value;
    default:
      return 'no-recipe';
  }
}

/** 把现有只读快照映射成目标观测（纯函数，不修改输入）。 */
export function assembleGoalObservation(source: GoalFrameSource): GoalObservation {
  const mechanicalParts = new Map(source.mechanical.parts.map((part) => [part.partId, part]));
  const parts: GoalPartObservation[] = source.parts.map((part) => {
    const partState = mechanicalParts.get(part.id);
    return {
      partId: part.id,
      partKind: part.def.id,
      powered: partState?.powered === true,
      stalled: partState?.stalled === true,
    };
  });
  const machines: GoalMachineObservation[] = source.production.machines.map((machine) => ({
    partId: machine.partId,
    recipeId: machine.recipeId,
    progress: machine.progress,
    block: asMachineBlockReason(machine.block),
    inputItem: machine.inputItem,
    inputCount: machine.inputCount,
    outputItem: machine.outputItem,
    outputCount: machine.outputCount,
    running: machine.running,
    producedTotal: machine.producedTotal,
  }));
  const sources: GoalSourceObservation[] = source.mechanical.sources.map((powerSource) => ({
    partId: powerSource.partId,
    engaged: powerSource.engaged,
    energy: powerSource.energy,
    energyCapacity: powerSource.energyCapacity,
  }));
  const networks: GoalNetworkObservation[] = source.mechanical.networks.map((network) => ({
    id: network.id,
    status: network.status,
    reason: network.reason,
    sourceIds: [...network.sourceIds],
    machineIds: [...network.machineIds],
    partIds: [...network.partIds],
    stalledPartIds: [...network.stalledPartIds],
    speedFactor: network.speedFactor,
  }));
  const produced = source.production.produced.map((entry) => ({ itemId: entry.itemId, count: entry.count }));
  return {
    ironOre: source.inventory.count(ITEM_IDS.IRON_ORE),
    parts,
    machines,
    sources,
    networks,
    produced,
  };
}

/**
 * 创建订单进度求值器：第一帧真实观测时记录 production.produced 基线，之后只按增量判定。
 * 当前版本没有存档/菜单，机械运行时初始化即世界载入，因此订单起点就是首帧。
 */
export function createGoalProgress(): GoalProgressReader {
  const preview = evaluateGoal(createGoalState(EMPTY_GOAL_OBSERVATION), EMPTY_GOAL_OBSERVATION);
  let goalState: GoalState = preview.state;
  let orderStarted = false;
  let lastObservation: GoalObservation = EMPTY_GOAL_OBSERVATION;
  let lastSnapshot: GoalSnapshot = preview.snapshot;
  return {
    update(source) {
      const observation = assembleGoalObservation(source);
      // 只在第一帧记录基线：之后的读取永不重置订单进度。
      if (!orderStarted) {
        goalState = createGoalState(observation);
        orderStarted = true;
      }
      const evaluation = evaluateGoal(goalState, observation);
      goalState = evaluation.state;
      lastObservation = observation;
      lastSnapshot = evaluation.snapshot;
      return lastSnapshot;
    },
    snapshot: () => lastSnapshot,
    observation: () => lastObservation,
    state: () => ({ baseline: { ...goalState.baseline }, completed: [...goalState.completed] }),
  };
}
