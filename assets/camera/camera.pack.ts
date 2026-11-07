// 载入 GameHost 的 Context 服务声明（只引入类型，不产生运行时依赖）。
import type {} from '@forgeax/engine/app';
import { Time, Update } from '@forgeax/engine/ecs';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { quat } from '@forgeax/engine/math';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { resolveSceneEntity } from '../shared/scene-refs.ts';
import {
  CAMERA_SYSTEM_NAME,
  DEFAULT_DISTANCE,
  FOCUS_HEIGHT,
  INITIAL_YAW_INDEX,
  YAW_STEP,
  cameraOffset,
  damp,
  dampVec3,
  zoomDistance,
} from './orbit.ts';
import { PLAYER_MOVE_SYSTEM_NAME, PLAYER_STATE_KEY, type PlayerState } from '../player/player.ts';

const SYSTEM_NAME = CAMERA_SYSTEM_NAME;
/** 旋转 / 平移 / 缩放的指数阻尼系数：越大越快跟上目标值。 */
const ROTATE_RATE = 12;
const PAN_RATE = 8;
const ZOOM_RATE = 10;
/** 单帧最大推进时间：标签页被挂起后恢复时避免镜头瞬移。 */
const MAX_STEP_SECONDS = 0.1;

/**
 * 八方向俯视相机：围绕「玩家」旋转（Q/E，45° 一档）和缩放（滚轮），观察中心持续跟随玩家。
 * 俯仰角固定为 CAMERA_PITCH，玩家无法改变仰角；WASD 已交给玩家移动，不再平移相机。
 */
export const topDownCamera: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world', 'gameHost', 'gameScene'],
  apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    // 场景里名为 'camera' 的实体（与 assets/world/scene.pack.ts 对应）
    const camera = resolveSceneEntity(world, ctx.gameScene, 'camera');

    // 目标值（输入直接改这些）与当前值（每帧向目标值阻尼逼近）
    let targetYawIndex = INITIAL_YAW_INDEX;
    let currentYawIndex = INITIAL_YAW_INDEX;
    let targetDistance = DEFAULT_DISTANCE;
    let currentDistance = DEFAULT_DISTANCE;
    let targetFocus: [number, number, number] = [0, FOCUS_HEIGHT, 0];
    let currentFocus: [number, number, number] = [0, FOCUS_HEIGHT, 0];
    let followInitialized = false;

    ctx.effect(function* () {
      // 俯视建造类游戏是光标游戏，不需要指针锁；交给宿主统一处理。
      host?.setPointerLockAllowed?.(false);
      yield () => host?.setPointerLockAllowed?.(true);
      // 玩家移动需要按当前相机朝向计算方向。
      yield ctx.provide('cameraRig', { getYaw: () => currentYawIndex * YAW_STEP });

      world
        .addSystem(Update, {
          name: SYSTEM_NAME,
          // 写 Transform 必须发生在引擎的变换传播之前，否则会晚一帧。
          before: [PROPAGATE_TRANSFORMS_SYSTEM],
          // 玩家移动系统先跑，跟随目标使用本帧最新位置。
          after: [PLAYER_MOVE_SYSTEM_NAME],
          queries: [],
          fn: () => {
            const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
            const deltaSeconds = Math.min(world.getResource(Time).delta, MAX_STEP_SECONDS);
            if (!(deltaSeconds > 0)) return;

            // 1) 八方向旋转：按一次转一格（45°），按住不会连续触发
            if (input.keyboard.justPressedCode('KeyQ')) targetYawIndex -= 1;
            if (input.keyboard.justPressedCode('KeyE')) targetYawIndex += 1;

            // 2) 滚轮缩放：正数 = 向下滚 = 拉远
            const wheel = input.mouse.wheelDelta;
            if (wheel !== 0) targetDistance = zoomDistance(targetDistance, wheel);

            // 3) 观察中心跟随玩家；首次拿到玩家位置时直接对齐，避免开局镜头飞行
            if (world.hasResource(PLAYER_STATE_KEY)) {
              const playerState = world.getResource<PlayerState>(PLAYER_STATE_KEY);
              targetFocus = [
                playerState.position[0],
                playerState.position[1] + FOCUS_HEIGHT,
                playerState.position[2],
              ];
              if (!followInitialized) {
                currentFocus = [...targetFocus];
                followInitialized = true;
              }
            }

            // 4) 平滑逼近目标值
            currentYawIndex = damp(currentYawIndex, targetYawIndex, ROTATE_RATE, deltaSeconds);
            currentDistance = damp(currentDistance, targetDistance, ZOOM_RATE, deltaSeconds);
            currentFocus = dampVec3(currentFocus, targetFocus, PAN_RATE, deltaSeconds);

            // 5) 由「观察中心 + 固定俯仰角偏移」重算相机位姿
            const offset = cameraOffset(currentYawIndex * YAW_STEP, currentDistance);
            const position: [number, number, number] = [
              currentFocus[0] + offset[0],
              currentFocus[1] + offset[1],
              currentFocus[2] + offset[2],
            ];
            const rotation = quat.fromLookAt(quat.create(), position, currentFocus, [0, 1, 0]);
            world
              .set(camera, Transform, {
                pos: position,
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

      yield () => world.removeSystem(Update, SYSTEM_NAME).unwrap();
    }, SYSTEM_NAME);
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.camera,
  name: 'ISLAND INDUSTRIA / Camera',
  plugins: true,
  build: () =>
    ok({
      'plugin/camera': {
        kind: 'plugin',
        module: { specifier: './camera.pack.ts', export: 'topDownCamera' },
      },
    }),
});