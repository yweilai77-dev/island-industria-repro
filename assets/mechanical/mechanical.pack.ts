import { Update, type EntityHandle } from '@forgeax/engine/ecs';
import { quat } from '@forgeax/engine/math';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { definePack } from '@forgeax/engine/pack/source';
import { viewportToWorld } from '@forgeax/engine/picking';
import type { Plugin } from '@forgeax/engine/plugin';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { Transform } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import type { Aabb } from '../spatial/space.ts';
import {
  levelBaseY,
  placementAabb,
} from '../spatial/space.ts';
import { pickSupportTarget } from '../spatial/picking.ts';
import { validatePlacement, rayAabbDistance } from '../build/build.ts';
import { BUILD_SYSTEM_NAME } from '../build/target.ts';
import { resolveSceneEntity } from '../shared/scene-refs.ts';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { createPlacement, normalizeRotation, placementCenter, type Placement, type Rotation } from '../grid/grid.ts';
import { overlapsPlayer } from '../player/occupancy.ts';
import type {} from '../player/player.ts';
import type {} from '../inventory/inventory.ts';
import { HOTBAR_SLOT_COUNT } from '../hotbar/hotbar.ts';
import type {} from '../spatial/service.ts';
import type {} from '@forgeax/engine/app';
import { FLOOR_MODE_KEY } from '../build/floors.ts';
import { STRUCTURE_MODE_KEY } from '../shared/placement-mode.ts';
import { BUILD_TARGET_STATE_KEY, type BuildTargetState } from '../build/target.ts';
import type {} from '../tech/tech.pack.ts';
import {
  INHERITED_WORKSHOP,
  INHERITED_WORKSHOP_DEFAULT_SLOT,
  INHERITED_WORKSHOP_SLOTS,
} from '../tech/start-kit.ts';
import type { TechProgressionMode } from '../tech/types.ts';
import {
  PROTOTYPE_KIT,
  PROTOTYPE_KIT_SLOTS,
  MECHANICAL_PART_DEFS,
  MECH_STRUCTURE_PREFIX,
  partDefForItem,
  structureIdForPart,
  type MechanicalPart,
  type MechanicalPartDef,
  type PartId,
} from './parts.ts';
import { portWorld, type Connection } from './ports.ts';
import { MechanicalRegistry } from './registry.ts';
import { normalizeKitGranted, normalizePartsSlice, type SaveMechanicalData } from '../save/save-schema.ts';
import type { SaveRestoreReport } from '../save/save-ports.ts';
import {
  PartViewRegistry,
  createMechanicalViewAssets,
  createPartView,
  releaseMechanicalViewAssets,
  type MechanicalViewAssets,
  type PartView,
} from './visuals.ts';

const SYSTEM_NAME = 'island-industria/mechanical';
const KIT_GRANTED_KEY = 'IslandIndustriaMechanicalKitGranted';
const HIDDEN_Y = -1000;
const DEG = Math.PI / 180;

export interface MechanicalService {
  readonly revision: number;
  parts(): readonly MechanicalPart[];
  connections(): readonly Connection[];
  partAt(cell: { gx: number; gz: number }, level: number): MechanicalPart | undefined;
  /** 事务化的位置更新（A 阶段不暴露 G，留给 B 的搬动/旋转）。 */
  updatePlacement(partId: number, next: Placement): boolean;
  /** 结构模块等外部系统使用的放置前校验（只校验，不消耗物品；含科技门控）。 */
  canPlacePart(definitionId: PartId, placement: Placement): boolean;
  /** 借现有机械事务放置一个零件：校验 + registry + 空间 + 视图 + 消耗物品。 */
  placePart(definitionId: PartId, placement: Placement): boolean;
  /** B runtime：只读视图访问；生命周期仍由本 pack 管理。 */
  view(partId: number): PartView | undefined;
  hoveredPartId(): number | undefined;
  selectedPartId(): number | undefined;
  /** 存档切片：零件（id/kind/placement）+ nextPartId + kitGranted；不含动力源启停。 */
  saveSnapshot(): SaveMechanicalData;
  /** 读档：用既有注册原语重建零件（不消耗物品、不检查科技门控、不重复发起步包）。 */
  restoreSave(rawParts: unknown, rawNextPartId: unknown, rawKitGranted: unknown): SaveRestoreReport;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    mechanical: MechanicalService;
  }
}

