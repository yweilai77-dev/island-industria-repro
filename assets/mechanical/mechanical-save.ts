/**
 * M2.0-P2-E3 机械零件存档适配层（从 mechanical.pack.ts 抽出，守住单文件 20KB 限制）。
 *
 * 边界：不复制权威状态，只通过 registry/spatial/views 的既有原语重建世界；
 * 读档不消耗物品、不检查科技门控、不重复发放开局套件。
 */
import type { World } from '@forgeax/engine/ecs';
import { createPlacement, normalizeRotation, type Placement } from '../grid/grid.ts';
import { placementAabb } from '../spatial/space.ts';
import type { SpatialService } from '../spatial/service.ts';
import { validatePlacement } from '../build/build.ts';
import type { ResourceNodesService } from '../resource/resource.ts';
import {
  MECHANICAL_PART_DEFS,
  structureIdForPart,
  type MechanicalPart,
  type PartId,
} from './parts.ts';
import type { MechanicalRegistry } from './registry.ts';
import { createPartView, type MechanicalViewAssets, type PartViewRegistry } from './visuals.ts';
import { normalizeKitGranted, normalizePartsSlice, type SaveMechanicalData } from '../save/save-schema.ts';
import type { SaveRestoreReport } from '../save/save-ports.ts';

/** 开局套件已发放标记的 World 资源键（存档需要持久化，避免读档重复赠送）。 */
export const MECHANICAL_KIT_GRANTED_KEY = 'IslandIndustriaMechanicalKitGranted';

export interface MechanicalSaveDeps {
  readonly world: World;
  readonly registry: MechanicalRegistry;
  readonly spatial: SpatialService;
  readonly views: PartViewRegistry;
  readonly viewAssets: MechanicalViewAssets;
  readonly resourceNodes: ResourceNodesService;
  /** pack 的事务提交原语（重建连接 + 接头 + revision）。 */
  readonly commitTopology: () => void;
  /** 清空选中/悬停/幽灵（pack 的 UI 状态）。 */
  readonly resetSelection: () => void;
}

export interface MechanicalSavePort {
  saveSnapshot(): SaveMechanicalData;
  restoreSave(rawParts: unknown, rawNextPartId: unknown, rawKitGranted: unknown): SaveRestoreReport;
}

export function createMechanicalSave(deps: MechanicalSaveDeps): MechanicalSavePort {
  const { world, registry, spatial, views, viewAssets, resourceNodes, commitTopology, resetSelection } = deps;

  const saveSnapshot = (): SaveMechanicalData => ({
    nextPartId: registry.nextPartId,
    kitGranted: world.hasResource(MECHANICAL_KIT_GRANTED_KEY),
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
    resetSelection();
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
      if (!world.hasResource(MECHANICAL_KIT_GRANTED_KEY)) world.insertResource(MECHANICAL_KIT_GRANTED_KEY, 1);
    } else if (world.hasResource(MECHANICAL_KIT_GRANTED_KEY)) {
      world.removeResource(MECHANICAL_KIT_GRANTED_KEY);
    }
    return { restored, issues };
  };

  return { saveSnapshot, restoreSave };
}
