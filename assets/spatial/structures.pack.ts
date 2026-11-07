import { createBoxGeometry } from '@forgeax/engine/geometry';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { Transform } from '@forgeax/engine/scene';
import type { EntityHandle } from '@forgeax/engine/ecs';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import type {} from './service.ts';
import {
  MAIN_STAIRS,
  PLATFORM_COLLIDER,
  PLATFORM_SUPPORT,
  STAIRS_COLLIDER,
  STAIRS_TRAVERSAL,
  stairStepCenter,
} from './structures.ts';

const SYSTEM_NAME = 'island-industria/structures';

const PLATFORM_COLOR = [0.34, 0.37, 0.4, 1] as const;
const STAIRS_COLOR = [0.46, 0.37, 0.24, 1] as const;

/**
 * 固定平台与楼梯：程序化视觉 + 注册支撑面/通行面/实体碰撞体。
 * M1.5-B 不实现玩家上下楼；楼梯 AABB 只参与建筑放置碰撞。
 */
export const structuresSystem: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world', 'assets', 'spatial'],
  apply(ctx) {
    const world = ctx.world;
    const assets = ctx.assets;
    const spatial = ctx.spatial;
    if (!assets) throw new Error('structures require the asset service');

    ctx.effect(function* () {
      const platformMesh = assets.create(createBoxGeometry(8, 0.3, 6).unwrap()).unwrap();
      const platformMaterial = assets.create(
        Materials.standard({ baseColor: [...PLATFORM_COLOR], metallic: 0.2, roughness: 0.65 }),
      ).unwrap();
      const stepMesh = assets.create(createBoxGeometry(1, 1, 1).unwrap()).unwrap();
      const stepMaterial = assets.create(
        Materials.standard({ baseColor: [...STAIRS_COLOR], metallic: 0.15, roughness: 0.7 }),
      ).unwrap();

      // 平台板：AABB x[0,8] y[2.7,3.0] z[2,8]；顶面 y=3。
      const platform = world
        .spawn(
          { component: Transform, data: { pos: [4, 2.85, 5] } },
          { component: MeshFilter, data: { assetHandle: platformMesh } },
          { component: MeshRenderer, data: { materials: [platformMaterial] } },
        )
        .unwrap();

      // 楼梯：每级一个箱体，全部由 MAIN_STAIRS 的 stepCount/stepRun/stepRise 派生。
      const steps: EntityHandle[] = [];
      for (let index = 0; index < MAIN_STAIRS.stepCount; index += 1) {
        const step = stairStepCenter(index);
        const height = step.topY;
        const entity = world
          .spawn(
            {
              component: Transform,
              data: {
                pos: [step.x, height / 2, step.z],
                scale: [MAIN_STAIRS.stepRun, height, MAIN_STAIRS.widthCells],
              },
            },
            { component: MeshFilter, data: { assetHandle: stepMesh } },
            { component: MeshRenderer, data: { materials: [stepMaterial] } },
          )
          .unwrap();
        steps.push(entity);
      }

      // 数据注册：支撑面 / 实体碰撞 / 通行面。
      spatial.supports.register(PLATFORM_SUPPORT);
      spatial.structures.register(PLATFORM_COLLIDER);
      spatial.structures.register(STAIRS_COLLIDER);
      spatial.traversals.register(STAIRS_TRAVERSAL);

      yield () => {
        spatial.traversals.unregister(STAIRS_TRAVERSAL.id);
        spatial.structures.unregister(STAIRS_COLLIDER.id);
        spatial.structures.unregister(PLATFORM_COLLIDER.id);
        spatial.supports.unregister(PLATFORM_SUPPORT.id);
        for (const entity of steps) world.despawn(entity).unwrap();
        world.despawn(platform).unwrap();
        assets.release(stepMesh).unwrap();
        assets.release(stepMaterial).unwrap();
        assets.release(platformMesh).unwrap();
        assets.release(platformMaterial).unwrap();
      };
    }, SYSTEM_NAME);
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.structures,
  name: 'ISLAND INDUSTRIA / Structures',
  plugins: true,
  build: () =>
    ok({
      'plugin/structures': {
        kind: 'plugin',
        module: { specifier: './structures.pack.ts', export: 'structuresSystem' },
      },
    }),
});