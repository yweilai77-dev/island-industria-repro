import { Update, type EntityHandle } from '@forgeax/engine/ecs';
import { createBoxGeometry } from '@forgeax/engine/geometry';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { viewportToWorld } from '@forgeax/engine/picking';
import type { Plugin } from '@forgeax/engine/plugin';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { Transform } from '@forgeax/engine/scene';
import type { AssetHandle } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/assets-runtime';
import type {} from '@forgeax/engine/app';
import { createPlacement, placementCenter, type Placement } from '../grid/grid.ts';
import { ITEM_IDS } from '../items/items.ts';
import { levelBaseY } from '../spatial/space.ts';
import { pickSupportTarget } from '../spatial/picking.ts';
import { resolveSceneEntity } from '../shared/scene-refs.ts';
import { BUILD_SYSTEM_NAME } from '../build/target.ts';
import { FLOOR_MODE_KEY } from '../build/floors.ts';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import {
  STRUCTURE_MODE_KEY,
  STRUCTURE_TARGET_STATE_KEY,
  type StructureModeState,
  type StructureTargetState,
} from '../shared/placement-mode.ts';
import type {} from '../player/player.ts';
import type {} from '../inventory/inventory.ts';
import type {} from '../spatial/service.ts';
import type {} from '../mechanical/mechanical.pack.ts';
import { structureModuleForItem } from './assembly-module.ts';
import { AssemblyRuntime, structurePlacementIssue } from './assembly-runtime.ts';
import type { AssemblySnapshot } from './assembly-runtime.ts';
import type {} from './assembly-service.ts';
import type { AssemblyService } from './assembly-service.ts';
import type { AssemblyId } from './ids.ts';

/**
 * M2.0-P2-D 组合机械插件：结构框架的放置、组合关系的运行时推导与整体可视化。
 *
 * 职责：
 * 1. 持有 `AssemblyRuntime`：每帧从真实 `MechanicalPart` 推导组合关系并保留稳定 ID；
 * 2. 提供只读 `assembly` 服务给唯一 GameRead（成员、结构关系、相对位置、整体边界、动力需求之和）；
 * 3. 结构框架的放置：`P` 切换结构放置模式（build/mechanical/ports 让出输入），
 *    悬停格子显示绿/红幽灵，左键放置；放置前必须与同层核心或结构框架正交相邻；
 * 4. 整体可视化：选中任一成员/结构模块时画出组合边界，并用不同颜色的标记区分成员核心与结构模块；
 * 5. 结构框架走现有机械零件事务（registry / SpatialIndex / 视图 / 库存），拆除自动解绑组合关系。
 *
 * 本插件**不**实现：整体移动、整体旋转、嵌套组合、科技树、新的加工/物流/动力系统。
 */

const SYSTEM_NAME = 'island-industria/assembly';
const KIT_GRANTED_KEY = 'IslandIndustriaStructureKitGranted';
/** 开局原型结构框架数量（P2-E 统一决定最终获取方式前的最小测试/体验供给）。 */
const STRUCTURE_KIT_COUNT = 4;
const HIDDEN_Y = -1000;

function overlayMaterial(color: readonly [number, number, number, number]) {
  return Materials.unlit([...color], {
    renderState: {
      depthWriteEnabled: false,
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
    },
  });
}

interface Visuals {
  readonly ghostValid: EntityHandle;
  readonly ghostInvalid: EntityHandle;
  readonly boundaryBeams: readonly EntityHandle[];
  readonly memberMesh: EntityHandle;
  readonly moduleMesh: EntityHandle;
}

