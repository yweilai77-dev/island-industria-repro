import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import { MAP_CONFIG } from '../world/map-config.ts';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { SpatialIndex } from './occupancy.ts';
import type {} from './service.ts';
import { StructureRegistry } from './structure.ts';
import {
  GROUND_SUPPORT_ID,
  SUPPORT_REGISTRY_KEY,
  SupportRegistry,
  TraversalRegistry,
} from './support.ts';

const SYSTEM_NAME = 'island-industria/spatial';

/**
 * 独立空间服务：地面支撑、支撑/通行注册表、三维空间索引、结构碰撞体。
 * 由 scene-owner 在 player/build 之前挂载；build 注入 spatial 服务使用同一份状态。
 * M1.6：Ground SupportSurface 的格子集合由 MapConfig 提供（当前 32×32=1024 格），
 * 继续使用现有稀疏 SupportRegistry，不重构数据结构。
 */
export const spatialService: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world'],
  apply(ctx) {
    const world = ctx.world;
    ctx.effect(function* () {
      const supports = new SupportRegistry();
      const traversals = new TraversalRegistry();
      const index = new SpatialIndex();
      const structures = new StructureRegistry(index);

      supports.register({
        id: GROUND_SUPPORT_ID,
        level: 0,
        worldY: 0,
        cells: MAP_CONFIG.cells(),
        kind: 'ground',
        buildable: true,
        walkable: true,
        active: true,
      });
      world.insertResource(SUPPORT_REGISTRY_KEY, supports);

      const service = { supports, traversals, index, structures };
      yield ctx.provide('spatial', service);

      yield () => {
        structures.clear();
        traversals.clear();
        supports.clear();
        index.clear();
        if (world.hasResource(SUPPORT_REGISTRY_KEY)) world.removeResource(SUPPORT_REGISTRY_KEY);
      };
    }, SYSTEM_NAME);
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.spatial,
  name: 'ISLAND INDUSTRIA / Spatial',
  plugins: true,
  build: () =>
    ok({
      'plugin/spatial': {
        kind: 'plugin',
        module: { specifier: './spatial.pack.ts', export: 'spatialService' },
      },
    }),
});
