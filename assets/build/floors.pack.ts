import { Update, type EntityHandle } from '@forgeax/engine/ecs';
import { createBoxGeometry } from '@forgeax/engine/geometry';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { definePack } from '@forgeax/engine/pack/source';
import { viewportToWorld } from '@forgeax/engine/picking';
import type { Plugin } from '@forgeax/engine/plugin';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { Transform } from '@forgeax/engine/scene';
import { RenderQueue, ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import {
  createPlacement,
  normalizeRotation,
  type Cell,
  type Placement,
  type Rotation,
} from '../grid/grid.ts';
import { isBuildAreaCell } from '../grid/grid-overlay.ts';
import { levelBaseY, cellKey3, type Aabb, type Level } from '../spatial/space.ts';
import { pickSupportTarget } from '../spatial/picking.ts';
import type {} from '../spatial/service.ts';
import { overlapsPlayer } from '../player/occupancy.ts';
import type {} from '../player/player.ts';
import { rayAabbDistance } from '../build/build.ts';
import { BUILD_TARGET_STATE_KEY, BUILD_SYSTEM_NAME, type BuildTargetState } from '../build/target.ts';
import {
  DECK_THICKNESS,
  FLOOR_KINDS,
  FLOOR_MODE_KEY,
  deckBox,
  deckSupportVerdict,
  floorAabb,
  floorBlocksBuild,
  floorBlocksPlayer,
  floorFootprint,
  floorStructureId,
  floorSupportId,
  floorTopSupport,
  floorTraversal,
  floorTraversalId,
  openingRimBoxes,
  PILLAR_HEIGHT,
  stairStepBoxes,
  type FloorKind,
  type FloorModeState,
  type StepBox,
} from '../build/floors.ts';
import { resolveSceneEntity } from '../shared/scene-refs.ts';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';

const SYSTEM_NAME = 'island-industria/floors';
const HIDDEN_Y = -1000;

const PILLAR_COLOR = [0.42, 0.43, 0.46, 1] as const;
const DECK_COLOR = [0.36, 0.33, 0.28, 1] as const;
const STAIR_COLOR = [0.46, 0.37, 0.24, 1] as const;
const OPENING_COLOR = [0.92, 0.72, 0.24, 1] as const;
const GHOST_VALID_COLOR = [0.3, 0.9, 0.45, 0.35] as const;
const GHOST_INVALID_COLOR = [0.95, 0.25, 0.2, 0.35] as const;
const SELECTION_COLOR = [0.3, 0.85, 1, 0.35] as const;

/** 键盘 1-4 对应的结构顺序（与 FLOOR_KINDS 一致）。 */
const KIND_HOTKEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'] as const;

const KIND_LABEL: Readonly<Record<FloorKind, string>> = Object.freeze({
  pillar: '支柱',
  deck: '楼板',
  opening: '开孔',
  stair: '楼梯',
});

interface FloorRecord {
  readonly id: number;
  readonly kind: FloorKind;
  readonly placement: Placement;
  readonly entities: EntityHandle[];
  /** 需要随楼层可见性淡出的实体（楼板薄板）。 */
  readonly fadeEntities: EntityHandle[];
  readonly supportId?: string;
  readonly traversalId?: string;
  readonly structureId?: string;
  faded: boolean;
}

/**
 * M1.8-A 楼层建造系统。
 *
 * 独立于 `build`（普通建筑）与 `mechanical`（机械零件）的第三个建造入口：
 * 按 `V` 进入楼层模式，1-4 选结构，`R` 旋转（楼梯用），左键放置，`X`/`Delete` 拆除，`V`/`Esc` 退出。
 * 模式激活时写 `FLOOR_MODE_KEY` 资源，build 与 mechanical 看到后完全让出输入。
 *
 * 唯一权威数据：本插件的 `records`；空间占用一律走 `spatial` 服务
 * （支柱/楼板/楼梯注册 StructureRegistry，楼板/开孔注册 SupportSurface，楼梯注册 TraversalSurface）。
 */
export const floorsSystem: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world', 'assets', 'gameScene', 'player', 'spatial', 'executionBootstrapHost'],
  apply(ctx) {
    const world = ctx.world;
    const assets = ctx.assets;
    if (!assets) throw new Error('floors system requires the asset service');
    const camera = resolveSceneEntity(world, ctx.gameScene, 'camera');
    const player = ctx.player;
    const spatial = ctx.spatial;
    const bootstrapHost = ctx.executionBootstrapHost;

    ctx.effect(function* () {
      const cubeMesh = assets.create(createBoxGeometry(1, 1, 1).unwrap()).unwrap();
      const material = (color: readonly [number, number, number, number], metallic: number, roughness: number) =>
        assets!.create(Materials.standard({ baseColor: [...color], metallic, roughness })).unwrap();
      const overlay = (color: readonly [number, number, number, number]) =>
        assets!.create(Materials.unlit([...color], {
          renderState: {
            depthWriteEnabled: false,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
          queue: RenderQueue.Transparent,
        })).unwrap();

      const pillarMaterial = material(PILLAR_COLOR, 0.15, 0.7);
      const deckMaterial = material(DECK_COLOR, 0.3, 0.55);
      const deckFadedMaterial = overlay([...DECK_COLOR.slice(0, 3), 0.28] as [number, number, number, number]);
      const stairMaterial = material(STAIR_COLOR, 0.15, 0.7);
      const openingMaterial = material(OPENING_COLOR, 0.4, 0.4);
      const ghostValidMaterial = overlay(GHOST_VALID_COLOR);
      const ghostInvalidMaterial = overlay(GHOST_INVALID_COLOR);
      const selectionMaterial = overlay(SELECTION_COLOR);

      yield () => {
        for (const handle of [
          cubeMesh, pillarMaterial, deckMaterial, deckFadedMaterial, stairMaterial, openingMaterial,
          ghostValidMaterial, ghostInvalidMaterial, selectionMaterial,
        ]) {
          assets!.release(handle).unwrap();
        }
      };

      const spawnBox = (
        box: StepBox,
        mat: typeof deckMaterial,
      ): EntityHandle => world
        .spawn(
          { component: Transform, data: { pos: [...box.center], scale: [...box.size] } },
          { component: MeshFilter, data: { assetHandle: cubeMesh } },
          { component: MeshRenderer, data: { materials: [mat] } },
        )
        .unwrap();

      const ghost = world
        .spawn(
          { component: Transform, data: { pos: [0, HIDDEN_Y, 0], scale: [1, 1, 1] } },
          { component: MeshFilter, data: { assetHandle: cubeMesh } },
          { component: MeshRenderer, data: { materials: [ghostValidMaterial] } },
        )
        .unwrap();
      const selection = world
        .spawn(
          { component: Transform, data: { pos: [0, HIDDEN_Y, 0], scale: [1, 1, 1] } },
          { component: MeshFilter, data: { assetHandle: cubeMesh } },
          { component: MeshRenderer, data: { materials: [selectionMaterial] } },
        )
        .unwrap();
      yield () => {
        world.despawn(ghost).unwrap();
        world.despawn(selection).unwrap();
      };

      const records = new Map<number, FloorRecord>();
      /** 柱状占用：支柱 / 楼梯占的「某层某格整根柱子」。 */
      const columnSlot = new Map<string, number>();
      /** 板状占用：楼板 / 开孔占的「L+1 层某格薄板」。 */
      const slabSlot = new Map<string, number>();
      /** 只有支柱才提供楼板的结构支撑。 */
      const pillarCells = new Set<string>();

      let nextId = 1;
      let active = false;
      let kind: FloorKind = 'deck';
      let rotation: Rotation = 0;
      let hoveredId: number | undefined;
      let lastPlayerLevel = -1;

      const hideGhost = (entity: EntityHandle): void => {
        world.set(entity, Transform, { pos: [0, HIDDEN_Y, 0] }).unwrap();
      };
      hideGhost(ghost);
      hideGhost(selection);

      const columnKeys = (targetKind: FloorKind, placement: Placement): string[] => {
        const cells = footprintCells(placement);
        return cells.map((cell) => cellKey3(cell, placement.level));
      };
      const slabKeys = (placement: Placement): string[] => {
        const cells = footprintCells(placement);
        return cells.map((cell) => cellKey3(cell, placement.level + 1));
      };

      function footprintCells(placement: Placement): Cell[] {
        const cells: Cell[] = [];
        const extentW = placement.rotation % 180 === 0 ? placement.w : placement.d;
        const extentD = placement.rotation % 180 === 0 ? placement.d : placement.w;
        for (let gz = placement.gz; gz < placement.gz + extentD; gz += 1) {
          for (let gx = placement.gx; gx < placement.gx + extentW; gx += 1) cells.push({ gx, gz });
        }
        return cells;
      }

      const supportQuery = {
        hasPillar: (cell: Cell, level: Level): boolean => pillarCells.has(cellKey3(cell, level)),
        hasBuildableSupport: (cell: Cell, level: Level, worldY: number): boolean =>
          spatial.supports.buildableSupportAt(cell, level, worldY) !== undefined,
      };

      type Verdict = { readonly ok: boolean; readonly reason?: string };

      const validate = (targetKind: FloorKind, placement: Placement): Verdict => {
        const level = placement.level;
        const baseY = levelBaseY(level);
        const cells = footprintCells(placement);
        for (const cell of cells) {
          if (!isBuildAreaCell(cell)) return { ok: false, reason: 'out-of-bounds' };
          if (!spatial.supports.buildableSupportAt(cell, level, baseY)) {
            return { ok: false, reason: 'unsupported' };
          }
        }
        const columnKinds: FloorKind[] = ['pillar', 'stair'];
        if (columnKinds.includes(targetKind)) {
          for (const key of columnKeys(targetKind, placement)) {
            if (columnSlot.has(key)) return { ok: false, reason: 'occupied' };
          }
        } else {
          for (const key of slabKeys(placement)) {
            if (slabSlot.has(key)) return { ok: false, reason: 'occupied' };
          }
          for (const cell of cells) {
            if (!deckSupportVerdict(cell, level, supportQuery)) return { ok: false, reason: 'unsupported' };
          }
        }
        const aabb = floorAabb(targetKind, placement);
        if (floorBlocksBuild(targetKind)) {
          if (spatial.index.overlapsAabb(aabb).length > 0) return { ok: false, reason: 'occupied' };
        }
        if (floorBlocksPlayer(targetKind)) {
          const position = player.state.position;
          if (overlapsPlayer(aabb, position[0], position[1], position[2])) {
            return { ok: false, reason: 'player-cell' };
          }
        }
        return { ok: true };
      };

      const register = (record: FloorRecord): void => {
        const { kind: targetKind, placement, id } = record;
        for (const cell of footprintCells(placement)) {
          const key = cellKey3(cell, placement.level);
          if (targetKind === 'pillar' || targetKind === 'stair') columnSlot.set(key, id);
          if (targetKind === 'pillar') pillarCells.add(key);
        }
        if (targetKind === 'deck' || targetKind === 'opening') {
          for (const key of slabKeys(placement)) slabSlot.set(key, id);
        }
        if (floorBlocksBuild(targetKind)) {
          spatial.structures.register({
            id: floorStructureId(targetKind, id),
            aabb: floorAabb(targetKind, placement),
            blocksBuild: true,
            blocksPlayer: floorBlocksPlayer(targetKind),
          });
        }
        const support = floorTopSupport(targetKind, floorSupportId(targetKind, id), placement);
        if (support) spatial.supports.register(support);
        const traversal = floorTraversal(targetKind, floorTraversalId(id), placement);
        if (traversal) spatial.traversals.register(traversal);
      };

      const unregister = (record: FloorRecord): void => {
        const { kind: targetKind, placement, id } = record;
        for (const cell of footprintCells(placement)) {
          const key = cellKey3(cell, placement.level);
          if (columnSlot.get(key) === id) columnSlot.delete(key);
          if (pillarCells.has(key) && (targetKind === 'pillar')) pillarCells.delete(key);
        }
        if (targetKind === 'deck' || targetKind === 'opening') {
          for (const key of slabKeys(placement)) {
            if (slabSlot.get(key) === id) slabSlot.delete(key);
          }
        }
        const structureId = floorStructureId(targetKind, id);
        if (spatial.structures.get(structureId)) spatial.structures.unregister(structureId);
        spatial.supports.unregister(floorSupportId(targetKind, id));
        spatial.traversals.unregister(floorTraversalId(id));
      };

      const visualBoxes = (targetKind: FloorKind, placement: Placement): { box: StepBox; mat: typeof deckMaterial; fade: boolean }[] => {
        if (targetKind === 'pillar') {
          const aabb = floorAabb('pillar', placement);
          return [{
            box: {
              center: [
                ((aabb.min[0] as number) + (aabb.max[0] as number)) / 2,
                levelBaseY(placement.level) + PILLAR_HEIGHT / 2,
                ((aabb.min[2] as number) + (aabb.max[2] as number)) / 2,
              ],
              size: [
                (aabb.max[0] as number) - (aabb.min[0] as number),
                PILLAR_HEIGHT,
                (aabb.max[2] as number) - (aabb.min[2] as number),
              ],
            },
            mat: pillarMaterial,
            fade: false,
          }];
        }
        if (targetKind === 'deck') {
          return [{ box: deckBox(placement), mat: deckMaterial, fade: true }];
        }
        if (targetKind === 'opening') {
          return openingRimBoxes(placement).map((box) => ({ box, mat: openingMaterial, fade: false }));
        }
        // 楼梯：楼板底座 + 8 级台阶
        const base = deckBox(placement);
        const items = stairStepBoxes(placement).map((box) => ({ box, mat: stairMaterial, fade: false }));
        items.unshift({
          box: { center: base.center, size: [base.size[0], DECK_THICKNESS, base.size[2]] },
          mat: stairMaterial,
          fade: false,
        });
        return items;
      };

      const place = (targetKind: FloorKind, placement: Placement): boolean => {
        const verdict = validate(targetKind, placement);
        if (!verdict.ok) return false;
        const id = nextId;
        nextId += 1;
        const visuals = visualBoxes(targetKind, placement);
        const entities: EntityHandle[] = [];
        const fadeEntities: EntityHandle[] = [];
        for (const item of visuals) {
          const entity = spawnBox(item.box, item.mat);
          entities.push(entity);
          if (item.fade) fadeEntities.push(entity);
        }
        const record: FloorRecord = {
          id,
          kind: targetKind,
          placement,
          entities,
          fadeEntities,
          supportId: undefined,
          traversalId: undefined,
          structureId: undefined,
          faded: false,
        };
        try {
          register(record);
        } catch (error) {
          for (const entity of entities) world.despawn(entity).unwrap();
          throw error;
        }
        records.set(id, record);
        return true;
      };

      const remove = (id: number): boolean => {
        const record = records.get(id);
        if (!record) return false;
        unregister(record);
        records.delete(id);
        for (const entity of record.entities) world.despawn(entity).unwrap();
        if (hoveredId === id) hoveredId = undefined;
        hideGhost(selection);
        return true;
      };

      const hitFloor = (ray: ArrayLike<number> | undefined): number | undefined => {
        if (!ray) return undefined;
        let bestId: number | undefined;
        let bestDistance = Infinity;
        for (const record of records.values()) {
          const aabb = floorAabb(record.kind, record.placement);
          const distance = rayAabbDistance(ray, aabb.min, aabb.max);
          if (distance !== undefined && distance < bestDistance) {
            bestDistance = distance;
            bestId = record.id;
          }
        }
        return bestId;
      };

      const showGhost = (targetKind: FloorKind, placement: Placement | undefined, valid: boolean): void => {
        if (!placement) {
          hideGhost(ghost);
          return;
        }
        const aabb = floorAabb(targetKind, placement);
        const shade = aabb.max[1] as number;
        world.set(ghost, Transform, {
          pos: [
            ((aabb.min[0] as number) + (aabb.max[0] as number)) / 2,
            ((aabb.min[1] as number) + shade) / 2,
            ((aabb.min[2] as number) + (aabb.max[2] as number)) / 2,
          ],
          scale: [
            (aabb.max[0] as number) - (aabb.min[0] as number),
            shade - (aabb.min[1] as number),
            (aabb.max[2] as number) - (aabb.min[2] as number),
          ],
        }).unwrap();
        world.set(ghost, MeshRenderer, {
          materials: [valid ? ghostValidMaterial : ghostInvalidMaterial],
        }).unwrap();
      };

      const showSelection = (id: number | undefined): void => {
        const record = id === undefined ? undefined : records.get(id);
        if (!record) {
          hideGhost(selection);
          return;
        }
        const aabb = floorAabb(record.kind, record.placement);
        const pad = 0.04;
        world.set(selection, Transform, {
          pos: [
            ((aabb.min[0] as number) + (aabb.max[0] as number)) / 2,
            ((aabb.min[1] as number) + (aabb.max[1] as number)) / 2,
            ((aabb.min[2] as number) + (aabb.max[2] as number)) / 2,
          ],
          scale: [
            (aabb.max[0] as number) - (aabb.min[0] as number) + pad,
            (aabb.max[1] as number) - (aabb.min[1] as number) + pad,
            (aabb.max[2] as number) - (aabb.min[2] as number) + pad,
          ],
        }).unwrap();
      };

      /** 玩家在低层时把上层楼板淡出，避免俯视相机被完全遮挡。 */
      const applyLevelFade = (playerLevel: number): void => {
        if (playerLevel === lastPlayerLevel) return;
        lastPlayerLevel = playerLevel;
        for (const record of records.values()) {
          if (record.kind !== 'deck') continue;
          const wantFaded = record.placement.level + 1 > playerLevel;
          if (wantFaded === record.faded) continue;
          record.faded = wantFaded;
          const target = wantFaded ? deckFadedMaterial : deckMaterial;
          for (const entity of record.fadeEntities) {
            world.set(entity, MeshRenderer, { materials: [target] }).unwrap();
          }
        }
      };

      const publishTarget = (state: BuildTargetState): void => {
        world.insertResource(BUILD_TARGET_STATE_KEY, state);
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

      world.addSystem(Update, {
        name: SYSTEM_NAME,
        // 必须早于 build：模式锁资源要在 build 读它之前写好（否则同一帧内 build 仍会响应输入）。
        before: [BUILD_SYSTEM_NAME],
        queries: [],
        fn: () => {
          const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);

          if (input.keyboard.justPressedCode('KeyV')) {
            active = !active;
            hoveredId = undefined;
            rotation = 0;
            if (active) {
              world.insertResource(FLOOR_MODE_KEY, { active: true, kind, rotation } satisfies FloorModeState);
            } else if (world.hasResource(FLOOR_MODE_KEY)) {
              world.removeResource(FLOOR_MODE_KEY);
              hideGhost(ghost);
              hideGhost(selection);
            }
          }

          if (!active) {
            if (world.hasResource(FLOOR_MODE_KEY)) world.removeResource(FLOOR_MODE_KEY);
            return;
          }

          for (let index = 0; index < KIND_HOTKEYS.length; index += 1) {
            const code = KIND_HOTKEYS[index] as string;
            if (input.keyboard.justPressedCode(code)) kind = FLOOR_KINDS[index] as FloorKind;
          }
          if (input.keyboard.justPressedCode('KeyR')) rotation = normalizeRotation(rotation + 90);
          world.insertResource(FLOOR_MODE_KEY, { active: true, kind, rotation } satisfies FloorModeState);

          if (input.keyboard.justPressedCode('Escape')) {
            active = false;
            hoveredId = undefined;
            if (world.hasResource(FLOOR_MODE_KEY)) world.removeResource(FLOOR_MODE_KEY);
            hideGhost(ghost);
            hideGhost(selection);
            return;
          }

          const playerLevel = player.state.level;
          applyLevelFade(playerLevel);

          const ray = rayFromMouse(input);
          const target = ray ? pickSupportTarget(ray, playerLevel, spatial.supports) : undefined;
          const footprint = floorFootprint(kind);
          const placement: Placement | undefined = target
            ? createPlacement(target.cell.gx, target.cell.gz, footprint.w, footprint.d, rotation, playerLevel)
            : undefined;
          const verdict = placement ? validate(kind, placement) : undefined;

          const candidateId = hitFloor(ray);
          hoveredId = candidateId;
          showSelection(candidateId);

          if (input.keyboard.justPressedCode('KeyX')
            || input.keyboard.justPressedCode('Delete')
            || input.keyboard.justPressedCode('Backspace')) {
            if (candidateId !== undefined) {
              remove(candidateId);
              publishTarget({ active: false });
              return;
            }
          }

          if (placement && verdict) {
            showGhost(kind, placement, verdict.ok);
            publishTarget({
              active: true,
              cell: target!.cell,
              level: playerLevel,
              baseY: levelBaseY(playerLevel),
              valid: verdict.ok,
            });
            if (input.mouse.justPressed(0) && verdict.ok) place(kind, placement);
          } else {
            hideGhost(ghost);
            publishTarget({ active: false });
          }
        },
      }).unwrap();

      yield () => {
        world.removeSystem(Update, SYSTEM_NAME).unwrap();
        if (world.hasResource(FLOOR_MODE_KEY)) world.removeResource(FLOOR_MODE_KEY);
        for (const record of records.values()) {
          unregister(record);
          for (const entity of record.entities) world.despawn(entity).unwrap();
        }
        records.clear();
        columnSlot.clear();
        slabSlot.clear();
        pillarCells.clear();
      };
    }, SYSTEM_NAME);

    bootstrapHost.setPointerLockAllowed(false);
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.floors,
  name: 'ISLAND INDUSTRIA / Floors',
  plugins: true,
  build: () =>
    ok({
      'plugin/floors': {
        kind: 'plugin',
        module: { specifier: './floors.pack.ts', export: 'floorsSystem' },
      },
    }),
});
