import { definePack, definePackageId } from '@forgeax/engine/pack/source';
import { ok } from '@forgeax/engine/types';
// Include the asset service vocabulary without adding a runtime import.
import type {} from '@forgeax/engine/assets-runtime';
import { joinPluginFiber, mountPluginAsset } from '@forgeax/engine/plugin';
import type { Plugin } from '@forgeax/engine/plugin';
import { worldDespawnScene } from '@forgeax/engine/scene';
import { assetGuid, guidText, PACKAGE_IDS } from './shared/asset-refs.ts';

interface SceneOwnerConfig {
  readonly scene: string;
  /** 场景实例化后再挂载的子插件（相机等玩法插件）。 */
  readonly children?: readonly string[];
}

export const sceneOwner: Plugin.Object<SceneOwnerConfig> = {
  name: 'empty/scene',
  inject: ['assets', 'world'],
  async apply(ctx, config) {
    if (!ctx.assets) throw new Error('scene requires the asset service');
    const loaded = await ctx.assets.load(ctx.assets.parseGuid(config.scene), 'scene');
    if (!loaded.ok) throw loaded.error;
    await ctx.effect(async function* () {
      const handle = loaded.value;
      yield () => {
        ctx.assets!.release(handle).unwrap();
      };
      const root = ctx.assets!.instantiate(handle, ctx.world).unwrap();
      yield () => worldDespawnScene(ctx.world, root).unwrap();
      // 把场景根暴露给子插件：相机等插件按「实体名」解析句柄。
      yield ctx.provide('gameScene', { root });
      for (const guid of config.children ?? []) {
        const child = await mountPluginAsset(ctx, guid);
        if (!child.ok) throw child.error;
        yield joinPluginFiber(child.value);
      }
    }, 'empty/scene');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: definePackageId('019fb7ce-1100-7000-8000-000000000000'),
  build: () => ok({
    'plugin/scene': {
      kind: 'plugin',
      module: { specifier: './scene-owner.pack.ts', export: 'sceneOwner' },
      config: {
        scene: { $asset: guidText(assetGuid(PACKAGE_IDS.scene, 'scene/mvp')) },
        children: [
          { $asset: guidText(assetGuid(PACKAGE_IDS.camera, 'plugin/camera')) },
          { $asset: guidText(assetGuid(PACKAGE_IDS.gridOverlay, 'plugin/grid-overlay')) },
          // spatial 必须先于 structures 与 build：后者注入 spatial 服务。
          { $asset: guidText(assetGuid(PACKAGE_IDS.spatial, 'plugin/spatial')) },
          { $asset: guidText(assetGuid(PACKAGE_IDS.structures, 'plugin/structures')) },
          { $asset: guidText(assetGuid(PACKAGE_IDS.player, 'plugin/player')) },
          // M1.8-A 楼层结构：需要 spatial/player 已就绪；必须早于 build（模式锁在 build 之前写入）。
          { $asset: guidText(assetGuid(PACKAGE_IDS.floors, 'plugin/floors')) },
          // hotbar 必须先于 build（build 注入 hotbar 服务）。
          { $asset: guidText(assetGuid(PACKAGE_IDS.hotbar, 'plugin/hotbar')) },
          { $asset: guidText(assetGuid(PACKAGE_IDS.resource, 'plugin/resource')) },
          { $asset: guidText(assetGuid(PACKAGE_IDS.build, 'plugin/build')) },
          { $asset: guidText(assetGuid(PACKAGE_IDS.inventory, 'plugin/inventory')) },
          { $asset: guidText(assetGuid(PACKAGE_IDS.gameUiBridge, 'plugin/game-ui-bridge')) },
          { $asset: guidText(assetGuid(PACKAGE_IDS.harvest, 'plugin/harvest')) },
          // 机械系统最后挂载：需要 inventory/hotbar/spatial/player 已就绪。
          { $asset: guidText(assetGuid(PACKAGE_IDS.mechanical, 'plugin/mechanical')) },
          // 动力运行时依赖 mechanical 服务，必须在其后挂载。
          { $asset: guidText(assetGuid(PACKAGE_IDS.mechanical, 'plugin/mechanical-runtime')) },
        ],
      },
    },
  }),
});