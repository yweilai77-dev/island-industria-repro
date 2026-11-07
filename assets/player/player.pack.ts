import { Time, Update } from '@forgeax/engine/ecs';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { quat } from '@forgeax/engine/math';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { ChildOf, PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS, assetGuid, guidText } from '../shared/asset-refs.ts';
import { cellToCenter } from '../grid/grid.ts';
import { BUILD_ADJUSTING_KEY } from '../build/adjustment.ts';
import { blocksPlayerMove } from './occupancy.ts';
import type {} from '../spatial/service.ts';
import {
  FLAT_SWITCH_TOLERANCE,
  resolveWithSliding,
  selectFlatSupport,
} from './vertical.ts';
import {
  PLAYER_MAX_STEP_SECONDS,
  PLAYER_MOVE_SYSTEM_NAME,
  PLAYER_SPEED,
  PLAYER_START_CELL,
  PLAYER_STATE_KEY,
  clampPlayerPosition,
  facingYawFor,
  moveVector,
  type PlayerState,
} from './player.ts';

const BODY_COLOR = [0.15, 0.35, 0.55, 1] as const;
const FRONT_COLOR = [1, 0.86, 0.1, 1] as const;

/**
 * 玩家标记 + 移动：WASD 相对当前相机朝向移动，位置夹在地面内，
 * 朝向跟随移动方向；不含跳跃/奔跑/碰撞/动画。
 */
