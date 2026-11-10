// 载入 ExecutionBootstrapHost 的 Context 服务声明（只引入类型，不产生运行时依赖）。
import type {} from '@forgeax/engine/app';
import { Update, type EntityHandle } from '@forgeax/engine/ecs';
import { createBoxGeometry } from '@forgeax/engine/geometry';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { quat } from '@forgeax/engine/math';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { viewportToWorld } from '@forgeax/engine/picking';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { ChildOf, PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import { RenderQueue } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { resolveSceneEntity } from '../shared/scene-refs.ts';
import { isMechanicalSelection } from './input-mode.ts';
import type {} from '../player/player.ts';
import {
  createPlacement,
  normalizeRotation,
  placementCenter,
  rotatePlacement,
  worldExtent,
  type Cell,
  type Placement,
  type Rotation,
} from '../grid/grid.ts';
import type {} from '../spatial/service.ts';
import { placementBaseY } from '../spatial/space.ts';
import { pickSupportTarget } from '../spatial/picking.ts';
import {
  BUILDING_HEIGHT,
  BUILDING_TYPES,
  buildingAabb,
  rayAabbDistance,
  validatePlacement,
  type BuildingType,
} from './build.ts';
import {
  BUILD_SYSTEM_NAME,
  BUILD_TARGET_STATE_KEY,
  type BuildTargetState,
} from './target.ts';
import {
  BUILD_ADJUSTING_KEY,
  beginAdjustment,
  copyPlacement,
  currentPlacement,
  moveAdjustmentTo,
  originalPlacement,
  rotateAdjustment,
  setAdjustmentValidity,
  type BuildingAdjustment,
} from './adjustment.ts';
import { FLOOR_MODE_KEY } from './floors.ts';
import { STRUCTURE_MODE_KEY } from '../shared/placement-mode.ts';
import { normalizeBuildingsSlice, type SaveBuildingsData } from '../save/save-schema.ts';
import type { SaveRestoreReport } from '../save/save-ports.ts';

const SYSTEM_NAME = BUILD_SYSTEM_NAME;
const HIDDEN_Y = -1000;
const DEG = Math.PI / 180;

const GHOST_VALID_COLOR = [0.3, 0.9, 0.45, 0.35] as const;
const GHOST_INVALID_COLOR = [0.95, 0.25, 0.2, 0.35] as const;
const SELECTION_COLOR = [0.3, 0.85, 1, 0.35] as const;
const FRONT_STRIPE_COLOR = [1, 0.86, 0.1, 1] as const;

const BUILDING_COLORS = BUILDING_TYPES.map((type) => type.color);

/** 半透明覆盖物材质：关闭深度写入、标准 alpha 混合、透明队列。 */
function overlayMaterial(color: readonly [number, number, number, number]) {
  return Materials.unlit([...color], {
    renderState: {
      depthWriteEnabled: false,
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
    },
    queue: RenderQueue.Transparent,
  });
}

interface BuildingRecord {
  readonly entity: EntityHandle;
  readonly typeIndex: number;
  readonly height: number;
  /** 权威放置数据：搬动确认后更新。 */
  placement: Placement;
}

/**
 * 建造系统对存档暴露的窄接口：只收发纯 JSON，内部负责重建视图与空间索引。
 * 读档顺序：floors → player → buildings → mechanical（建筑可落在已恢复的楼板上）。
 */
export interface BuildingsService {
  revision(): number;
  snapshotSave(): SaveBuildingsData;
  restoreSave(rawBuildings: unknown, rawNextBuildingId: unknown): SaveRestoreReport;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    buildings: BuildingsService;
  }
}

/**
 * 建造 + 搬动系统：
 * - 普通模式：放置 / 选中 / R 旋转预览 / X 拆除；
 * - 选中建筑按 G：搬动调整模式（R 旋转、左键确认、Esc 取消）；
 * - 搬动期间锁定玩家移动与采矿，相机仍可操作。
 */
