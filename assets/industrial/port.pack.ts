import { Update } from '@forgeax/engine/ecs';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/assets-runtime';
import type {} from '@forgeax/engine/app';
import { normalizeRotation, withRotation } from '../grid/grid.ts';
import type {} from '../inventory/inventory.ts';
import { ITEM_IDS, type ItemId } from '../items/items.ts';
import type {} from '../player/player.ts';
import { FLOOR_MODE_KEY } from '../build/floors.ts';
import { STRUCTURE_MODE_KEY } from '../shared/placement-mode.ts';
import { BUILD_SYSTEM_NAME } from '../build/target.ts';
import type {} from '../mechanical/mechanical.pack.ts';
import type {} from '../tech/tech.pack.ts';
import type { TechCapabilityId } from '../tech/types.ts';
import { isProductionMachine, type MechanicalPart } from '../mechanical/parts.ts';
import { coreForPart } from './catalog.ts';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import type { PortModuleId, PortSlotId } from './ids.ts';
import type { LinkScene } from './link-runtime.ts';
import { MaterialLinkRuntime } from './link-runtime.ts';
import { portModuleOfId } from './port-module.ts';
import { PortRuntime, type InstalledPort } from './port-runtime.ts';
import { PortViewRegistry } from './port-views.ts';
import type {} from './ports.ts';
import type { PortService } from './ports.ts';

/**
 * M2.0-P2-C 接口盒与物料连接插件（在 P2-B 的输入接口盒基础上扩展）。
 *
 * 职责：
 * 1. 持有接口盒运行时（输入/输出位）与物料连接运行时；
 * 2. 提供 `ports` 服务给加工运行时：自动输入、自动输出、连接推进与读投影；
 * 3. 世界表现：接口盒按功能分色、物料连接画成铜管、建链源头高亮；
 * 4. 玩家操作（均为新增键，不与现有键位冲突）：
 *      T  给悬停核心的输入安装位装「基础接口盒」
 *      O  给悬停核心的输出安装位装「输出接口盒」
 *      K  给悬停核心的输出安装位装「分流接口盒」
 *      L  给悬停核心的输入安装位装「合流接口盒」
 *      Y  拆下悬停核心上的接口盒（优先输入位，其次输出位；返还物品与盒内物料）
 *      J  建立物料连接：先悬停上游核心按 J 选中输出接口，再悬停下游核心按 J 连到它的输入接口；
 *         再按一次 J 可取消选中
 *      H  解除悬停核心上的全部物料连接
 *      U  旋转悬停/选中的加工核心（P2-B 已有，安装位与连接随之更新）
 * 5. 机器被拆掉时：接口盒与缓冲物料交回库存，相关连接清除（不丢物品）。
 *
 * 本插件**不**实现：组合机械、科技树、传送带网络、跨层物流（P2-D 及以后）。
 */

const SYSTEM_NAME = 'island-industria/port';
const PORT_KIT_KEY = 'IslandIndustriaPortKitGranted';
/** 开局原型套件：给足搭多核心生产线的最小盒数（与既有「开局给一批零件」一致）。 */
const PORT_KIT: readonly (readonly [ItemId, number])[] = Object.freeze([
  [ITEM_IDS.INTERFACE_BOX, 4],
  [ITEM_IDS.OUTPUT_INTERFACE_BOX, 3],
  [ITEM_IDS.SPLITTER_BOX, 1],
  [ITEM_IDS.MERGER_BOX, 1],
]);

interface EquippedPortWindow {
  readonly partId: number;
  readonly slotId: PortSlotId;
}

