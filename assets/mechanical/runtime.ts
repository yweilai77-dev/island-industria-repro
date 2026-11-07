import { Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { createBoxGeometry } from '@forgeax/engine/geometry';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import type { Plugin } from '@forgeax/engine/plugin';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import type { GameProjectionValue } from '@forgeax/engine/app';
import type {} from '@forgeax/engine/assets-runtime';
import type {} from '../hotbar/hotbar.ts';
import type { InventoryService } from '../inventory/inventory.ts';
import type {} from '../player/player.ts';
import { ITEM_IDS, isMechanicalItem, type ItemId } from '../items/items.ts';
import { placementCenter } from '../grid/grid.ts';
import { levelBaseY } from '../spatial/space.ts';
import { FLOOR_MODE_KEY, type FloorModeState } from '../build/floors.ts';
import { BUILD_TARGET_STATE_KEY, type BuildTargetState } from '../build/target.ts';
import { isProductionMachine, type MechanicalPart } from './parts.ts';
import type { MechanicalService } from './mechanical.pack.ts';
import { applyMachinePose, applySpin } from './animation.ts';
import { createMechanicalReadout } from './readout.ts';
import { readoutTargetOf, type ReadoutTarget } from './readout-status.ts';
import { MechanicalRuntimeState, sourceToggleTarget, type MechanicalSnapshot } from './runtime-state.ts';
import { ProductionRuntime, type ProductionSnapshot } from '../production/production-runtime.ts';
import type { MachineBlockReason } from '../production/production.ts';
import { chuteItemWorldPosition } from '../production/transport.ts';
import { resolveSceneEntity } from '../shared/scene-refs.ts';
import {
  createGoalState,
  evaluateGoal,
  type GoalMachineObservation,
  type GoalNetworkObservation,
  type GoalObservation,
  type GoalPartObservation,
  type GoalSnapshot,
  type GoalSourceObservation,
  type GoalState,
} from '../goal/goal.ts';

const SYSTEM_NAME = 'island-industria/mechanical-runtime';
/** 玩家离动力源多近才能摇动摇柄（米，水平距离）。 */
const WIND_VERTICAL_TOLERANCE = 2.5;

/**
 * M2.0-P1-B：第一份工业订单的只读进度服务。
 * 只把现有运行时快照映射成 A 阶段的 GoalObservation 再求值；不修改库存/生产/动力/机器状态，
 * 也不把运行时实例暴露给外部。
 */
declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    /** 目标系统只读进度（每帧由 mechanical-runtime 刷新）。 */
    goalProgress: GoalProgressService;
  }
}

/** 目标系统一帧数据的真实来源（现有系统的只读快照）。 */
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

/** 把 ProductionSnapshot 的宽类型 block 收敛回合法阻塞原因。 */
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

/** 把机械/生产/库存的现有只读快照映射成目标系统观测（纯函数，不修改输入）。 */
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
 * 创建订单进度求值器。
 * 订单在第一帧真实观测时开始（当前版本没有存档/菜单，机械运行时初始化即世界载入），
 * 此时记录 production.produced 基线；之后只按「当前累计 - 基线」判定生产步骤。
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

/**
 * M1.7-C runtime（M1.8 扩展为整条生产链的 tick 中枢）：
 * - 右键：悬停的正式/测试动力源 → 离合启停；悬停的加工机器 → 投料 / 取货；
 * - 按住 `C`：靠近手摇飞轮储能机时摇动摇柄给飞轮储能；
 * - 悬停加工机器按 `R`：循环配方；
 * - 每帧：动力解算 → 储能结算 → 加工推进 → 机器把产物推给相邻溜槽 → 溜槽下滑并交接；
 * - 只读 GameRead 投影：机械/动力 + 生产 + 库存，**只有一个 read**（多 read 会让历史 playthrough 的
 *   `play.advance()` 抛 state-unavailable）；
 * - 不创建/销毁机械实体（溜槽在途物品是纯视图实体），不修改 Registry/SpatialIndex。
 */
