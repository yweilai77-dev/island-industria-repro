import type { EntityHandle, World } from '@forgeax/engine/ecs';
import { sceneEntity, worldResolveSceneEntity } from '@forgeax/engine/scene';

/** scene-owner 在场景实例化后提供，其他插件用它把「场景里的名字」解析成实体句柄。 */
export interface GameScene {
  readonly root: EntityHandle;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    gameScene: GameScene;
  }
}

/** 与 assets/world/scene.pack.ts 的 build() 输出键一致。 */
export const SCENE_SOURCE_KEY = 'scene/mvp' as const;

export type SceneEntityKey = 'camera' | 'ground' | 'sun' | 'skylight';

/** 按场景源键 + 实体键解析运行期实体句柄。 */
export function resolveSceneEntity(
  world: World,
  host: GameScene,
  entityKey: SceneEntityKey,
): EntityHandle {
  const resolved = worldResolveSceneEntity(
    world,
    host.root,
    sceneEntity(SCENE_SOURCE_KEY, entityKey),
  );
  if (!resolved.ok) throw resolved.error;
  return resolved.value;
}