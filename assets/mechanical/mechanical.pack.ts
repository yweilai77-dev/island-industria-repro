import { Update, type EntityHandle } from '@forgeax/engine/ecs';
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
import type {} from '../hotbar/hotbar.ts';
import type {} from '../spatial/service.ts';
import type {} from '@forgeax/engine/app';
import {
  PROTOTYPE_KIT,
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
import {
  PartViewRegistry,
  createMechanicalViewAssets,
  createPartView,
  releaseMechanicalViewAssets,
  type MechanicalViewAssets,
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
  inject: ['world', 'assets', 'gameScene', 'player', 'hotbar', 'inventory', 'spatial', 'resourceNodes', 'executionBootstrapHost'],
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

    ctx.effect(function* () {
      const viewAssets: MechanicalViewAssets = createMechanicalViewAssets(assets);
      const views = new PartViewRegistry(world);
      const registry = new MechanicalRegistry();
      const validGhost = spawnGhost(world, viewAssets.ghostMesh, viewAssets.ghostValidMaterial);
      const invalidGhost = spawnGhost(world, viewAssets.ghostMesh, viewAssets.ghostInvalidMaterial);
      const selection = spawnGhost(world, viewAssets.ghostMesh, viewAssets.selectionMaterial);
      let rotation: Rotation = 0;
      let selectedPartId: number | undefined;

      const hideGhost = (entity: EntityHandle): void => {
        world.set(entity, Transform, { pos: [0, HIDDEN_Y, 0] }).unwrap();
      };
      hideGhost(validGhost);
      hideGhost(invalidGhost);
      hideGhost(selection);

      const grantKit = (): void => {
        if (world.hasResource(KIT_GRANTED_KEY)) return;
        const kitSlots: readonly PartId[] = ['shaft', 'gear_12', 'gear_24', 'power_source', 'machine'];
        kitSlots.forEach((id, index) => {
          const definition = MECHANICAL_PART_DEFS[id];
          inventory.add(definition.itemId, PROTOTYPE_KIT[id]);
          hotbar.bind(index, definition.itemId);
        });
        world.insertResource(KIT_GRANTED_KEY, 1);
      };
      grantKit();

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

      const service: MechanicalService = {
        get revision() { return registry.revision; },
        parts: () => registry.all(),
        connections: () => registry.connections(),
        partAt,
      };

      const selectedItem = (): ReturnType<typeof partDefForItem> => {
        const itemId = hotbar.slots[hotbar.selected] ?? null;
        return partDefForItem(itemId);
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

      const commitTopology = (): void => {
        registry.rebuildConnections();
        registry.commitTopology();
        refreshJoints();
        // TEMP DEBUG (remove before delivery)
        console.log('MECH_TOPOLOGY ' + JSON.stringify({
          revision: registry.revision,
          parts: registry.all().map((part) => ({ id: part.id, kind: part.def.kind, cell: [part.placement.gx, part.placement.gz], rot: part.placement.rotation })),
          connections: registry.connections(),
          joints: views.jointCount,
        }));
      };

      const rollbackPlace = (partId: number): void => {
        spatial.structures.unregister(structureIdForPart(partId));
        views.dispose(partId);
        registry.remove(partId);
      };

      const place = (definition: MechanicalPartDef, placement: Placement): boolean => {
        if (!inventory.has(definition.itemId, 1)) return false;
        const partId = registry.allocateId();
        const part: MechanicalPart = { id: partId, def: definition, placement };
        let registered = false;
        let viewAdded = false;
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
          commitTopology();
          return true;
        } catch (error) {
          if (registered || viewAdded) rollbackPlace(partId);
          throw error;
        }
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
          const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          const definition = selectedItem();
          const inMode = definition !== undefined;
          if (!inMode) {
            setGhost(undefined, undefined, false);
            selectedPartId = undefined;
            return;
          }
          if (input.keyboard.justPressedCode('KeyR')) rotation = normalizeRotation(rotation + 90);
          if (input.keyboard.justPressedCode('Escape')) {
            selectedPartId = undefined;
            setGhost(undefined, undefined, false);
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
          if (placement) {
            const valid = validPlacement(definition, placement);
            setGhost(definition, placement, valid);
            if (input.mouse.justPressed(0)) {
              if (hoverPart !== undefined) {
                selectedPartId = hoverPart;
              } else if (valid) {
                place(definition, placement);
              }
            }
          } else {
            setGhost(undefined, undefined, false);
            if (input.mouse.justPressed(0) && hoverPart !== undefined) selectedPartId = hoverPart;
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
    }),
});