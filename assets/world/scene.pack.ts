import { quat } from '@forgeax/engine/math';
import { definePack } from '@forgeax/engine/pack/source';
import {
  ANTIALIAS_FXAA,
  Camera,
  DirectionalLight,
  MeshFilter,
  MeshRenderer,
  perspective,
  Skylight,
  TONEMAP_ACES_FILMIC,
} from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import type { AssetGuid, SceneAsset, SceneEntity } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { assetGuid, guidText, PACKAGE_IDS } from '../shared/asset-refs.ts';

const DEG = Math.PI / 180;

/** 摄像机位置与注视点：站在场景斜上方，看向立方体。 */
const CAMERA_POSITION = [4.2, 2.6, 4.2] as const;
const CAMERA_TARGET = [0, 0.65, 0] as const;

/** 太阳光的「出射方向」：从光源指向场景，所以 y 为负。 */
const SUN_DIRECTION = [-0.86, -0.58, -0.2] as const;

function meshEntity(
  key: string,
  name: string,
  mesh: AssetGuid,
  position: readonly [number, number, number],
  rotation: readonly [number, number, number, number] = [0, 0, 0, 1],
): readonly [string, SceneEntity] {
  return [
    key,
    {
      components: {
        Name: { value: name },
        Transform: { pos: position, quat: rotation },
        MeshFilter: { assetHandle: guidText(mesh) },
        MeshRenderer: { materials: [] },
      },
    },
  ];
}

function mvpScene(): SceneAsset {
  const cameraRotation = quat.fromLookAt(quat.create(), CAMERA_POSITION, CAMERA_TARGET, [0, 1, 0]);

  return {
    kind: 'scene',
    entities: Object.fromEntries([
      // 地面：扁平长方体，顶面在 y = 0
      meshEntity('ground', 'Ground', assetGuid(PACKAGE_IDS.geometry, 'mesh/ground'), [0, -0.1, 0]),
      // 太阳：一个方向光，负责主光与阴影
      [
        'sun',
        {
          components: {
            Name: { value: 'Sun' },
            DirectionalLight: {
              direction: SUN_DIRECTION,
              color: [1, 0.96, 0.88],
              intensity: 3.2,
              castShadow: true,
              shadowDistance: 40,
            },
          },
        },
      ],
      // 环境补光：没有它，背光面会全黑
      [
        'skylight',
        {
          components: {
            Name: { value: 'Skylight' },
            Skylight: {
              color: [0.45, 0.58, 0.85],
              groundColor: [0.1, 0.09, 0.085],
              intensity: 0.22,
            },
          },
        },
      ],
      // 主摄像机：fov 为竖直视场角（弧度），透视投影
      [
        'camera',
        {
          components: {
            Name: { value: 'Main Camera' },
            Transform: {
              pos: CAMERA_POSITION,
              quat: [
                cameraRotation[0] ?? 0,
                cameraRotation[1] ?? 0,
                cameraRotation[2] ?? 0,
                cameraRotation[3] ?? 1,
              ],
            },
            Camera: {
              ...perspective({ fov: 50 * DEG, aspect: 16 / 9 }),
              tonemap: TONEMAP_ACES_FILMIC,
              exposure: 1.0,
              antialias: ANTIALIAS_FXAA,
              clearColor: [0.07, 0.09, 0.12, 1],
            },
          },
        },
      ],
    ]),
  };
}

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.scene,
  name: 'ISLAND INDUSTRIA / Scene',
  // 场景里用到的组件必须在这里声明，构建器据此校验实体组件字段
  sceneComponents: [Camera, DirectionalLight, MeshFilter, MeshRenderer, Name, Skylight, Transform],
  build: () => ok({ 'scene/mvp': mvpScene() }),
});