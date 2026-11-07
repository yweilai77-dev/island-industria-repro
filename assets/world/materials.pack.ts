import { definePack } from '@forgeax/engine/pack/source';
import { Materials } from '@forgeax/engine/render';
import type { MaterialAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';

/**
 * MVP 0.1 的材质包：地面、立方体与 M1.6 地图边缘包边。
 * 颜色是线性 RGB（不是 sRGB 十六进制），金属度/粗糙度决定高光表现。
 */
export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.materials,
  name: 'ISLAND INDUSTRIA / Materials',
  build: () =>
    ok({
      'material/ground': Materials.standard({
        baseColor: [0.12, 0.13, 0.12, 1],
        metallic: 0.02,
        roughness: 0.95,
      }) as MaterialAsset,
      'material/cube': Materials.standard({
        baseColor: [0.78, 0.3, 0.07, 1],
        metallic: 0.03,
        roughness: 0.42,
      }) as MaterialAsset,
      'material/edge': Materials.standard({
        baseColor: [0.16, 0.18, 0.2, 1],
        metallic: 0.25,
        roughness: 0.7,
      }) as MaterialAsset,
    }),
});
