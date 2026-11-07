import { createBoxGeometry } from '@forgeax/engine/geometry';
import { definePack } from '@forgeax/engine/pack/source';
import type { AssetGuid, MeshAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { assetGuid, PACKAGE_IDS } from '../shared/asset-refs.ts';
import { EDGE_TRIM, MAP_CONFIG } from './map-config.ts';

/** 给网格绑一个默认材质槽：MeshRenderer 不显式给材质时就用它。 */
function withMaterial(mesh: MeshAsset, material: AssetGuid, sourceKey: string): MeshAsset {
  return {
    ...mesh,
    materialSlots: [{ slotName: 'surface', sourceKey, defaultMaterial: material }],
  };
}

/**
 * MVP 0.1 的几何体包：地面（扁平长方体）、立方体与 M1.6 地图边缘包边。
 * 几何体在构建期由引擎工厂生成，不提交二进制模型文件。
 * M1.6：地面尺寸与包边尺寸全部来自 MapConfig，不再写死 20×20。
 */
export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.geometry,
  name: 'ISLAND INDUSTRIA / Geometry',
  build: () => {
    const ground = createBoxGeometry(
      MAP_CONFIG.groundSizeX,
      MAP_CONFIG.groundThickness,
      MAP_CONFIG.groundSizeZ,
    );
    if (!ground.ok) return ground;

    const cube = createBoxGeometry(1.2, 1.2, 1.2);
    if (!cube.ok) return cube;

    // 包边：四段只做视觉提示，不进入 SpatialIndex / SupportRegistry。
    const edgeHeight = MAP_CONFIG.groundThickness + EDGE_TRIM.aboveGround;
    const edgeX = createBoxGeometry(
      MAP_CONFIG.groundSizeX + EDGE_TRIM.thickness,
      edgeHeight,
      EDGE_TRIM.thickness,
    );
    if (!edgeX.ok) return edgeX;
    const edgeZ = createBoxGeometry(
      EDGE_TRIM.thickness,
      edgeHeight,
      MAP_CONFIG.groundSizeZ + EDGE_TRIM.thickness,
    );
    if (!edgeZ.ok) return edgeZ;

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
      'mesh/edge-x': withMaterial(
        edgeX.value,
        assetGuid(PACKAGE_IDS.materials, 'material/edge'),
        'island-industria:edge',
      ),
      'mesh/edge-z': withMaterial(
        edgeZ.value,
        assetGuid(PACKAGE_IDS.materials, 'material/edge'),
        'island-industria:edge',
      ),
    });
  },
});
