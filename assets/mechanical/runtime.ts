import { Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { createBoxGeometry } from '@forgeax/engine/geometry';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import type { Plugin } from '@forgeax/engine/plugin';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import type { GameProjectionValue } from '@forgeax/engine/app';
import type {} from '@forgeax/engine/assets-runtime';
import type {} from '../hotbar/hotbar.ts';
import type {} from '../inventory/inventory.ts';
import type {} from '../player/player.ts';
import { isMechanicalItem, type ItemId } from '../items/items.ts';
import { placementCenter } from '../grid/grid.ts';
import { levelBaseY } from '../spatial/space.ts';
import { FLOOR_MODE_KEY } from '../build/floors.ts';
import { isProductionMachine, type MechanicalPart } from './parts.ts';
import type { MechanicalService } from './mechanical.pack.ts';
import { applyMachinePose, applySpin } from './animation.ts';
import { createMechanicalReadout } from './readout.ts';
import { readoutTargetOf, type ReadoutTarget } from './readout-status.ts';
import { MechanicalRuntimeState, sourceToggleTarget } from './runtime-state.ts';
import { ProductionRuntime } from '../production/production-runtime.ts';
import { chuteItemWorldPosition } from '../production/transport.ts';
import { resolveSceneEntity } from '../shared/scene-refs.ts';

const SYSTEM_NAME = 'island-industria/mechanical-runtime';
/** 玩家离动力源多近才能摇动摇柄（米，水平距离）。 */
const WIND_VERTICAL_TOLERANCE = 2.5;

/**
 * M1.7-C runtime（M1.8 扩展为整条生产链的 tick 中枢）：
 * - 右键：悬停的正式/测试动力源 → 离合启停；悬停的加工机器 → 投料 / 取货；
 * - 按住 `F`：靠近手摇飞轮储能机时摇动摇柄给飞轮储能；
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
        return {
          ...base,
          production: production.snapshot(),
          inventory: inventorySnapshot,
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

      /** 按住 F 且靠近某台飞轮时给它储能；离开则停止摇动。 */
      const updateWinding = (parts: readonly MechanicalPart[], input: InputSnapshot): void => {
        const held = input.keyboard.downCode('KeyF');
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