export const industrialPorts: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world', 'assets', 'mechanical', 'inventory', 'tech'],
  apply(ctx) {
    const world = ctx.world;
    const assets = ctx.assets;
    if (!assets) throw new Error('port system requires asset service');
    const mechanical = ctx.mechanical;
    const inventory = ctx.inventory;
    const tech = ctx.tech;

    ctx.effect(function* () {
      const runtime = new PortRuntime();
      const links = new MaterialLinkRuntime();
      const views = new PortViewRegistry(world, assets);
      yield () => {
        views.dispose(assets!);
        runtime.clear();
        links.clear();
      };

      // P2-E1：接口盒不再作为开局套件发放；只有 legacy 兼容模式（旧验收脚本）才补发。
      const grantLegacyKit = (): void => {
        if (world.hasResource(PORT_KIT_KEY)) return;
        for (const [itemId, count] of PORT_KIT) inventory.add(itemId, count);
        world.insertResource(PORT_KIT_KEY, 1);
      };

      const sceneOf = (parts: readonly MechanicalPart[] = mechanical.parts()): LinkScene => {
        const byId = new Map<number, MechanicalPart>();
        for (const part of parts) byId.set(part.id, part);
        return {
          partOf: (partId) => byId.get(partId),
          portOf: (partId, slotId) => runtime.get(partId, slotId),
        };
      };

      const service: PortService = {
        installedOf: (partId) => runtime.installedOf(partId),
        inputBoxesOf: (partId) => runtime.inputBoxesOf(partId),
        outputBoxesOf: (partId) => runtime.outputBoxesOf(partId),
        accept: (partId, slotId, itemId) => runtime.accept(partId, slotId, itemId),
        drain: (partId, tryInsert) => runtime.drain(partId, tryInsert),
        bufferOf: (partId, slotId) => runtime.bufferOf(partId, slotId),
        stepLinks: () => links.step(sceneOf(), runtime),
        links: () => links.snapshot(sceneOf()),
        createLink: (from, to) => links.create(from, to, sceneOf()),
        removeLinksAt: (partId, slotId) => links.removeAt(partId, slotId),
        snapshot: () => runtime.snapshot(),
      };
      yield ctx.provide('ports', service);

      /** 建链时选中的上游输出接口（世界表现用一个绿色标记标出）。 */
      let armed: EquippedPortWindow | undefined;

      const hoveredMachine = (): MechanicalPart | undefined => {
        const partId = mechanical.hoveredPartId() ?? mechanical.selectedPartId();
        if (partId === undefined) return undefined;
        const part = mechanical.parts().find((entry) => entry.id === partId);
        if (!part || !isProductionMachine(part.def)) return undefined;
        return part;
      };

      /** 每个动作对应的科技能力门控（业务入口检查，不是 UI 隐藏）。 */
      const capabilityOf = (moduleId: PortModuleId, role: 'input' | 'output'): TechCapabilityId => {
        if (moduleId === 'port.through') return role === 'input' ? 'port-input-install' : 'port-output-install';
        if (moduleId === 'port.output') return 'port-output-install';
        return 'split-merge';
      };

      /** 安装一个接口盒：科技门控 → 背包有货 → 运行时校验 → 成功后才扣物品。 */
      const installModule = (part: MechanicalPart, moduleId: PortModuleId, role: 'input' | 'output'): void => {
        const core = coreForPart(part.def.id);
        if (!core) return;
        const module = portModuleOfId(moduleId);
        if (!module || module.itemId === null) return;
        if (!module.fitsSlotRoles.includes(role)) return;
        if (!tech.isPortUnlocked(module.id)) return;
        if (!tech.hasCapability(capabilityOf(moduleId, role))) return;
        const slot = role === 'input'
          ? runtime.freeInputSlotOf(core, part.id)
          : runtime.freeOutputSlotOf(core, part.id);
        if (!slot) return;
        if (!inventory.has(module.itemId, 1)) return;
        const verdict = runtime.install(part.id, core, slot.id, module.id);
        if (!verdict.ok) return;
        inventory.remove(module.itemId, 1);
        if (armed && armed.partId === part.id) armed = undefined;
      };

      /** 拆卸接口盒：返还盒子 + 盒内物料，并解除该端口上的物料连接（任务书 P2-C-1 #9）。 */
      const removeModule = (part: MechanicalPart): void => {
        const port = runtime.inputBoxesOf(part.id)[0] ?? runtime.outputBoxesOf(part.id)[0];
        if (!port) return;
        const removal = runtime.remove(part.id, port.slot.id);
        if (!removal) return;
        links.removeAt(part.id, port.slot.id);
        inventory.add(removal.moduleItemId, 1);
        if (removal.bufferItemId !== null && removal.bufferCount > 0) {
          inventory.add(removal.bufferItemId, removal.bufferCount);
        }
        if (armed && armed.partId === part.id && armed.slotId === port.slot.id) armed = undefined;
      };

      /** J：第一次选中上游输出接口；第二次连到下游输入接口；点回源头取消。 */
      const linkAction = (part: MechanicalPart): void => {
        if (!tech.hasCapability('material-link')) return;
        const outputs = runtime.outputBoxesOf(part.id);
        if (armed) {
          if (armed.partId === part.id && outputs.some((port) => port.slot.id === armed?.slotId)) {
            armed = undefined;
            return;
          }
          for (const target of runtime.inputBoxesOf(part.id)) {
            const result = links.create(
              { entityId: armed.partId, slotId: armed.slotId },
              { entityId: part.id, slotId: target.slot.id },
              sceneOf(),
            );
            if (!result.ok) continue;
            armed = undefined;
            return;
          }
          return;
        }
        const source = outputs[0];
        if (source) armed = { partId: part.id, slotId: source.slot.id };
      };

      /** H：解除悬停核心上所有端口上的物料连接（先解输入侧，再解输出侧）。 */
      const unlink = (part: MechanicalPart): number => {
        if (!tech.hasCapability('material-link')) return 0;
        let removed = 0;
        for (const port of runtime.inputBoxesOf(part.id)) removed += links.removeAt(part.id, port.slot.id);
        for (const port of runtime.outputBoxesOf(part.id)) removed += links.removeAt(part.id, port.slot.id);
        if (armed && armed.partId === part.id) armed = undefined;
        return removed;
      };

      /** U：旋转加工核心 90°；位置事务由 mechanical 服务保证校验与回滚。 */
      const rotateCore = (part: MechanicalPart): void => {
        mechanical.updatePlacement(
          part.id,
          withRotation(part.placement, normalizeRotation(part.placement.rotation + 90)),
        );
      };

      world.addSystem(Update, {
        name: SYSTEM_NAME,
        after: [BUILD_SYSTEM_NAME],
        queries: [],
        fn: () => {
          // P2-E1：legacy 兼容模式补发历史接口盒套件（正式流程没有任何接口盒开局供给）。
          if (tech.mode() === 'legacy') grantLegacyKit();
          const parts = mechanical.parts();
          const alive = new Set(parts.map((part) => part.id));
          // 机器被拆掉：接口盒与盒内物料交回库存，连接一并清除（不丢物品）。
          for (const removed of runtime.sync(alive)) {
            for (const item of removed.items) inventory.add(item.itemId, item.count);
          }
          links.sync(alive);
          if (armed && runtime.get(armed.partId, armed.slotId) === undefined) armed = undefined;

          const installed: InstalledPort[] = [];
          for (const part of parts) for (const port of runtime.installedOf(part.id)) installed.push(port);
          views.update({ parts, ports: installed, links: links.snapshot(sceneOf(parts)), armed });

          // 楼层建造模式：机械/接口交互整体让出输入（与 mechanical 插件一致）。
          if (world.hasResource(FLOOR_MODE_KEY) || world.hasResource(STRUCTURE_MODE_KEY)) return;
          const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          if (input.keyboard.justPressedCode('Escape') && armed) {
            armed = undefined;
            return;
          }
          const target = hoveredMachine();
          if (!target) return;
          if (input.keyboard.justPressedCode('KeyT')) installModule(target, 'port.through', 'input');
          else if (input.keyboard.justPressedCode('KeyO')) installModule(target, 'port.output', 'output');
          else if (input.keyboard.justPressedCode('KeyK')) installModule(target, 'port.splitter', 'output');
          else if (input.keyboard.justPressedCode('KeyL')) installModule(target, 'port.merger', 'input');
          else if (input.keyboard.justPressedCode('KeyY')) removeModule(target);
          else if (input.keyboard.justPressedCode('KeyJ')) linkAction(target);
          else if (input.keyboard.justPressedCode('KeyH')) unlink(target);
          else if (input.keyboard.justPressedCode('KeyU')) rotateCore(target);
        },
      }).unwrap();

      yield () => {
        world.removeSystem(Update, SYSTEM_NAME).unwrap();
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
      // P2-D 组合机械：结构框架放置 + Assembly 运行时（同属 industrial 包）。
      'plugin/assembly': {
        kind: 'plugin',
        module: { specifier: './assembly-system.ts', export: 'industrialAssembly' },
      },
    }),
});