export const buildSystem: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world', 'assets', 'gameScene', 'player', 'resourceNodes', 'hotbar', 'spatial', 'executionBootstrapHost'],
  apply(ctx) {
    const world = ctx.world;
    const assets = ctx.assets;
    if (!assets) throw new Error('build system requires the asset service');
    const camera = resolveSceneEntity(world, ctx.gameScene, 'camera');
    const player = ctx.player;
    const resourceNodes = ctx.resourceNodes;
    const hotbar = ctx.hotbar;
    const bootstrapHost = ctx.executionBootstrapHost;

    ctx.effect(function* () {
      // ---- 一次性创建几何体与材质 ----
      const typeMeshes = BUILDING_TYPES.map((type) =>
        assets.create(createBoxGeometry(type.w, type.height, type.d).unwrap()).unwrap(),
      );
      const typeMaterials = BUILDING_COLORS.map((color) =>
        assets.create(
          Materials.standard({ baseColor: [...color], metallic: 0.05, roughness: 0.55 }),
        ).unwrap(),
      );
      const ghostValidMaterial = assets.create(overlayMaterial(GHOST_VALID_COLOR)).unwrap();
      const ghostInvalidMaterial = assets.create(overlayMaterial(GHOST_INVALID_COLOR)).unwrap();
      const selectionMaterial = assets.create(overlayMaterial(SELECTION_COLOR)).unwrap();
      const stripeMesh = assets.create(createBoxGeometry(0.5, 0.16, 0.12).unwrap()).unwrap();
      const stripeMaterial = assets.create(Materials.unlit([...FRONT_STRIPE_COLOR])).unwrap();
      const selectionMesh = assets.create(createBoxGeometry(1, BUILDING_HEIGHT * 1.2, 1).unwrap()).unwrap();
      yield () => {
        for (const handle of [
          ...typeMeshes,
          ...typeMaterials,
          ghostValidMaterial,
          ghostInvalidMaterial,
          selectionMaterial,
          stripeMesh,
          stripeMaterial,
          selectionMesh,
        ]) {
          assets.release(handle).unwrap();
        }
      };

      // ---- 幽灵预览：每种建筑 × 合法/非法，共 6 个复用实体 ----
      const ghosts: { entity: EntityHandle; typeIndex: number; valid: boolean }[] = [];
      for (const [typeIndex, mesh] of typeMeshes.entries()) {
        for (const valid of [true, false]) {
          const entity = world
            .spawn(
              { component: Transform, data: { pos: [0, HIDDEN_Y, 0] } },
              { component: MeshFilter, data: { assetHandle: mesh } },
              {
                component: MeshRenderer,
                data: { materials: [valid ? ghostValidMaterial : ghostInvalidMaterial] },
              },
            )
            .unwrap();
          ghosts.push({ entity, typeIndex, valid });
        }
      }
      const selectionEntity = world
        .spawn(
          { component: Transform, data: { pos: [0, HIDDEN_Y, 0] } },
          { component: MeshFilter, data: { assetHandle: selectionMesh } },
          { component: MeshRenderer, data: { materials: [selectionMaterial] } },
        )
        .unwrap();

      // ---- 预览朝向标记：一个复用实体，建造与搬动预览共用 ----
      const directionMarker = world
        .spawn(
          { component: Transform, data: { pos: [0, HIDDEN_Y, 0] } },
          { component: MeshFilter, data: { assetHandle: stripeMesh } },
          { component: MeshRenderer, data: { materials: [stripeMaterial] } },
        )
        .unwrap();

      yield () => {
        for (const ghost of ghosts) world.despawn(ghost.entity).unwrap();
        world.despawn(selectionEntity).unwrap();
        world.despawn(directionMarker).unwrap();
      };

      // ---- 建造/搬动状态（空间注册表由独立 spatial 服务持有） ----
      const spatial = ctx.spatial.index;
      const supports = ctx.spatial.supports;
      const buildings = new Map<number, BuildingRecord>();
      const validate = (
        placement: Placement,
        height: number,
        excludeBuildingId?: number,
      ) => validatePlacement(placement, height, {
        spatial,
        supports,
        playerCell: player.cell,
        playerFeetY: player.state.position[1],
        isCellBlocked: (cell) => resourceNodes.isCellBlocked(cell),
        excludeBuildingId,
      });
      const currentBuildLevel = (): number | undefined => {
        const supportId = player.state.supportId;
        if (supportId === null) return undefined;
        const support = supports.get(supportId);
        if (!support || !support.active || !support.buildable) return undefined;
        return support.level;
      };

      const publishTarget = (target: BuildTargetState): void => {
        world.insertResource(BUILD_TARGET_STATE_KEY, target);
      };

      let nextBuildingId = 1;
      let activeTypeIndex = 0;
      let rotation: Rotation = 0;
      let selectedId: number | undefined;
      let adjustment: BuildingAdjustment | undefined;

      const setHidden = (entity: EntityHandle): void => {
        world.set(entity, Transform, { pos: [0, HIDDEN_Y, 0] }).unwrap();
      };

      const placementTransform = (
        placement: Placement,
        height: number = BUILDING_HEIGHT,
      ): { pos: [number, number, number]; quat: [number, number, number, number] } => {
        const center = placementCenter(placement);
        const yaw = quat.fromAxisAngle(quat.create(), [0, 1, 0], placement.rotation * DEG);
        return {
          pos: [center[0], placementBaseY(placement) + height / 2, center[2]],
          quat: [yaw[0] ?? 0, yaw[1] ?? 0, yaw[2] ?? 0, yaw[3] ?? 1],
        };
      };

      const applyBuildingTransform = (
        entity: EntityHandle,
        placement: Placement,
        height: number = BUILDING_HEIGHT,
      ): void => {
        const transform = placementTransform(placement, height);
        world.set(entity, Transform, transform).unwrap();
      };

      const hideBuilding = (entity: EntityHandle): void => setHidden(entity);

      const positionSelectionAt = (
        placement: Placement,
        height: number = BUILDING_HEIGHT,
      ): void => {
        const center = placementCenter(placement);
        const extent = worldExtent(placement);
        world
          .set(selectionEntity, Transform, {
            pos: [center[0], placementBaseY(placement) + height * 0.6, center[2]],
            scale: [extent.w + 0.04, 1, extent.d + 0.04],
          })
          .unwrap();
      };

      const hideSelection = (): void => {
        selectedId = undefined;
        setHidden(selectionEntity);
      };

      const updateSelection = (): void => {
        if (selectedId === undefined) return;
        const record = buildings.get(selectedId);
        if (record === undefined) {
          hideSelection();
          return;
        }
        positionSelectionAt(record.placement, record.height);
      };

      const placeDirectionMarker = (
        placement: Placement,
        height: number = BUILDING_HEIGHT,
      ): void => {
        const center = placementCenter(placement);
        const theta = placement.rotation * DEG;
        const localZ = -(placement.d / 2) - 0.06;
        const offsetX = Math.sin(theta) * localZ;
        const offsetZ = Math.cos(theta) * localZ;
        const yaw = quat.fromAxisAngle(quat.create(), [0, 1, 0], theta);
        world
          .set(directionMarker, Transform, {
            pos: [
              center[0] + offsetX,
              placementBaseY(placement) + height / 2 + 0.15,
              center[2] + offsetZ,
            ],
            quat: [yaw[0] ?? 0, yaw[1] ?? 0, yaw[2] ?? 0, yaw[3] ?? 1],
          })
          .unwrap();
      };

      const hideDirectionMarker = (): void => setHidden(directionMarker);

      const setAdjustingLock = (active: boolean): void => {
        if (active) {
          world.insertResource(BUILD_ADJUSTING_KEY, true);
        } else if (world.hasResource(BUILD_ADJUSTING_KEY)) {
          world.removeResource(BUILD_ADJUSTING_KEY);
        }
      };

      const demolish = (id: number): void => {
        if (adjustment?.buildingId === id) return;
        const record = buildings.get(id);
        if (record === undefined) return;
        spatial.unregisterBuilding(id);
        buildings.delete(id);
        world.despawn(record.entity).unwrap();
        if (selectedId === id) hideSelection();
      };

      /** 用指定 id 生成视图并注册（用户放置与读档共用同一原语）。 */
      const placeWithId = (placement: Placement, typeIndex: number, id: number): void => {
        const type = BUILDING_TYPES[typeIndex] as (typeof BUILDING_TYPES)[number];
        const meshHandle = typeMeshes[typeIndex]!;
        const materialHandle = typeMaterials[typeIndex]!;
        const transform = placementTransform(placement, type.height);
        const entity = world
          .spawn(
            { component: Transform, data: transform },
            { component: MeshFilter, data: { assetHandle: meshHandle } },
            { component: MeshRenderer, data: { materials: [materialHandle] } },
          )
          .unwrap();
        try {
          world
            .spawn(
              { component: Transform, data: { pos: [0, 0.15, -(type.d / 2) - 0.06] } },
              { component: ChildOf, data: { parent: entity } },
              { component: MeshFilter, data: { assetHandle: stripeMesh } },
              { component: MeshRenderer, data: { materials: [stripeMaterial] } },
            )
            .unwrap();
          spatial.registerBuilding(id, placement, type.height);
          buildings.set(id, { entity, typeIndex, height: type.height, placement });
        } catch (error) {
          world.despawn(entity).unwrap();
          throw error;
        }
      };

      const place = (placement: Placement, typeIndex: number): void => {
        const id = nextBuildingId;
        nextBuildingId += 1;
        placeWithId(placement, typeIndex, id);
      };

      // ---- 存档：建筑 + nextBuildingId（restore 内部重建视图/空间索引） ----
      let buildingsRevision = 0;
      const buildingsService: BuildingsService = {
        revision: () => buildingsRevision,
        snapshotSave: () => ({
          nextBuildingId,
          buildings: [...buildings.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([id, record]) => ({
              id,
              kind: (BUILDING_TYPES[record.typeIndex] as (typeof BUILDING_TYPES)[number]).id,
              gx: record.placement.gx,
              gz: record.placement.gz,
              rotation: record.placement.rotation,
              level: record.placement.level,
            })),
        }),
        restoreSave: (rawBuildings: unknown, rawNextBuildingId: unknown): SaveRestoreReport => {
          const normalized = normalizeBuildingsSlice(rawBuildings, rawNextBuildingId);
          const issues = [...normalized.issues];
          if (adjustment !== undefined) finishAdjustment('abort');
          for (const [id, record] of [...buildings]) {
            spatial.unregisterBuilding(id);
            world.despawn(record.entity).unwrap();
          }
          buildings.clear();
          hideSelection();
          nextBuildingId = 1;
          let restored = 0;
          for (const record of normalized.value.buildings) {
            const typeIndex = BUILDING_TYPES.findIndex((type) => type.id === record.kind);
            const type = BUILDING_TYPES[typeIndex];
            if (type === undefined) {
              issues.push('building restore skipped: unknown kind ' + record.kind);
              continue;
            }
            let placement: Placement;
            try {
              placement = createPlacement(
                record.gx,
                record.gz,
                type.w,
                type.d,
                normalizeRotation(record.rotation),
                record.level,
              );
            } catch (error) {
              issues.push('building restore skipped: ' + record.kind + ': ' + (error instanceof Error ? error.message : String(error)));
              continue;
            }
            // 读档校验不含玩家占用（玩家位置在建筑之前恢复，存档世界本身是合法的）；
            // 支撑面/资源格/重叠仍然走既有 validatePlacement，失败逐条跳过。
            const verdict = validatePlacement(placement, type.height, {
              spatial,
              supports,
              isCellBlocked: (cell) => resourceNodes.isCellBlocked(cell),
              excludeBuildingId: record.id,
            });
            if (!verdict.ok) {
              issues.push('building restore skipped: ' + record.kind + ' #' + record.id + ' reason ' + String(verdict.reason));
              continue;
            }
            if (buildings.has(record.id)) {
              issues.push('building restore skipped: duplicate id ' + record.id);
              continue;
            }
            try {
              placeWithId(placement, typeIndex, record.id);
              restored += 1;
            } catch (error) {
              issues.push('building restore failed: #' + record.id + ': ' + (error instanceof Error ? error.message : String(error)));
            }
          }
          const maxRestoredId = [...buildings.keys()].reduce((max, id) => Math.max(max, id), 0);
          nextBuildingId = Math.max(normalized.value.nextBuildingId, maxRestoredId + 1, 1);
          buildingsRevision += 1;
          return { restored, issues };
        },
      };
      yield ctx.provide('buildings', buildingsService);

      const findBuildingHit = (ray: ArrayLike<number>): number | undefined => {
        let bestId: number | undefined;
        let bestDistance = Infinity;
        for (const [id, record] of buildings) {
          if (adjustment?.buildingId === id) continue;
          const aabb = buildingAabb(record.placement, record.height);
          const distance = rayAabbDistance(ray, aabb.min, aabb.max);
          if (distance !== undefined
            && (distance < bestDistance - 1e-9
              || (Math.abs(distance - bestDistance) <= 1e-9 && (bestId === undefined || id < bestId)))) {
            bestDistance = distance;
            bestId = id;
          }
        }
        return bestId;
      };

      // ---- 幽灵 / 朝向标记控制 ----
      let ghostPoseKey = '';
      let shownGhost: EntityHandle | undefined;
      const hideAllGhosts = (): void => {
        for (const ghost of ghosts) setHidden(ghost.entity);
        shownGhost = undefined;
        ghostPoseKey = '';
      };
      const showGhostAt = (
        typeIndex: number,
        valid: boolean,
        placement: Placement,
        height: number = BUILDING_HEIGHT,
      ): void => {
        hideAllGhosts();
        const ghost = ghosts.find((candidate) => candidate.typeIndex === typeIndex && candidate.valid === valid);
        if (ghost === undefined) return;
        world.set(ghost.entity, Transform, placementTransform(placement, height)).unwrap();
        shownGhost = ghost.entity;
      };

      // ---- 搬动调整：统一清理/确认/取消 ----
      const clearAdjustmentVisuals = (): void => {
        hideAllGhosts();
        hideDirectionMarker();
      };

      const releaseLockAndState = (): void => {
        setAdjustingLock(false);
        adjustment = undefined;
        clearAdjustmentVisuals();
      };

      const enterAdjustment = (id: number): boolean => {
        if (adjustment !== undefined) return false;
        const record = buildings.get(id);
        if (record === undefined) return false;
        const original = copyPlacement(record.placement);
        // 释放自己的原占地，才能用真实占用情况重新校验原位置。
        spatial.unregisterBuilding(id);
        hideBuilding(record.entity);
        hideAllGhosts();
        hideDirectionMarker();
        selectedId = id;
        positionSelectionAt(original, record.height); // 原位置淡色轮廓（复用选中高亮实体）
        adjustment = beginAdjustment(id, record.typeIndex, original);
        const verdict = validate(adjustment.placement, record.height, id);
        adjustment = setAdjustmentValidity(adjustment, true, verdict.ok);
        showGhostAt(record.typeIndex, verdict.ok, adjustment.placement, record.height);
        placeDirectionMarker(adjustment.placement, record.height);
        setAdjustingLock(true);
        return true;
      };

      const finishAdjustment = (
        mode: 'confirm' | 'cancel' | 'abort',
      ): boolean => {
        const adj = adjustment;
        if (adj === undefined) return false;
        const record = buildings.get(adj.buildingId);

        if (mode === 'abort') {
          if (record !== undefined) {
            // 建筑仍在：恢复原位置与占用（防御性路径）。
            spatial.registerBuilding(adj.buildingId, record.placement, record.height);
            applyBuildingTransform(record.entity, record.placement, record.height);
          }
          releaseLockAndState();
          if (record !== undefined) updateSelection();
          else if (selectedId === adj.buildingId) hideSelection();
          return true;
        }

        if (record === undefined) {
          // 记录意外丢失：无法恢复实体，只能安全清理状态，避免锁死玩家。
          console.error('M1.4.1: building record disappeared during adjustment', adj.buildingId);
          releaseLockAndState();
          hideSelection();
          return false;
        }

        if (mode === 'cancel') {
          // 原位置若被其他建筑意外占用：不覆盖、不丢弃建筑，保持调整状态。
          const conflict = spatial.overlapsPlacement(
            adj.original,
            record.height,
            adj.buildingId,
          );
          if (conflict.length > 0) {
            console.error('M1.4.1: original placement is occupied; staying in adjustment mode');
            adjustment = setAdjustmentValidity(adj, true, false);
            showGhostAt(adj.typeIndex, false, adj.placement, record.height);
            placeDirectionMarker(adj.placement, record.height);
            return false;
          }
          if (record.placement !== undefined) {
            // record.placement 在调整期间未被修改，仍为原位置。
          }
          const restored = originalPlacement(adj);
          record.placement = restored;
          spatial.registerBuilding(adj.buildingId, restored, record.height);
          applyBuildingTransform(record.entity, restored, record.height);
          releaseLockAndState();
          updateSelection();
          return true;
        }

        // confirm
        const verdict = validate(adj.placement, record.height, adj.buildingId);
        if (!verdict.ok) {
          adjustment = setAdjustmentValidity(adj, adj.hasPreview, false);
          if (adj.hasPreview) showGhostAt(adj.typeIndex, false, adj.placement, record.height);
          return false;
        }
        const finalPlacement = currentPlacement(adj);
        record.placement = finalPlacement;
        spatial.registerBuilding(adj.buildingId, finalPlacement, record.height);
        applyBuildingTransform(record.entity, finalPlacement, record.height);
        releaseLockAndState();
        updateSelection();
        return true;
      };

      // ---- 每帧系统 ----
      world
        .addSystem(Update, {
          name: SYSTEM_NAME,
          after: [PROPAGATE_TRANSFORMS_SYSTEM],
          queries: [],
          fn: () => {
            const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
            const selectedHotbarItem = hotbar.slots[hotbar.selected] ?? null;

            // 楼层建造模式（M1.8-A）：floors 插件在 build 之前写入该资源，普通建造完全让出输入。
            if (world.hasResource(FLOOR_MODE_KEY)) {
              if (adjustment !== undefined) finishAdjustment('abort');
              hideAllGhosts();
              hideDirectionMarker();
              hideSelection();
              return;
            }

            // 结构模块放置模式（P2-D）：assembly 插件写入该资源，普通建造完全让出输入。
            if (world.hasResource(STRUCTURE_MODE_KEY)) {
              if (adjustment !== undefined) finishAdjustment('abort');
              hideAllGhosts();
              hideDirectionMarker();
              hideSelection();
              publishTarget({ active: false });
              return;
            }

            // 机械模式：build 完全让出输入（机械系统在 build 之后接管）。
            // 同时清掉普通建筑选中/调整状态，保证 X/G 不会误作用于普通建筑。
            if (isMechanicalSelection(selectedHotbarItem)) {
              if (adjustment !== undefined) finishAdjustment('abort');
              hideAllGhosts();
              hideDirectionMarker();
              hideSelection();
              publishTarget({ active: false });
              return;
            }

            const size = bootstrapHost.drawingBufferSize();
            const position = input.mouse.position;

            // 公共：鼠标射线；目标支撑面按当前模式选择 Level。
            let ray: ArrayLike<number> | undefined;
            if (position && size.width > 0 && size.height > 0) {
              const inCanvas = position.x >= 0 && position.x < size.width
                && position.y >= 0 && position.y < size.height;
              if (inCanvas) {
                ray = viewportToWorld(world, camera, position.x, position.y, size.width, size.height);
              }
            }
            publishTarget({ active: false });

            // ================= 搬动调整分支（优先级最高） =================
            if (adjustment !== undefined) {
              const adj = adjustment;
              if (!buildings.has(adj.buildingId)) {
                finishAdjustment('abort');
                return;
              }

              if (input.keyboard.justPressedCode('Escape')) {
                finishAdjustment('cancel');
                publishTarget({ active: false });
                return;
              }
              // G / X / [ ] 在搬动期间忽略；R 旋转被搬动的建筑。
              if (input.keyboard.justPressedCode('KeyR')) {
                adjustment = rotateAdjustment(adj);
              }

              const adjustHeight = buildings.get(adjustment.buildingId)?.height ?? BUILDING_HEIGHT;
              const adjustLevel = adj.original.level;
              const target = ray ? pickSupportTarget(ray, adjustLevel, supports) : undefined;
              let current = adjustment;
              if (target !== undefined) {
                current = moveAdjustmentTo(current, target.cell);
                const verdict = validate(current.placement, adjustHeight, current.buildingId);
                current = setAdjustmentValidity(current, true, verdict.ok);
              } else {
                current = setAdjustmentValidity(current, false, false);
              }
              adjustment = current;

              if (current.hasPreview && target !== undefined) {
                publishTarget({
                  active: true,
                  cell: current.placement,
                  level: current.placement.level,
                  baseY: placementBaseY(current.placement),
                  valid: current.valid,
                });
                showGhostAt(current.typeIndex, current.valid, current.placement, adjustHeight);
                placeDirectionMarker(current.placement, adjustHeight);
              } else {
                hideAllGhosts();
                hideDirectionMarker();
              }

              if (input.mouse.justPressed(0) && current.hasPreview) {
                const verdict = validate(current.placement, adjustHeight, current.buildingId);
                if (verdict.ok) {
                  finishAdjustment('confirm');
                  publishTarget({ active: false });
                }
              }
              return;
            }

            // ================= 普通建造分支 =================
            if (input.keyboard.justPressedCode('BracketRight')) {
              activeTypeIndex = (activeTypeIndex + 1) % BUILDING_TYPES.length;
            }
            if (input.keyboard.justPressedCode('BracketLeft')) {
              activeTypeIndex = (activeTypeIndex + BUILDING_TYPES.length - 1) % BUILDING_TYPES.length;
            }
            if (input.keyboard.justPressedCode('KeyR')) rotation = normalizeRotation(rotation + 90);
            if (input.keyboard.justPressedCode('KeyX') && selectedId !== undefined) {
              demolish(selectedId);
            }
            if (input.keyboard.justPressedCode('Escape')) hideSelection();
            if (input.keyboard.justPressedCode('KeyG') && selectedId !== undefined) {
              if (enterAdjustment(selectedId)) return;
            }

            const type = BUILDING_TYPES[activeTypeIndex] as (typeof BUILDING_TYPES)[number];
            // 选中了非机械物品时，左键同样保留给物品使用（M1.5），本期不触发建造。
            const targetLevel = currentBuildLevel();
            const target = targetLevel !== undefined && ray
              ? pickSupportTarget(ray, targetLevel, supports)
              : undefined;

            let hoverPlacement: Placement | undefined;
            let hoverValid = false;
            if (target !== undefined && selectedHotbarItem === null) {
              hoverPlacement = createPlacement(
                target.cell.gx,
                target.cell.gz,
                type.w,
                type.d,
                rotation,
                target.level,
              );
              hoverValid = validate(hoverPlacement, type.height).ok;
              publishTarget({
                active: true,
                cell: target.cell,
                level: target.level,
                baseY: target.baseY,
                valid: hoverValid,
              });
            }

            if (input.mouse.justPressed(0) && selectedHotbarItem === null) {
              const hitId = ray ? findBuildingHit(ray) : undefined;
              if (hitId !== undefined) {
                selectedId = hitId;
                updateSelection();
              } else if (hoverPlacement !== undefined && hoverValid) {
                place(hoverPlacement, activeTypeIndex);
                hideSelection();
              } else {
                hideSelection();
              }
            }

            const hitId = ray ? findBuildingHit(ray) : undefined;
            if (selectedHotbarItem !== null || hoverPlacement === undefined || hitId !== undefined) {
              if (shownGhost !== undefined) hideAllGhosts();
              hideDirectionMarker();
            } else {
              const desired = ghosts.find(
                (ghost) => ghost.typeIndex === activeTypeIndex && ghost.valid === hoverValid,
              );
              const center = placementCenter(hoverPlacement);
              const poseKey = [
                activeTypeIndex,
                hoverValid ? 1 : 0,
                hoverPlacement.gx,
                hoverPlacement.gz,
                hoverPlacement.level,
                hoverPlacement.rotation,
              ].join(',');
              if (desired !== undefined) {
                if (shownGhost !== desired.entity) {
                  hideAllGhosts();
                  shownGhost = desired.entity;
                }
                if (poseKey !== ghostPoseKey) {
                  world.set(desired.entity, Transform, placementTransform(hoverPlacement, type.height)).unwrap();
                  ghostPoseKey = poseKey;
                }
                placeDirectionMarker(hoverPlacement, type.height);
              }
            }

            if (selectedId !== undefined) updateSelection();
          },
        })
        .unwrap();

      yield () => {
        // 插件销毁/页面重建：任何残留调整状态都必须安全清理。
        if (adjustment !== undefined) {
          try {
            const record = buildings.get(adjustment.buildingId);
            if (record !== undefined) {
              spatial.registerBuilding(adjustment.buildingId, record.placement, record.height);
              applyBuildingTransform(record.entity, record.placement, record.height);
            }
          } catch (error) {
            console.error('M1.4.1: failed to restore building during teardown', error);
          }
          adjustment = undefined;
        }
        setAdjustingLock(false);
        if (world.hasResource(BUILD_TARGET_STATE_KEY)) world.removeResource(BUILD_TARGET_STATE_KEY);
        world.removeSystem(Update, SYSTEM_NAME).unwrap();
        for (const [id, record] of buildings) {
          spatial.unregisterBuilding(id);
          world.despawn(record.entity).unwrap();
        }
        buildings.clear();
      };
    }, SYSTEM_NAME);

    // 光标类玩法：显式关闭指针锁（Worker 环境下 gameHost 不存在，必须走 executionBootstrapHost）。
    bootstrapHost.setPointerLockAllowed(false);
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.build,
  name: 'ISLAND INDUSTRIA / Build',
  plugins: true,
  build: () =>
    ok({
      'plugin/build': {
        kind: 'plugin',
        module: { specifier: './build.pack.ts', export: 'buildSystem' },
      },
    }),
});