export const mechanicalRuntime: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world', 'mechanical', 'hotbar', 'gameHost', 'assets', 'gameScene', 'player', 'inventory'],
  apply(ctx) {
    const world = ctx.world;
    const mechanical = ctx.mechanical;
    const hotbar = ctx.hotbar;
    const inventory = ctx.inventory;
    const player = ctx.player;
    const assets = ctx.assets;
    if (!assets) throw new Error('mechanical runtime requires asset service');
    const camera = resolveSceneEntity(world, ctx.gameScene, 'camera');

    ctx.effect(function* () {
      const state = new MechanicalRuntimeState();
      const readout = createMechanicalReadout(world, assets, camera);
      const production = new ProductionRuntime({
        partAt: (cell, level) => mechanical.partAt(cell, level),
        addItem: (itemId, count) => { inventory.add(itemId, count); },
      });
      // M2.0-P1-B：只读目标进度服务（每帧用真实快照刷新）。
      const goalProgress = createGoalProgress();
      yield ctx.provide('goalProgress', goalProgress);

      // ---- 溜槽在途物品的纯视图实体 ----
      const itemMesh = assets.create(createBoxGeometry(0.26, 0.2, 0.26).unwrap()).unwrap();
      const itemMaterial = assets.create(
        Materials.standard({ baseColor: [0.78, 0.45, 0.2, 1], metallic: 0.2, roughness: 0.6 }),
      ).unwrap();
      const itemEntities = new Map<number, EntityHandle>();
      yield () => {
        assets!.release(itemMesh).unwrap();
        assets!.release(itemMaterial).unwrap();
      };

      const snapshotOf = (): Record<string, unknown> => {
        const base = state.snapshot();
        const totals = new Map<ItemId, number>();
        for (const stack of inventory.stacks()) {
          totals.set(stack.itemId, (totals.get(stack.itemId) ?? 0) + stack.count);
        }
        const inventorySnapshot = [...totals.entries()]
          .filter(([, count]) => count > 0)
          .map(([itemId, count]) => ({ itemId, count }))
          .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

        // 建造/楼层模式的当前目标：验收脚本据此确认「鼠标指向的确实是目标格」，
        // 这是状态读数，不是给测试开后门（真正的放置仍走真实鼠标与合法性校验）。
        const floorMode = world.hasResource(FLOOR_MODE_KEY)
          ? world.getResource<FloorModeState>(FLOOR_MODE_KEY)
          : undefined;
        const buildTarget = world.hasResource(BUILD_TARGET_STATE_KEY)
          ? world.getResource<BuildTargetState>(BUILD_TARGET_STATE_KEY)
          : undefined;
        const playerPosition = player.state.position;

        return {
          ...base,
          production: production.snapshot(),
          inventory: inventorySnapshot,
          player: {
            position: [playerPosition[0], playerPosition[1], playerPosition[2]],
            level: player.state.level,
            supportId: player.state.supportId,
            cell: { gx: player.cell.gx, gz: player.cell.gz },
          },
          ui: {
            floorMode: floorMode ? { active: floorMode.active, kind: floorMode.kind, rotation: floorMode.rotation } : null,
            buildTarget: buildTarget
              ? {
                active: buildTarget.active,
                cell: buildTarget.cell ? { gx: buildTarget.cell.gx, gz: buildTarget.cell.gz } : null,
                level: buildTarget.level ?? null,
                valid: buildTarget.valid ?? null,
              }
              : null,
            hoveredPartId: mechanical.hoveredPartId() ?? null,
            selectedPartId: mechanical.selectedPartId() ?? null,
            selectedItem: hotbar.slots[hotbar.selected] ?? null,
            hotbar: { slots: [...hotbar.slots], selected: hotbar.selected },
          },
        };
      };

      const unregisterRead = ctx.gameHost?.gameProjection?.registerRead({
        id: 'mechanical',
        title: 'Mechanical & production state',
        read: () => snapshotOf() as unknown as GameProjectionValue,
      });
      yield () => unregisterRead?.();

      /**
       * 读数完全来自 Runtime 解算结果：状态、rpm、扭矩都不在显示层重算。
       * 无解算数据的零件（不支持/闭环）返回 null，读数显示 —。
       */
      const readoutFor = (partId: number, capacity: number): ReadoutTarget => readoutTargetOf({
        component: state.componentOf(partId),
        stalled: state.isStalled(partId),
        omega: state.omegaOf(partId),
        torque: state.torqueOf(partId),
        capacity,
        speedFactor: state.speedFactorOf(partId),
      });

      const machineIsDriven = (partId: number): boolean => Math.abs(state.omegaOf(partId)) > 1e-9;

      /** 按住 C 且靠近某台飞轮时给它储能；离开则停止摇动。 */
      const updateWinding = (parts: readonly MechanicalPart[], input: InputSnapshot): void => {
        const held = input.keyboard.downCode('KeyC');
        const position = player.state.position;
        for (const part of parts) {
          const spec = part.def.energy;
          if (!spec) continue;
          const center = placementCenter(part.placement);
          const horizontal = Math.hypot(center[0] - position[0], center[2] - position[2]);
          const vertical = Math.abs(levelBaseY(part.placement.level) - position[1]);
          const near = horizontal <= spec.range && vertical < WIND_VERTICAL_TOLERANCE;
          state.setWinding(part.id, held && near);
        }
      };

      /** 右键交互：动力源离合 / 加工机器投料与取货。 */
      const handleRightClick = (target: MechanicalPart | undefined, selectedItem: ItemId | null): void => {
        if (!target) return;
        if (isProductionMachine(target.def)) {
          const hand = selectedItem;
          if (hand !== null && !isMechanicalItem(hand) && inventory.has(hand, 1)) {
            const inserted = production.insertInto(target.id, hand, 1);
            if (inserted > 0) {
              inventory.remove(hand, inserted);
              return;
            }
          }
          const taken = production.takeFrom(target.id);
          if (taken) inventory.add(taken.itemId, taken.count);
          return;
        }
        if (target.def.kind === 'power-source' && isMechanicalItem(selectedItem)) {
          state.toggleSource(target.id);
        }
      };

      const updateChuteItems = (parts: readonly MechanicalPart[]): void => {
        const alive = new Set<number>();
        for (const part of parts) {
          if (part.def.kind !== 'transport') continue;
          const chute = production.chuteState(part.id);
          if (!chute?.item) continue;
          alive.add(part.id);
          let entity = itemEntities.get(part.id);
          if (entity === undefined) {
            entity = world
              .spawn(
                { component: Transform, data: { pos: [0, -1000, 0], scale: [1, 1, 1] } },
                { component: MeshFilter, data: { assetHandle: itemMesh } },
                { component: MeshRenderer, data: { materials: [itemMaterial] } },
              )
              .unwrap();
            itemEntities.set(part.id, entity);
          }
          const pos = chuteItemWorldPosition(part.placement, chute.item.t);
          world.set(entity, Transform, { pos: [pos[0], pos[1], pos[2]], scale: [1, 1, 1] }).unwrap();
        }
        for (const [partId, entity] of [...itemEntities]) {
          if (alive.has(partId)) continue;
          itemEntities.delete(partId);
          world.despawn(entity).unwrap();
        }
      };

      world.addSystem(Update, {
        name: SYSTEM_NAME,
        // 必须在本帧 Transform 传播之前写入动画；mechanical 自己的输入系统在 propagate 之后。
        before: [PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const parts = mechanical.parts();
          const connections = mechanical.connections();
          state.sync(mechanical.revision, parts, connections);
          production.sync(parts);

          const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          const floorMode = world.hasResource(FLOOR_MODE_KEY);
          const selectedItem = hotbar.slots[hotbar.selected] ?? null;
          const hovered = mechanical.hoveredPartId();
          const selected = mechanical.selectedPartId();
          const targetPart = parts.find((part) => part.id === (hovered ?? selected));

          if (floorMode) {
            for (const part of parts) if (part.def.energy) state.setWinding(part.id, false);
          } else {
            updateWinding(parts, input);
            if (input.mouse.justPressed(2)) {
              if (targetPart && isProductionMachine(targetPart.def)) {
                handleRightClick(targetPart, selectedItem);
              } else {
                const toggleTarget = sourceToggleTarget(parts, hovered, selected);
                if (toggleTarget !== undefined) state.toggleSource(toggleTarget);
              }
            }
            if (input.keyboard.justPressedCode('KeyR') && targetPart && isProductionMachine(targetPart.def)) {
              production.cycleMachineRecipe(targetPart.id);
            }
            // 悬停加工机器按 C：从库存投 1 件当前配方原料（快捷栏已被 11 种零件占满，
            // 不让玩家必须先回背包把矿石绑到快捷栏）。
            if (input.keyboard.justPressedCode('KeyC') && targetPart && isProductionMachine(targetPart.def)) {
              production.loadFromInventory(targetPart.id, {
                has: (itemId, count) => inventory.has(itemId, count),
                remove: (itemId, count) => inventory.remove(itemId, count),
              });
            }
          }

          const delta = world.getResource(Time).delta;
          state.step(delta);

          // 加工速率完全来自动力解算：转速被负载压下去，加工就变慢；断轴/停源则不推进。
          for (const part of parts) {
            if (part.def.kind !== 'machine' || !isProductionMachine(part.def)) continue;
            production.setPowerReading(part.id, {
              powered: machineIsDriven(part.id),
              rate: state.rateOf(part.id),
            });
          }
          production.tick(delta);
          // M2.0-P1-B：用真实快照推进目标进度（纯读取，不反向控制机械）。
          goalProgress.update({
            parts,
            mechanical: state.snapshot(),
            production: production.snapshot(),
            inventory,
          });

          for (const part of parts) {
            const view = mechanical.view(part.id);
            if (!view) continue; // 新建 view 允许晚一帧；已销毁 view 绝不写
            applySpin(world, view, part, state.angleOf(part.id));
            if (part.def.kind === 'machine') {
              applyMachinePose(world, view, state.poseOf(part.id));
            }
          }
          updateChuteItems(parts);

          const targetId = mechanical.selectedPartId() ?? mechanical.hoveredPartId();
          const readoutPart = targetId === undefined ? undefined : parts.find((part) => part.id === targetId);
          if (readoutPart === undefined) {
            readout.update(undefined);
            return;
          }
          readout.update(readoutFor(readoutPart.id, readoutPart.def.maxTorque));
        },
      }).unwrap();

      yield () => {
        world.removeSystem(Update, SYSTEM_NAME).unwrap();
        for (const entity of itemEntities.values()) world.despawn(entity).unwrap();
        itemEntities.clear();
        production.clear();
        readout.dispose();
        state.clear();
      };
    }, SYSTEM_NAME);
  },
};
