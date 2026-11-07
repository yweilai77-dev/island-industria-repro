import { createBoxGeometry } from '@forgeax/engine/geometry';
import { definePack } from '@forgeax/engine/pack/source';
import type { AssetGuid, MeshAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { assetGuid, PACKAGE_IDS } from '../shared/asset-refs.ts';

/** 给网格绑一个默认材质槽：MeshRenderer 不显式给材质时就用它。 */
function withMaterial(mesh: MeshAsset, material: AssetGuid, sourceKey: string): MeshAsset {
  return {
    ...mesh,
    materialSlots: [{ slotName: 'surface', sourceKey, defaultMaterial: material }],
  };
}

/**
 * MVP 0.1 的几何体包：地面（扁平长方体）与立方体。
 * 几何体在构建期由引擎工厂生成，不提交二进制模型文件。
 */
export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.geometry,
  name: 'ISLAND INDUSTRIA / Geometry',
  build: () => {
    const ground = createBoxGeometry(20, 0.2, 20);
    if (!ground.ok) return ground;

    const cube = createBoxGeometry(1.2, 1.2, 1.2);
    if (!cube.ok) return cube;

    return ok({
      'mesh/ground': withMaterial(
        ground.value,
        assetGuid(PACKAGE_IDS.materials, 'material/ground'),
        'island-industria:ground',
      ),
      'mesh/cube': withMaterial(
        cube.value,
        assetGuid(PACKAGE_IDS.materials, 'material/cube'),
        'island-industria:cube',
      ),
    });
  },
});