export const playerMarker: Plugin = {
  name: 'island-industria/player',
  inject: ['world', 'assets', 'cameraRig', 'spatial'],
  async apply(ctx) {
    const world = ctx.world;
    const assets = ctx.assets;
    if (!assets) throw new Error('player marker requires the asset service');
    const cameraRig = ctx.cameraRig;
    const spatial = ctx.spatial;
    const cell = { ...PLAYER_START_CELL };
    const center = cellToCenter(cell);

    await ctx.effect(async function* () {
      const cubeMesh = await assets.load(
        assets.parseGuid(guidText(assetGuid(PACKAGE_IDS.geometry, 'mesh/cube'))),
        'mesh',
      );
      if (!cubeMesh.ok) throw cubeMesh.error;
      const bodyMaterial = assets.create(
        Materials.standard({ baseColor: [...BODY_COLOR], metallic: 0.05, roughness: 0.6 }),
      ).unwrap();
      const frontMaterial = assets.create(Materials.unlit([...FRONT_COLOR])).unwrap();
      yield () => {
        assets.release(bodyMaterial).unwrap();
        assets.release(frontMaterial).unwrap();
        assets.release(cubeMesh.value).unwrap();
      };

      // 父实体：位置在格中心，rotation 0 => 正面朝 -Z
      const root = world
        .spawn({ component: Transform, data: { pos: [center[0], 0, center[2]] } })
        .unwrap();
      yield () => world.despawn(root).unwrap(); // 子实体随 ChildOf 级联销毁

      // 主体：0.62 缩放（约 0.74m 见方）
      world
        .spawn(
          { component: Transform, data: { pos: [0, 0.372, 0], scale: [0.62, 0.62, 0.62] } },
          { component: ChildOf, data: { parent: root } },
          { component: MeshFilter, data: { assetHandle: cubeMesh.value } },
          { component: MeshRenderer, data: { materials: [bodyMaterial] } },
        )
        .unwrap();

      // 正面辨识条：贴在 -Z 面外侧
      world
        .spawn(
          { component: Transform, data: { pos: [0, 0.55, -0.45], scale: [0.22, 0.1, 0.14] } },
          { component: ChildOf, data: { parent: root } },
          { component: MeshFilter, data: { assetHandle: cubeMesh.value } },
          { component: MeshRenderer, data: { materials: [frontMaterial] } },
        )
        .unwrap();

      const initialSupport = selectFlatSupport(
        spatial.supports.supportsAtPoint(center[0], center[2]),
        null,
        0,
        FLAT_SWITCH_TOLERANCE,
      );
      if (!initialSupport) throw new Error('player spawn has no walkable support surface');
      const state: PlayerState = {
        position: [center[0], 0, center[2]],
        level: initialSupport.level,
        supportId: initialSupport.id,
        cell,
        facingYaw: 0,
      };
      world.insertResource(PLAYER_STATE_KEY, state);
      yield () => world.removeResource(PLAYER_STATE_KEY);

      yield ctx.provide('player', { entity: root, cell, facing: 'north', state });

      // ---- 移动系统：WASD 相对相机朝向，夹在地面内 ----
      world
        .addSystem(Update, {
          name: PLAYER_MOVE_SYSTEM_NAME,
          before: [PROPAGATE_TRANSFORMS_SYSTEM],
          queries: [],
          fn: () => {
            const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
            const delta = Math.min(world.getResource(Time).delta, PLAYER_MAX_STEP_SECONDS);
            if (!(delta > 0)) return;
            // 建筑搬动调整期间锁定玩家移动（1 帧延迟可接受）。
            if (world.hasResource(BUILD_ADJUSTING_KEY)) return;

            const forward = (input.keyboard.downCode('KeyW') ? 1 : 0)
              - (input.keyboard.downCode('KeyS') ? 1 : 0);
            const right = (input.keyboard.downCode('KeyD') ? 1 : 0)
              - (input.keyboard.downCode('KeyA') ? 1 : 0);
            if (forward === 0 && right === 0) return;

            const direction = moveVector(cameraRig.getYaw(), forward, right);
            if (direction.length === 0) return;

            const [nextX, nextZ] = clampPlayerPosition(
              state.position[0] + direction.x * PLAYER_SPEED * delta,
              state.position[2] + direction.z * PLAYER_SPEED * delta,
            );
            if (nextX === state.position[0] && nextZ === state.position[2]) return;

            // 完整事务：full → X-only → Z-only 都从原始状态重新解析。
            const result = resolveWithSliding(
              {
                x: state.position[0],
                feetY: state.position[1],
                z: state.position[2],
                level: state.level,
                supportId: state.supportId,
              },
              nextX,
              nextZ,
              {
                supports: spatial.supports,
                traversals: spatial.traversals,
                isBlockedMove: (fromX, fromZ, toX, toZ, yMin, yMax) => {
                  for (const collider of spatial.structures.all()) {
                    if (!collider.blocksPlayer) continue;
                    if (blocksPlayerMove(collider.aabb, fromX, fromZ, toX, toZ, yMin, yMax)) {
                      return true;
                    }
                  }
                  return false;
                },
              },
            );
            if (!result.moved) return;

            state.position[0] = result.position[0];
            state.position[1] = result.position[1];
            state.position[2] = result.position[2];
            state.level = result.level;
            state.supportId = result.supportId;
            if (result.cell.gx !== cell.gx || result.cell.gz !== cell.gz) {
              cell.gx = result.cell.gx;
              cell.gz = result.cell.gz;
            }
            state.facingYaw = facingYawFor(direction.x, direction.z);
            const rotation = quat.fromAxisAngle(quat.create(), [0, 1, 0], state.facingYaw);
            world
              .set(root, Transform, {
                pos: [result.position[0], result.position[1], result.position[2]],
                quat: [
                  rotation[0] ?? 0,
                  rotation[1] ?? 0,
                  rotation[2] ?? 0,
                  rotation[3] ?? 1,
                ],
              })
              .unwrap();
          },
        })
        .unwrap();
      yield () => world.removeSystem(Update, PLAYER_MOVE_SYSTEM_NAME).unwrap();
    }, 'island-industria/player');
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.player,
  name: 'ISLAND INDUSTRIA / Player',
  plugins: true,
  build: () =>
    ok({
      'plugin/player': {
        kind: 'plugin',
        module: { specifier: './player.pack.ts', export: 'playerMarker' },
      },
    }),
});