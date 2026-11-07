import { Update } from '@forgeax/engine/ecs';
import { createBoxGeometry, createMeshBuilder } from '@forgeax/engine/geometry';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import {
  LineCapValue,
  LineWidthUnitsValue,
  Lines,
  Materials,
  MeshFilter,
  MeshRenderer,
} from '@forgeax/engine/render';
import { PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import { RenderQueue } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import {
  BUILD_SYSTEM_NAME,
  BUILD_TARGET_STATE_KEY,
  type BuildTargetState,
} from '../build/target.ts';
import {
  HIDDEN_POSITION_Y,
  HIGHLIGHT_CENTER_Y,
  buildGridLinePositions,
} from './grid-overlay.ts';

const SYSTEM_NAME = 'island-industria/grid-overlay';
const LINE_WIDTH_PIXELS = 2;
const GRID_LINE_COLOR = [0.5, 0.62, 0.72, 1] as const;
const HIGHLIGHT_COLOR = [1, 0.72, 0.2, 0.32] as const;

/**
 * 地面网格 + 悬停格高亮。
 * 高亮目标由 build 写入的 BuildTargetState 提供，不自行发射地面射线，
 * 也不依赖空间服务或场景顺序。
 */
export const gridOverlay: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world', 'assets'],
  apply(ctx) {
    const world = ctx.world;
    const assetRegistry = ctx.assets;
    if (!assetRegistry) throw new Error('grid overlay requires the asset service');

    ctx.effect(function* () {
      const lineMesh = createMeshBuilder({
        attributes: { position: buildGridLinePositions() },
        submeshes: [{ topology: 'line-list', materialSlot: 0 }],
        materialSlots: [{ slotName: 'surface' }],
      }).build().unwrap();
      const gridMeshHandle = assetRegistry.create(lineMesh).unwrap();
      const gridMaterialHandle = assetRegistry.create(
        Materials.unlit([...GRID_LINE_COLOR]),
      ).unwrap();
      yield () => {
        assetRegistry.release(gridMeshHandle).unwrap();
        assetRegistry.release(gridMaterialHandle).unwrap();
      };

      const highlightGeometry = createBoxGeometry(1, 0.02, 1).unwrap();
      const highlightMeshHandle = assetRegistry.create(highlightGeometry).unwrap();
      const highlightMaterialHandle = assetRegistry.create(
        Materials.unlit([...HIGHLIGHT_COLOR], {
          renderState: {
            depthWriteEnabled: false,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
          queue: RenderQueue.Transparent,
        }),
      ).unwrap();
      yield () => {
        assetRegistry.release(highlightMeshHandle).unwrap();
        assetRegistry.release(highlightMaterialHandle).unwrap();
      };

      const gridEntity = world
        .spawn(
          { component: Transform, data: { pos: [0, 0, 0] } },
          { component: MeshFilter, data: { assetHandle: gridMeshHandle } },
          { component: MeshRenderer, data: { materials: [gridMaterialHandle] } },
          {
            component: Lines,
            data: {
              width: LINE_WIDTH_PIXELS,
              widthUnits: LineWidthUnitsValue.pixels,
              cap: LineCapValue.butt,
            },
          },
        )
        .unwrap();

      const highlightEntity = world
        .spawn(
          { component: Transform, data: { pos: [0, HIDDEN_POSITION_Y, 0] } },
          { component: MeshFilter, data: { assetHandle: highlightMeshHandle } },
          { component: MeshRenderer, data: { materials: [highlightMaterialHandle] } },
        )
        .unwrap();

      yield () => {
        world.despawn(highlightEntity).unwrap();
        world.despawn(gridEntity).unwrap();
      };

      let highlightVisible = false;
      let lastTargetKey = '';

      const hideHighlight = (): void => {
        if (!highlightVisible) return;
        world.set(highlightEntity, Transform, { pos: [0, HIDDEN_POSITION_Y, 0] }).unwrap();
        highlightVisible = false;
        lastTargetKey = '';
      };

      world
        .addSystem(Update, {
          name: SYSTEM_NAME,
          after: [BUILD_SYSTEM_NAME],
          queries: [],
          fn: () => {
            if (!world.hasResource(BUILD_TARGET_STATE_KEY)) {
              hideHighlight();
              return;
            }
            const target = world.getResource<BuildTargetState>(BUILD_TARGET_STATE_KEY);
            if (!target.active || !target.cell || target.baseY === undefined) {
              hideHighlight();
              return;
            }
            const key = `${target.cell.gx},${target.cell.gz},${target.baseY},${target.level ?? -1}`;
            if (highlightVisible && key === lastTargetKey) return;
            world
              .set(highlightEntity, Transform, {
                pos: [
                  target.cell.gx + 0.5,
                  target.baseY + HIGHLIGHT_CENTER_Y,
                  target.cell.gz + 0.5,
                ],
              })
              .unwrap();
            highlightVisible = true;
            lastTargetKey = key;
          },
        })
        .unwrap();

      yield () => world.removeSystem(Update, SYSTEM_NAME).unwrap();
    }, SYSTEM_NAME);
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.gridOverlay,
  name: 'ISLAND INDUSTRIA / Grid Overlay',
  plugins: true,
  build: () =>
    ok({
      'plugin/grid-overlay': {
        kind: 'plugin',
        module: { specifier: './grid-overlay.pack.ts', export: 'gridOverlay' },
      },
    }),
});