export const industrialAssembly: Plugin = {
  name: SYSTEM_NAME,
  inject: [
    'world', 'assets', 'mechanical', 'inventory', 'player', 'spatial',
    'resourceNodes', 'gameScene', 'executionBootstrapHost',
  ],
  apply(ctx) {
    const world = ctx.world;
    const assets = ctx.assets;
    if (!assets) throw new Error('assembly system requires asset service');
    const mechanical = ctx.mechanical;
    const inventory = ctx.inventory;
    const player = ctx.player;
    const spatial = ctx.spatial;
    const bootstrapHost = ctx.executionBootstrapHost;
    const camera = resolveSceneEntity(world, ctx.gameScene, 'camera');

    ctx.effect(function* () {
      const runtime = new AssemblyRuntime();
      // 原型供给（真实物品；P2-E 会统一决定最终获取/解锁方式，这里明确标记为临时原型数量）。
      if (!world.hasResource(KIT_GRANTED_KEY)) {
        inventory.add(ITEM_IDS.STRUCTURE_FRAME, STRUCTURE_KIT_COUNT);
        world.insertResource(KIT_GRANTED_KEY, 1);
      }

      const ghostBox = assets.create(createBoxGeometry(1, 1, 1).unwrap()).unwrap();
      const boundaryBox = assets.create(createBoxGeometry(1, 1, 1).unwrap()).unwrap();
      const memberPillar = assets.create(createBoxGeometry(0.1, 1.3, 0.1).unwrap()).unwrap();
      const modulePillar = assets.create(createBoxGeometry(0.1, 0.8, 0.1).unwrap()).unwrap();
      const boundaryMaterial = assets.create(Materials.unlit([0.35, 0.85, 1, 1])).unwrap();
      const memberMaterial = assets.create(Materials.unlit([1, 0.72, 0.2, 1])).unwrap();
      const moduleMaterial = assets.create(Materials.unlit([0.35, 0.9, 0.9, 1])).unwrap();
      const ghostValidMaterial = assets.create(overlayMaterial([0.3, 0.9, 0.45, 0.35])).unwrap();
      const ghostInvalidMaterial = assets.create(overlayMaterial([0.95, 0.25, 0.2, 0.35])).unwrap();

      const spawn = (mesh: AssetHandle<'mesh'>, material: AssetHandle<'material'>): EntityHandle => world
        .spawn(
          { component: Transform, data: { pos: [0, HIDDEN_Y, 0], scale: [1, 1, 1] } },
          { component: MeshFilter, data: { assetHandle: mesh } },
          { component: MeshRenderer, data: { materials: [material] } },
        )
        .unwrap();
      const boundaryBeams: EntityHandle[] = [];
      for (let index = 0; index < 12; index += 1) boundaryBeams.push(spawn(boundaryBox, boundaryMaterial));
      const visuals: Visuals = {
        ghostValid: spawn(ghostBox, ghostValidMaterial),
        ghostInvalid: spawn(ghostBox, ghostInvalidMaterial),
        boundaryBeams,
        memberMesh: spawn(memberPillar, memberMaterial),
        moduleMesh: spawn(modulePillar, moduleMaterial),
      };
      const hide = (entity: EntityHandle): void => {
        world.set(entity, Transform, { pos: [0, HIDDEN_Y, 0] }).unwrap();
      };
      hide(visuals.ghostValid);
      hide(visuals.ghostInvalid);
      for (const beam of visuals.boundaryBeams) hide(beam);

      const markerPool = new Map<number, EntityHandle>();
      const hideMarkers = (keep: ReadonlySet<number>): void => {
        for (const [partId, entity] of [...markerPool]) {
          if (keep.has(partId)) continue;
          markerPool.delete(partId);
          world.despawn(entity).unwrap();
        }
      };

      let modeActive = false;
      let latest: readonly AssemblySnapshot[] = [];
      let target: StructureTargetState = { active: false, cell: null, level: null, valid: false, reason: null };

      const frameModule = structureModuleForItem(ITEM_IDS.STRUCTURE_FRAME);
      if (!frameModule) throw new Error('structure frame module is not defined');

      const setMode = (active: boolean): void => {
        modeActive = active;
        if (active) {
          world.insertResource(STRUCTURE_MODE_KEY, { active: true } satisfies StructureModeState);
        } else {
          if (world.hasResource(STRUCTURE_MODE_KEY)) world.removeResource(STRUCTURE_MODE_KEY);
          if (world.hasResource(STRUCTURE_TARGET_STATE_KEY)) world.removeResource(STRUCTURE_TARGET_STATE_KEY);
          target = { active: false, cell: null, level: null, valid: false, reason: null };
          hide(visuals.ghostValid);
          hide(visuals.ghostInvalid);
        }
      };

      const service: AssemblyService = {
        snapshot: () => latest,
        assemblyOf: (partId) => runtime.assemblyOf(partId),
        selectedAssemblyId: (): AssemblyId | undefined => {
          const selected = mechanical.selectedPartId();
          if (selected === undefined) return undefined;
          return runtime.assemblyOf(selected)?.id;
        },
        modeActive: () => modeActive,
      };
      yield ctx.provide('assembly', service);

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
        if (position.x < 0 || position.x >= size.width || position.y < 0 || position.y >= size.height) return undefined;
        return viewportToWorld(world, camera, position.x, position.y, size.width, size.height);
      };

      /** 选中组合机械时：整体边界 + 成员/结构模块标记（不同颜色区分）。 */
      const updateAssemblyVisuals = (partsSelectedAssembly: AssemblySnapshot | undefined): void => {
        if (!partsSelectedAssembly) {
          for (const beam of visuals.boundaryBeams) hide(beam);
          hideMarkers(new Set());
          return;
        }
        // 只画 12 条棱：整体边界必须可辨认，但不能像半透明罩子一样盖住成员核心与结构模块。
        const { min, max } = partsSelectedAssembly.bounds;
        const midX = (min[0] + max[0]) / 2;
        const midY = (min[1] + max[1]) / 2;
        const midZ = (min[2] + max[2]) / 2;
        const sizeX = Math.max(max[0] - min[0], 0.1);
        const sizeY = Math.max(max[1] - min[1], 0.1);
        const sizeZ = Math.max(max[2] - min[2], 0.1);
        const thickness = 0.06;
        const edges: { pos: [number, number, number]; scale: [number, number, number] }[] = [];
        for (const x of [min[0], max[0]]) {
          for (const z of [min[2], max[2]]) {
            edges.push({ pos: [x, midY, z], scale: [thickness, sizeY, thickness] });
          }
        }
        for (const y of [min[1], max[1]]) {
          for (const z of [min[2], max[2]]) {
            edges.push({ pos: [midX, y, z], scale: [sizeX, thickness, thickness] });
          }
          for (const x of [min[0], max[0]]) {
            edges.push({ pos: [x, y, midZ], scale: [thickness, thickness, sizeZ] });
          }
        }
        edges.forEach((edge, index) => {
          world.set(visuals.boundaryBeams[index] as EntityHandle, Transform, { pos: edge.pos, scale: edge.scale }).unwrap();
        });
        const keep = new Set<number>();
        const placeMarker = (partId: number, x: number, z: number, y: number, member: boolean): void => {
          keep.add(partId);
          let entity = markerPool.get(partId);
          if (!entity) {
            entity = spawn(member ? memberPillar : modulePillar, member ? memberMaterial : moduleMaterial);
            markerPool.set(partId, entity);
          }
          world.set(entity, Transform, { pos: [x, y, z], scale: [1, 1, 1] }).unwrap();
        };
        for (const member of partsSelectedAssembly.members) {
          const center = placementCenter(member.placement);
          placeMarker(member.partId, center[0], center[2], levelBaseY(member.placement.level) + 0.65, true);
        }
        for (const module of partsSelectedAssembly.modules) {
          const center = placementCenter(module.placement);
          placeMarker(module.partId, center[0], center[2], levelBaseY(module.placement.level) + 0.4, false);
        }
        hideMarkers(keep);
      };

      const placeFrameAt = (placement: Placement): boolean => {
        const placed = mechanical.placePart(frameModule.partId, placement);
        if (!placed) return false;
        runtime.reconcile(mechanical.parts());
        return true;
      };

      world.addSystem(Update, {
        name: SYSTEM_NAME,
        after: [BUILD_SYSTEM_NAME],
        queries: [],
        fn: () => {
          const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          const floorMode = world.hasResource(FLOOR_MODE_KEY);
          if (floorMode && modeActive) setMode(false);

          if (!floorMode && input.keyboard.justPressedCode('KeyP')) {
            if (modeActive) {
              setMode(false);
            } else if (inventory.has(ITEM_IDS.STRUCTURE_FRAME, 1)) {
              setMode(true);
            }
          }
          if (modeActive && input.keyboard.justPressedCode('Escape')) setMode(false);
          if (modeActive && !inventory.has(ITEM_IDS.STRUCTURE_FRAME, 1)) setMode(false);

          const parts = mechanical.parts();
          runtime.reconcile(parts);
          latest = runtime.snapshot();
          const selected = mechanical.selectedPartId();
          updateAssemblyVisuals(selected === undefined ? undefined : runtime.assemblyOf(selected));

          if (!modeActive) return;
          const level = currentLevel();
          const ray = rayFromMouse(input);
          const support = level !== undefined && ray ? pickSupportTarget(ray, level, spatial.supports) : undefined;
          if (!support) {
            target = { active: false, cell: null, level: null, valid: false, reason: null };
            world.insertResource(STRUCTURE_TARGET_STATE_KEY, target);
            hide(visuals.ghostValid);
            hide(visuals.ghostInvalid);
            return;
          }
          const placement = createPlacement(support.cell.gx, support.cell.gz, frameModule.footprint.w,
            frameModule.footprint.d, 0, level as number);
          const hasItem = inventory.has(ITEM_IDS.STRUCTURE_FRAME, 1);
          const basic = hasItem && mechanical.canPlacePart(frameModule.partId, placement);
          const adjacent = structurePlacementIssue(placement, frameModule, parts) === null;
          const valid = basic && adjacent;
          const reason = !hasItem ? 'no-item' : !basic ? 'occupied' : !adjacent ? 'not-adjacent' : null;
          target = {
            active: true,
            cell: { gx: support.cell.gx, gz: support.cell.gz },
            level: level as number,
            valid,
            reason,
          };
          world.insertResource(STRUCTURE_TARGET_STATE_KEY, target);
          const center = placementCenter(placement);
          const ghost = valid ? visuals.ghostValid : visuals.ghostInvalid;
          world.set(ghost, Transform, {
            pos: [center[0], levelBaseY(level as number) + 0.5, center[2]],
            scale: [frameModule.footprint.w, frameModule.height, frameModule.footprint.d],
          }).unwrap();
          hide(valid ? visuals.ghostInvalid : visuals.ghostValid);
          if (input.mouse.justPressed(0) && valid) placeFrameAt(placement);
        },
      }).unwrap();

      yield () => {
        world.removeSystem(Update, SYSTEM_NAME).unwrap();
        if (world.hasResource(STRUCTURE_MODE_KEY)) world.removeResource(STRUCTURE_MODE_KEY);
        if (world.hasResource(STRUCTURE_TARGET_STATE_KEY)) world.removeResource(STRUCTURE_TARGET_STATE_KEY);
        for (const entity of markerPool.values()) world.despawn(entity).unwrap();
        markerPool.clear();
        for (const entity of [
          visuals.ghostValid, visuals.ghostInvalid, ...visuals.boundaryBeams, visuals.memberMesh, visuals.moduleMesh,
        ]) world.despawn(entity).unwrap();
        for (const handle of [
          ghostBox, boundaryBox, memberPillar, modulePillar,
          boundaryMaterial, memberMaterial, moduleMaterial, ghostValidMaterial, ghostInvalidMaterial,
        ]) assets!.release(handle).unwrap();
        runtime.clear();
        latest = [];
      };
    }, SYSTEM_NAME);
  },
};

