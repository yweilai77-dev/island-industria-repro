import { Update, type EntityHandle } from '@forgeax/engine/ecs';
import { createBoxGeometry } from '@forgeax/engine/geometry';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { quat } from '@forgeax/engine/math';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { Transform } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/assets-runtime';
import type {} from '@forgeax/engine/app';
import { normalizeRotation, withRotation } from '../grid/grid.ts';
import type {} from '../inventory/inventory.ts';
import { ITEM_IDS } from '../items/items.ts';
import type {} from '../player/player.ts';
import { FLOOR_MODE_KEY } from '../build/floors.ts';
import { BUILD_SYSTEM_NAME } from '../build/target.ts';
import type {} from '../mechanical/mechanical.pack.ts';
import { isProductionMachine, type MechanicalPart } from '../mechanical/parts.ts';
import { coreForPart } from './catalog.ts';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { PortRuntime } from './port-runtime.ts';
import { slotWorldOf } from './port-slot-world.ts';
import type {} from './ports.ts';
import type { PortService } from './ports.ts';

/**
 * M2.0-P2-B 接口盒插件：让接口盒真正参与游戏运行。
 *
 * 职责（只做 P2-B 授权范围内的事）：
 * 1. 持有接口盒运行时状态（哪个安装位装了什么盒、盒里压着多少物料）；
 * 2. 提供 `ports` 服务给加工运行时（自动输入的合法入口）；
 * 3. 把已安装的接口盒在世界里画出来，并**每帧**按机器当前 Placement 重算位置/朝向，
 *    所以旋转或搬动加工核心后盒子会跟着走（要求 2.8）；
 * 4. 安装 / 拆卸 / 旋转加工核心三个玩家操作；
 * 5. 机器被拆掉时把它的接口盒与缓冲里的物料全部交回库存（不丢物品）。
 *
 * 本插件**不**实现：核心间物流、分流/合流拓扑、组合机械、科技树（P2-C 及以后）。
 *
 * 操作键（P2-B 新增，均不与既有按键冲突——现有已用 A/C/D/E/F/G/Q/R/S/V/W/X/Delete/Backspace/1-0-=[]）：
 *   T  给悬停的加工核心安装一个基础接口盒（消耗背包里的真实物品）
 *   Y  拆下悬停加工核心上已装的接口盒（返还物品，盒内物料一并交回）
 *   U  旋转悬停/选中的加工核心 90°（安装位与已装接口盒随之更新）
 *
 * 为什么安装走背包而不是快捷栏：快捷栏 12 格已被 11 种机械零件占满（索引 5 必须保持空槽，
 * 历史验收脚本依赖它退出机械模式），并且任务书要求「从背包选择接口盒」。
 */

const SYSTEM_NAME = 'island-industria/port';
/** 开局原型套件：给 2 个基础接口盒，让玩家在还没有锻压机时也能验证安装与自动输入。 */
const PORT_KIT_KEY = 'IslandIndustriaPortKitGranted';
const PORT_KIT_COUNT = 2;
const HIDDEN_Y = -1000;
const DEG = Math.PI / 180;

interface PortView {
  readonly body: EntityHandle;
  readonly accent: EntityHandle;
}

function yawQuat(degrees: number): readonly [number, number, number, number] {
  const value = quat.fromAxisAngle(quat.create(), [0, 1, 0], degrees * DEG);
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1];
}