function aabbContainsCell(aabb: Aabb, cell: { gx: number; gz: number }, level: number): boolean {
  const x = cell.gx + 0.5;
  const z = cell.gz + 0.5;
  const y = levelBaseY(level) + 0.5;
  return aabb.min[0] <= x && aabb.max[0] >= x
    && aabb.min[2] <= z && aabb.max[2] >= z
    && aabb.min[1] <= y && aabb.max[1] >= y;
}

function partIdFromStructureId(id: string): number | undefined {
  if (!id.startsWith(MECH_STRUCTURE_PREFIX)) return undefined;
  const value = Number(id.slice(MECH_STRUCTURE_PREFIX.length));
  return Number.isInteger(value) ? value : undefined;
}

export const mechanicalSystem: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world', 'assets', 'gameScene', 'player', 'hotbar', 'inventory', 'spatial', 'resourceNodes', 'executionBootstrapHost', 'tech'],
  apply(ctx) {
    const world = ctx.world;
    const assets = ctx.assets;
    if (!assets) throw new Error('mechanical system requires asset service');
    const camera = resolveSceneEntity(world, ctx.gameScene, 'camera');
    const player = ctx.player;
    const hotbar = ctx.hotbar;
    const inventory = ctx.inventory;
    const spatial = ctx.spatial;
    const resourceNodes = ctx.resourceNodes;
    const bootstrapHost = ctx.executionBootstrapHost;
    const tech = ctx.tech;

    ctx.effect(function* () {
      const viewAssets: MechanicalViewAssets = createMechanicalViewAssets(assets);
      const views = new PartViewRegistry(world);
      const registry = new MechanicalRegistry();
      const validGhost = spawnGhost(world, viewAssets.ghostMesh, viewAssets.ghostValidMaterial);
      const invalidGhost = spawnGhost(world, viewAssets.ghostMesh, viewAssets.ghostInvalidMaterial);
      const selection = spawnGhost(world, viewAssets.ghostMesh, viewAssets.selectionMaterial);
      let rotation: Rotation = 0;
      let selectedPartId: number | undefined;
      let hoveredPartId: number | undefined;

      const hideGhost = (entity: EntityHandle): void => {
        world.set(entity, Transform, { pos: [0, HIDDEN_Y, 0] }).unwrap();
      };
      hideGhost(validGhost);
      hideGhost(invalidGhost);
      hideGhost(selection);

      // P2-E1：正式起步包（继承工坊）。旧 PROTOTYPE_KIT 只保留给 legacy 兼容模式。
      let kitMode: TechProgressionMode = 'player';
      const grantStarterKit = (): void => {
        if (world.hasResource(KIT_GRANTED_KEY)) return;
        for (const entry of INHERITED_WORKSHOP) inventory.add(entry.itemId, entry.count);
        for (const binding of INHERITED_WORKSHOP_SLOTS) hotbar.bind(binding.slot, binding.itemId);
        // 默认选中空槽（索引 5），保留 M1.5 的普通建造默认行为。
        hotbar.select(INHERITED_WORKSHOP_DEFAULT_SLOT);
        world.insertResource(KIT_GRANTED_KEY, 1);
      };
      /**
       * legacy 兼容模式（仅旧 M1/P2 验收脚本）：
       * 把正式起步包换成历史原型套件，并把快捷栏恢复为历史槽位表。
       * 只在世界启动阶段被调用（脚本刚 reload，尚未建造任何东西）。
       */
      const switchToLegacyKit = (): void => {
        if (kitMode === 'legacy') return;
        for (const entry of INHERITED_WORKSHOP) {
          const have = inventory.count(entry.itemId);
          if (have > 0) inventory.remove(entry.itemId, Math.min(have, entry.count));
        }
        for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) hotbar.unbind(slot);
        for (const { slot, id } of PROTOTYPE_KIT_SLOTS) {
          const definition = MECHANICAL_PART_DEFS[id];
          inventory.add(definition.itemId, PROTOTYPE_KIT[id]);
          if (slot < HOTBAR_SLOT_COUNT) hotbar.bind(slot, definition.itemId);
        }
        hotbar.select(5);
        kitMode = 'legacy';
      };
      grantStarterKit();

      const partAt = (cell: { gx: number; gz: number }, level: number): MechanicalPart | undefined => {
        for (const collider of spatial.structures.all()) {
          const partId = partIdFromStructureId(collider.id);
          if (partId === undefined) continue;
          if (!aabbContainsCell(collider.aabb, cell, level)) continue;
          const part = registry.get(partId);
          if (part) return part;
        }
        return undefined;
      };

      const updateViewPlacement = (part: MechanicalPart): void => {
        const view = views.get(part.id);
        if (!view) return;
        const center = placementCenter(part.placement);
        const yaw = quat.fromAxisAngle(quat.create(), [0, 1, 0], part.placement.rotation * DEG);
        world.set(view.root, Transform, {
          pos: [center[0], levelBaseY(part.placement.level), center[2]],
          quat: [yaw[0] ?? 0, yaw[1] ?? 0, yaw[2] ?? 0, yaw[3] ?? 1],
        }).unwrap();
      };

      /**
       * 位置更新事务：
       * 1) 先注销旧 structure；2) 用 SpatialIndex 校验新位置；3) 更新 Registry；
       * 4) 注册新 structure + 更新实体；5) 成功后才 commitTopology。
       * 任一步失败恢复旧 Registry/SpatialIndex/Entity，不增加 revision。
       */
      const updatePlacement = (partId: number, next: Placement): boolean => {
        const part = registry.get(partId);
        if (!part) return false;
        const old = part.placement;
        spatial.structures.unregister(structureIdForPart(partId));
        let updated = false;
        try {
          if (!validPlacement(part.def, next)) {
            spatial.structures.register({
              id: structureIdForPart(partId),
              aabb: placementAabb(old, part.def.height),
              blocksBuild: true,
              blocksPlayer: true,
            });
            return false;
          }
          if (!registry.updatePlacement(partId, next)) {
            spatial.structures.register({
              id: structureIdForPart(partId),
              aabb: placementAabb(old, part.def.height),
              blocksBuild: true,
              blocksPlayer: true,
            });
            return false;
          }
          updated = true;
          spatial.structures.register({
            id: structureIdForPart(partId),
            aabb: placementAabb(next, part.def.height),
            blocksBuild: true,
            blocksPlayer: true,
          });
          updateViewPlacement({ ...part, placement: next });
          commitTopology();
          return true;
        } catch (error) {
          if (updated) registry.updatePlacement(partId, old);
          spatial.structures.unregister(structureIdForPart(partId));
          spatial.structures.register({
            id: structureIdForPart(partId),
            aabb: placementAabb(old, part.def.height),
            blocksBuild: true,
            blocksPlayer: true,
          });
          updateViewPlacement(part);
          throw error;
        }
      };

      const service: MechanicalService = {
        get revision() { return registry.revision; },
        parts: () => registry.all(),
        connections: () => registry.connections(),
        partAt,
        updatePlacement,
        canPlacePart: (definitionId, placement) => canPlacePart(definitionId, placement),
        placePart: (definitionId, placement) => placePart(definitionId, placement),
        view: (partId) => views.get(partId),
        hoveredPartId: () => hoveredPartId,
        selectedPartId: () => selectedPartId,
        saveSnapshot: () => saveSnapshot(),
        restoreSave: (rawParts, rawNextPartId, rawKitGranted) => restoreSave(rawParts, rawNextPartId, rawKitGranted),
      };

      const selectedItem = (): ReturnType<typeof partDefForItem> => {
        const itemId = hotbar.slots[hotbar.selected] ?? null;
        const definition = partDefForItem(itemId);
        if (definition === undefined) return undefined;
        // 科技门控：未解锁零件的持有物品也不能进入放置模式（防绕过）。
        return tech.isPartUnlocked(definition.id) ? definition : undefined;
      };

      const currentLevel = (): number | undefined => {
        const supportId = player.state.supportId;
        if (supportId === null) return undefined;
        const support = spatial.supports.get(supportId);
        if (!support || !support.buildable) return undefined;
        return support.level;
      };

      const rayFromMouse = (input: InputSnapshot): ArrayLike<number> | undefined => {
        const size = bootstrapHost.drawingBufferSize();
        const position = input.mouse.position;
        if (!position || size.width <= 0 || size.height <= 0) return undefined;
        if (position.x < 0 || position.x >= size.width || position.y < 0 || position.y >= size.height) {
          return undefined;
        }
        return viewportToWorld(world, camera, position.x, position.y, size.width, size.height);
      };

      const placementFor = (target: { cell: { gx: number; gz: number } }, level: number): Placement =>
        createPlacement(target.cell.gx, target.cell.gz, 1, 1, rotation, level);

      const validPlacement = (definition: MechanicalPartDef, placement: Placement): boolean => {
        const verdict = validatePlacement(placement, definition.height, {
          spatial: spatial.index,
          supports: spatial.supports,
          playerCell: player.cell,
          playerFeetY: player.state.position[1],
          isCellBlocked: (cell) => resourceNodes.isCellBlocked(cell),
        });
        if (!verdict.ok) return false;
        const aabb = placementAabb(placement, definition.height);
        return !overlapsPlayer(aabb, player.state.position[0], player.state.position[1], player.state.position[2]);
      };

      const refreshJoints = (): void => {
        const anchors: { id: string; anchor: [number, number, number] }[] = [];
        for (const connection of registry.connections()) {
          const a = registry.get(connection.aPartId);
          const b = registry.get(connection.bPartId);
          if (!a || !b) continue;
          const aPort = a.def.ports.find((port) => port.id === connection.aPortId);
          if (!aPort) continue;
          const worldPort = portWorld(a, aPort);
          anchors.push({ id: connection.id, anchor: [worldPort.anchor[0], worldPort.anchor[1], worldPort.anchor[2]] });
        }
        views.refreshJoints(anchors, viewAssets);
      };

      const publishTarget = (target: BuildTargetState): void => {
        world.insertResource(BUILD_TARGET_STATE_KEY, target);
      };

      const commitTopology = (): void => {
        // 先重建连接和接头，只有全部成功后才增加 revision。
        registry.rebuildConnections();
        refreshJoints();
        registry.commitTopology();
      };

      const rollbackPlace = (partId: number): void => {
        spatial.structures.unregister(structureIdForPart(partId));
        views.dispose(partId);
        registry.remove(partId);
      };

      const place = (definition: MechanicalPartDef, placement: Placement): boolean => {
        // 科技门控（业务入口，不是 UI 隐藏）：未解锁的机器/结构不允许放置。
        if (!tech.isPartUnlocked(definition.id)) return false;
        if (!inventory.has(definition.itemId, 1)) return false;
        const partId = registry.allocateId();
        const part: MechanicalPart = { id: partId, def: definition, placement };
        let registered = false;
        let viewAdded = false;
        let consumed = false;
        try {
          if (!registry.add(part)) return false;
          spatial.structures.register({
            id: structureIdForPart(partId),
            aabb: placementAabb(placement, definition.height),
            blocksBuild: true,
            blocksPlayer: true,
          });
          registered = true;
          views.add(partId, createPartView(world, part, viewAssets));
          viewAdded = true;
          if (!inventory.remove(definition.itemId, 1)) {
            rollbackPlace(partId);
            return false;
          }
          consumed = true;
          commitTopology();
          return true;
        } catch (error) {
          if (consumed) inventory.add(definition.itemId, 1);
          if (registered || viewAdded) rollbackPlace(partId);
          throw error;
        }
      };

      /** 供结构模块等外部系统使用：只校验放置合法性（不消耗物品、不改任何状态）。 */
      const canPlacePart = (definitionId: PartId, placement: Placement): boolean => {
        const definition = MECHANICAL_PART_DEFS[definitionId];
        if (!definition) return false;
        if (!tech.isPartUnlocked(definitionId)) return false;
        return validPlacement(definition, placement);
      };

      /** 借现有机械事务放置零件：校验 + registry + 空间 + 视图 + 消耗物品（失败不产生半状态）。 */
      const placePart = (definitionId: PartId, placement: Placement): boolean => {
        const definition = MECHANICAL_PART_DEFS[definitionId];
        if (!definition) return false;
        if (!tech.isPartUnlocked(definitionId)) return false;
        if (!validPlacement(definition, placement)) return false;
        return place(definition, placement);
      };

      const remove = (partId: number): boolean => {
        const part = registry.get(partId);
        if (!part) return false;
        try {
          spatial.structures.unregister(structureIdForPart(partId));
          views.dispose(partId);
          const removed = registry.remove(partId);
          if (!removed) return false;
          inventory.add(removed.def.itemId, 1);
          commitTopology();
          if (selectedPartId === partId) selectedPartId = undefined;
          return true;
        } catch (error) {
          // 防御性：空间/实体清理失败时恢复注册，避免留下幽灵占用。
          if (registry.get(partId)) {
            spatial.structures.register({
              id: structureIdForPart(partId),
              aabb: placementAabb(part.placement, part.def.height),
              blocksBuild: true,
              blocksPlayer: true,
            });
          }
          throw error;
        }
      };

      // ---- 存档：零件/计数器/起步包标记（restore 走既有注册原语，不消耗物品） ----
      const saveSnapshot = (): SaveMechanicalData => ({
        nextPartId: registry.nextPartId,
        kitGranted: world.hasResource(KIT_GRANTED_KEY),
        parts: registry.all()
          .slice()
          .sort((a, b) => a.id - b.id)
          .map((part) => ({
            id: part.id,
            kind: part.def.id,
            gx: part.placement.gx,
            gz: part.placement.gz,
            rotation: part.placement.rotation,
            level: part.placement.level,
          })),
      });

      /** 清空当前世界的全部零件与视图；读档前调用（幂等）。 */
      const clearAllParts = (): void => {
        for (const part of registry.all()) {
          spatial.structures.unregister(structureIdForPart(part.id));
          views.dispose(part.id);
        }
        registry.clear();
        selectedPartId = undefined;
        hoveredPartId = undefined;
        hideGhost(selection);
        commitTopology();
      };

      const restoreSave = (
        rawParts: unknown,
        rawNextPartId: unknown,
        rawKitGranted: unknown,
      ): SaveRestoreReport => {
        const normalized = normalizePartsSlice(rawParts, rawNextPartId);
        const kit = normalizeKitGranted(rawKitGranted);
        const issues: string[] = [...normalized.issues, ...kit.issues];
        clearAllParts();
        let restored = 0;
        for (const record of normalized.value.parts) {
          const definition = MECHANICAL_PART_DEFS[record.kind as PartId];
          if (definition === undefined) {
            issues.push('part restore skipped: unknown kind ' + record.kind);
            continue;
          }
          let placement: Placement;
          try {
            placement = createPlacement(
              record.gx,
              record.gz,
              definition.w,
              definition.d,
              normalizeRotation(record.rotation),
              record.level,
            );
          } catch (error) {
            issues.push('part restore skipped: ' + record.kind + ' #' + record.id + ': ' + (error instanceof Error ? error.message : String(error)));
            continue;
          }
          if (registry.get(record.id) !== undefined) {
            issues.push('part restore skipped: duplicate id ' + record.id);
            continue;
          }
          // 走既有三维合法性校验（支撑面/资源格/重叠），但不检查玩家占用与科技门控：
          // 存档世界在保存时已经合法，读档只需要重建同一个世界。
          const verdict = validatePlacement(placement, definition.height, {
            spatial: spatial.index,
            supports: spatial.supports,
            isCellBlocked: (cell) => resourceNodes.isCellBlocked(cell),
          });
          if (!verdict.ok) {
            issues.push('part restore skipped: ' + record.kind + ' #' + record.id + ' reason ' + String(verdict.reason));
            continue;
          }
          const part: MechanicalPart = { id: record.id, def: definition, placement };
          if (!registry.add(part)) {
            issues.push('part restore skipped: registry rejected id ' + record.id);
            continue;
          }
          try {
            spatial.structures.register({
              id: structureIdForPart(part.id),
              aabb: placementAabb(placement, definition.height),
              blocksBuild: true,
              blocksPlayer: true,
            });
            views.add(part.id, createPartView(world, part, viewAssets));
            restored += 1;
          } catch (error) {
            spatial.structures.unregister(structureIdForPart(part.id));
            views.dispose(part.id);
            registry.remove(part.id);
            issues.push('part restore failed: #' + record.id + ': ' + (error instanceof Error ? error.message : String(error)));
          }
        }
        const maxRestoredId = registry.all().reduce((max, part) => Math.max(max, part.id), 0);
        registry.setNextPartId(Math.max(normalized.value.nextPartId, maxRestoredId + 1, 1));
        commitTopology();
        // 起步包标记：读档后不再发放；若存档标记为已发放则补上（禁止重复赠送）。
        if (kit.value) {
          if (!world.hasResource(KIT_GRANTED_KEY)) world.insertResource(KIT_GRANTED_KEY, 1);
        } else if (world.hasResource(KIT_GRANTED_KEY)) {
          world.removeResource(KIT_GRANTED_KEY);
        }
        return { restored, issues };
      };

      const showSelection = (part: MechanicalPart | undefined): void => {
        if (!part) {
          hideGhost(selection);
          return;
        }
        const center = placementCenter(part.placement);
        world.set(selection, Transform, {
          pos: [center[0], levelBaseY(part.placement.level) + part.def.height / 2 - 0.02, center[2]],
          scale: [part.def.w + 0.06, part.def.height + 0.06, part.def.d + 0.06],
          quat: [0, Math.sin((part.placement.rotation * DEG) / 2), 0, Math.cos((part.placement.rotation * DEG) / 2)],
        }).unwrap();
      };

      const setGhost = (definition: MechanicalPartDef | undefined, placement: Placement | undefined, valid: boolean): void => {
        hideGhost(validGhost);
        hideGhost(invalidGhost);
        if (!definition || !placement) return;
        const center = placementCenter(placement);
        const entity = valid ? validGhost : invalidGhost;
        world.set(entity, Transform, {
          pos: [center[0], levelBaseY(placement.level) + definition.height / 2, center[2]],
          scale: [definition.w, definition.height, definition.d],
          quat: [0, Math.sin((placement.rotation * DEG) / 2), 0, Math.cos((placement.rotation * DEG) / 2)],
        }).unwrap();
      };

      const hitPart = (ray: ArrayLike<number> | undefined): number | undefined => {
        if (!ray) return undefined;
        let bestId: number | undefined;
        let bestDistance = Infinity;
        for (const part of registry.all()) {
          const aabb = placementAabb(part.placement, part.def.height);
          const distance = rayAabbDistance(ray, aabb.min, aabb.max);
          if (distance !== undefined && distance < bestDistance) {
            bestDistance = distance;
            bestId = part.id;
          }
        }
        return bestId;
      };

      yield ctx.provide('mechanical', service);

      world.addSystem(Update, {
        name: SYSTEM_NAME,
        after: [BUILD_SYSTEM_NAME],
        queries: [],
        fn: () => {
          // P2-E1：legacy 兼容模式由测试脚手架设置；首次生效时把正式起步包换成历史原型套件。
          if (tech.mode() === 'legacy') switchToLegacyKit();
          const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          // 楼层建造模式（M1.8-A）与结构模块放置模式（P2-D）：其它输入系统让出输入。
          if (world.hasResource(FLOOR_MODE_KEY) || world.hasResource(STRUCTURE_MODE_KEY)) {
            setGhost(undefined, undefined, false);
            hideGhost(selection);
            selectedPartId = undefined;
            hoveredPartId = undefined;
            return;
          }
          const definition = selectedItem();
          const inMode = definition !== undefined;
          if (!inMode) {
            setGhost(undefined, undefined, false);
            hideGhost(selection);
            selectedPartId = undefined;
            hoveredPartId = undefined;
            return;
          }
          if (input.keyboard.justPressedCode('KeyR')) rotation = normalizeRotation(rotation + 90);
          if (input.keyboard.justPressedCode('Escape')) {
            selectedPartId = undefined;
            hoveredPartId = undefined;
            setGhost(undefined, undefined, false);
            hideGhost(selection);
            return;
          }
          if (input.keyboard.justPressedCode('Delete') || input.keyboard.justPressedCode('Backspace')) {
            if (selectedPartId !== undefined) remove(selectedPartId);
            return;
          }
          showSelection(selectedPartId === undefined ? undefined : registry.get(selectedPartId));

          const level = currentLevel();
          const ray = rayFromMouse(input);
          const cameraTarget = ray && level !== undefined ? pickSupportTarget(ray, level, spatial.supports) : undefined;
          const placement = level !== undefined && cameraTarget ? placementFor(cameraTarget, level) : undefined;
          const hoverPart = hitPart(ray);
          hoveredPartId = hoverPart;
          if (hoverPart !== undefined) {
            // 悬停在已有零件上：进入选择模式，不显示放置幽灵。
            setGhost(undefined, undefined, false);
            publishTarget({ active: false });
            if (input.mouse.justPressed(0)) selectedPartId = hoverPart;
            showSelection(registry.get(selectedPartId ?? hoverPart));
            return;
          }
          if (placement) {
            const valid = validPlacement(definition, placement);
            setGhost(definition, placement, valid);
            publishTarget({
              active: true,
              cell: { gx: placement.gx, gz: placement.gz },
              level,
              baseY: levelBaseY(level),
              valid,
            });
            showSelection(selectedPartId === undefined ? undefined : registry.get(selectedPartId));
            if (input.mouse.justPressed(0) && valid) {
              place(definition, placement);
            }
          } else {
            setGhost(undefined, undefined, false);
            publishTarget({ active: false });
            showSelection(selectedPartId === undefined ? undefined : registry.get(selectedPartId));
          }
        },
      }).unwrap();

      yield () => {
        world.removeSystem(Update, SYSTEM_NAME).unwrap();
        hideGhost(validGhost);
        hideGhost(invalidGhost);
        hideGhost(selection);
        world.despawn(validGhost);
        world.despawn(invalidGhost);
        world.despawn(selection);
        views.disposeAll();
        for (const part of registry.all()) spatial.structures.unregister(structureIdForPart(part.id));
        registry.clear();
        releaseMechanicalViewAssets(assets, viewAssets);
      };
    }, SYSTEM_NAME);
  },
};

function spawnGhost(world: any, mesh: any, material: any): EntityHandle {
  return world
    .spawn(
      { component: Transform, data: { pos: [0, HIDDEN_Y, 0], scale: [1, 1, 1] } },
      { component: MeshFilter, data: { assetHandle: mesh } },
      { component: MeshRenderer, data: { materials: [material] } },
    )
    .unwrap();
}

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.mechanical,
  name: 'ISLAND INDUSTRIA / Mechanical',
  plugins: true,
  build: () =>
    ok({
      'plugin/mechanical': {
        kind: 'plugin',
        module: { specifier: './mechanical.pack.ts', export: 'mechanicalSystem' },
      },
      'plugin/mechanical-runtime': {
        kind: 'plugin',
        module: { specifier: './runtime.ts', export: 'mechanicalRuntime' },
      },
    }),
});