export const industrialPorts: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world', 'assets', 'mechanical', 'inventory'],
  apply(ctx) {
    const world = ctx.world;
    const assets = ctx.assets;
    if (!assets) throw new Error('port system requires asset service');
    const mechanical = ctx.mechanical;
    const inventory = ctx.inventory;

    ctx.effect(function* () {
      const runtime = new PortRuntime();
      const bodyMesh = assets.create(createBoxGeometry(0.30, 0.20, 0.16).unwrap()).unwrap();
      const accentMesh = assets.create(createBoxGeometry(0.14, 0.07, 0.08).unwrap()).unwrap();
      const bodyMaterial = assets.create(
        Materials.standard({ baseColor: [0.52, 0.57, 0.62, 1], metallic: 0.55, roughness: 0.42 }),
      ).unwrap();
      const accentMaterial = assets.create(
        Materials.standard({ baseColor: [0.85, 0.6, 0.2, 1], metallic: 0.4, roughness: 0.45 }),
      ).unwrap();
      yield () => {
        assets!.release(bodyMesh).unwrap();
        assets!.release(accentMesh).unwrap();
        assets!.release(bodyMaterial).unwrap();
        assets!.release(accentMaterial).unwrap();
      };

      const views = new Map<string, PortView>();
      const viewKey = (partId: number, slotId: string): string => `${partId}:${slotId}`;

      const spawnView = (partId: number, slotId: string): PortView => {
        const body = world
          .spawn(
            { component: Transform, data: { pos: [0, HIDDEN_Y, 0], scale: [1, 1, 1] } },
            { component: MeshFilter, data: { assetHandle: bodyMesh } },
            { component: MeshRenderer, data: { materials: [bodyMaterial] } },
          )
          .unwrap();
        const accent = world
          .spawn(
            { component: Transform, data: { pos: [0, HIDDEN_Y, 0], scale: [1, 1, 1] } },
            { component: MeshFilter, data: { assetHandle: accentMesh } },
            { component: MeshRenderer, data: { materials: [accentMaterial] } },
          )
          .unwrap();
        const view = { body, accent };
        views.set(viewKey(partId, slotId), view);
        return view;
      };

      const grantKit = (): void => {
        if (world.hasResource(PORT_KIT_KEY)) return;
        inventory.add(ITEM_IDS.INTERFACE_BOX, PORT_KIT_COUNT);
        world.insertResource(PORT_KIT_KEY, 1);
      };
      grantKit();

      const service: PortService = {
        installedOf: (partId) => runtime.installedOf(partId),
        inputBoxesOf: (partId) => runtime.inputBoxesOf(partId),
        accept: (partId, slotId, itemId) => runtime.accept(partId, slotId, itemId),
        drain: (partId, tryInsert) => runtime.drain(partId, tryInsert),
        snapshot: () => runtime.snapshot(),
      };
      yield ctx.provide('ports', service);

      /** 机器被拆掉：接口盒与盒内物料全部交回库存。 */
      const syncRemovedMachines = (parts: readonly MechanicalPart[]): void => {
        const alive = new Set(parts.map((part) => part.id));
        for (const removed of runtime.sync(alive)) {
          for (const item of removed.items) inventory.add(item.itemId, item.count);
        }
      };

      /** 每帧按机器当前 Placement 重算接口盒世界位置（旋转/搬动后自动跟随）。 */
      const updateViews = (parts: readonly MechanicalPart[]): void => {
        const byId = new Map<number, MechanicalPart>();
        for (const part of parts) byId.set(part.id, part);
        const alive = new Set<string>();
        for (const partId of [...byId.keys()].sort((a, b) => a - b)) {
          const part = byId.get(partId);
          if (!part) continue;
          for (const port of runtime.installedOf(partId)) {
            const key = viewKey(partId, port.slot.id);
            alive.add(key);
            const view = views.get(key) ?? spawnView(partId, port.slot.id);
            const slot = slotWorldOf(part, port.slot);
            const rotation = yawQuat(slot.yaw);
            world.set(view.body, Transform, {
              pos: [slot.center[0], slot.center[1], slot.center[2]],
              quat: rotation,
              scale: [1, 1, 1],
            }).unwrap();
            world.set(view.accent, Transform, {
              pos: [
                slot.center[0] + slot.outward[0] * 0.1,
                slot.center[1] + slot.outward[1] * 0.1,
                slot.center[2] + slot.outward[2] * 0.1,
              ],
              quat: rotation,
              scale: [1, 1, 1],
            }).unwrap();
          }
        }
        for (const [key, view] of [...views]) {
          if (alive.has(key)) continue;
          views.delete(key);
          world.despawn(view.body).unwrap();
          world.despawn(view.accent).unwrap();
        }
      };

      const hoveredMachine = (): MechanicalPart | undefined => {
        const partId = mechanical.hoveredPartId() ?? mechanical.selectedPartId();
        if (partId === undefined) return undefined;
        const part = mechanical.parts().find((entry) => entry.id === partId);
        if (!part || !isProductionMachine(part.def)) return undefined;
        return part;
      };

      /** T：从背包安装一个基础接口盒到该核心第一个空闲输入安装位。 */
      const installOn = (part: MechanicalPart): void => {
        const core = coreForPart(part.def.id);
        if (!core) return;
        const slot = runtime.freeInputSlotOf(core, part.id);
        if (!slot) return;
        if (!inventory.has(ITEM_IDS.INTERFACE_BOX, 1)) return;
        const verdict = runtime.install(part.id, core, slot.id, 'port.through');
        if (!verdict.ok) return;
        inventory.remove(ITEM_IDS.INTERFACE_BOX, 1);
      };

      /** Y：拆下该核心输入位的接口盒，返还盒子并把盒内物料交回库存（永不销毁）。 */
      const removeFrom = (part: MechanicalPart): void => {
        const port = runtime.inputBoxesOf(part.id)[0];
        if (!port) return;
        const removal = runtime.remove(part.id, port.slot.id);
        if (!removal) return;
        inventory.add(removal.moduleItemId, 1);
        if (removal.bufferItemId !== null && removal.bufferCount > 0) {
          inventory.add(removal.bufferItemId, removal.bufferCount);
        }
      };

      /** U：旋转加工核心 90°；放置事务由 mechanical 服务保证校验与回滚。 */
      const rotateCore = (part: MechanicalPart): void => {
        mechanical.updatePlacement(part.id, withRotation(part.placement, normalizeRotation(part.placement.rotation + 90)));
      };

      world.addSystem(Update, {
        name: SYSTEM_NAME,
        after: [BUILD_SYSTEM_NAME],
        queries: [],
        fn: () => {
          const parts = mechanical.parts();
          syncRemovedMachines(parts);
          updateViews(parts);

          // 楼层建造模式：机械交互整体让出输入（与 mechanical 插件一致）。
          if (world.hasResource(FLOOR_MODE_KEY)) return;
          const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          const target = hoveredMachine();
          if (!target) return;
          if (input.keyboard.justPressedCode('KeyT')) installOn(target);
          else if (input.keyboard.justPressedCode('KeyY')) removeFrom(target);
          else if (input.keyboard.justPressedCode('KeyU')) rotateCore(target);
        },
      }).unwrap();

      yield () => {
        world.removeSystem(Update, SYSTEM_NAME).unwrap();
        for (const view of views.values()) {
          world.despawn(view.body).unwrap();
          world.despawn(view.accent).unwrap();
        }
        views.clear();
        runtime.clear();
      };
    }, SYSTEM_NAME);
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.industrial,
  name: 'ISLAND INDUSTRIA / Industrial Ports',
  plugins: true,
  build: () =>
    ok({
      'plugin/ports': {
        kind: 'plugin',
        module: { specifier: './port.pack.ts', export: 'industrialPorts' },
      },
    }),
});
