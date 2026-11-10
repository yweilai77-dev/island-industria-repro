// 载入 ExecutionBootstrapHost 的 Context 服务声明（只引入类型，不产生运行时依赖）。
import type {} from '@forgeax/engine/app';
import { Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { createBoxGeometry } from '@forgeax/engine/geometry';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { ChildOf, PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import { ok, type AssetHandle } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { ITEM_IDS } from '../items/items.ts';
import { resolveSceneEntity } from '../shared/scene-refs.ts';
import { placementCenter } from '../grid/grid.ts';
import { PLAYER_STATE_KEY, PLAYER_MOVE_SYSTEM_NAME, type PlayerState } from '../player/player.ts';
import { CAMERA_SYSTEM_NAME } from '../camera/orbit.ts';
import { BUILD_ADJUSTING_KEY } from '../build/adjustment.ts';
import {
  DEPLETED_SEGMENTS,
  LETTER_F_SEGMENTS,
  PLUS_RECTS,
  SEGMENT_RECTS,
  digitSegments,
  splitDigits,
} from '../hud/hud.ts';
import {
  HARVEST_RANGE,
  HARVEST_YIELD,
  advanceHarvest,
  awardHarvest,
  createHarvestState,
  distanceToNodeAabb,
  findHarvestTarget,
  startHarvest,
} from './harvest.ts';

const SYSTEM_NAME = 'island-industria/harvest';
const HIDDEN_Y = -1000;
const MAX_STEP_SECONDS = 0.1;
const TOAST_DURATION = 1.2;
const DEPLETED_DURATION = 2.5;
const PROMPT_HEIGHT = 1.6;
const PROGRESS_HEIGHT = 1.15;
const TOAST_HEIGHT = 1.9;

const DARK_COLOR = [0.05, 0.05, 0.06, 1] as const;
const YELLOW_COLOR = [1, 0.84, 0.18, 1] as const;
const GREEN_COLOR = [0.3, 0.9, 0.45, 1] as const;
const GREY_COLOR = [0.42, 0.42, 0.46, 1] as const;
const WHITE_COLOR = [0.9, 0.95, 1, 1] as const;
const ORE_COLOR = [0.85, 0.35, 0.08, 1] as const;

interface DigitHud {
  readonly segments: readonly EntityHandle[];
  readonly bases: readonly {
    readonly pos: [number, number, number];
    readonly scale: [number, number, number];
  }[];
}

/**
 * 铁矿石采集 + 3D 方块字形 HUD：
 * - 靠近矿点显示 F 提示；按 F 开始 3 秒采集，离开范围取消；
 * - 进度条、+1 提示、枯竭提示、铁矿石总数均用方块实体绘制（Worker 无 DOM）。
 */
export const ironHarvest: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world', 'assets', 'gameScene', 'resourceNodes', 'inventory'],
  apply(ctx) {
    const world = ctx.world;
    const assets = ctx.assets;
    if (!assets) throw new Error('harvest system requires the asset service');
    const camera = resolveSceneEntity(world, ctx.gameScene, 'camera');
    const resourceNodes = ctx.resourceNodes;
    const inventory = ctx.inventory;

    ctx.effect(function* () {
      const boxMesh = assets.create(createBoxGeometry(1, 1, 1).unwrap()).unwrap();
      const darkMaterial = assets.create(Materials.unlit([...DARK_COLOR])).unwrap();
      const yellowMaterial = assets.create(Materials.unlit([...YELLOW_COLOR])).unwrap();
      const greenMaterial = assets.create(Materials.unlit([...GREEN_COLOR])).unwrap();
      const greyMaterial = assets.create(Materials.unlit([...GREY_COLOR])).unwrap();
      const whiteMaterial = assets.create(Materials.unlit([...WHITE_COLOR])).unwrap();
      const oreMaterial = assets.create(Materials.unlit([...ORE_COLOR])).unwrap();
      yield () => {
        for (const handle of [
          boxMesh, darkMaterial, yellowMaterial, greenMaterial, greyMaterial, whiteMaterial, oreMaterial,
        ]) {
          assets.release(handle).unwrap();
        }
      };

      const spawnBox = (
        parent: EntityHandle,
        material: AssetHandle<'material'>,
        pos: readonly [number, number, number],
        scale: readonly [number, number, number],
      ): EntityHandle =>
        world
          .spawn(
            { component: Transform, data: { pos, scale } },
            { component: ChildOf, data: { parent } },
            { component: MeshFilter, data: { assetHandle: boxMesh } },
            { component: MeshRenderer, data: { materials: [material] } },
          )
          .unwrap();

      const createRoot = (): EntityHandle =>
        world.spawn({ component: Transform, data: { pos: [0, HIDDEN_Y, 0] } }).unwrap();

      const createDigit = (
        parent: EntityHandle,
        material: AssetHandle<'material'>,
        scale: number,
        offset: readonly [number, number, number],
      ): DigitHud => {
        const segments: EntityHandle[] = [];
        const bases: DigitHud['bases'][number][] = [];
        for (const rect of SEGMENT_RECTS) {
          const pos: [number, number, number] = [
            offset[0] + rect.x * scale,
            offset[1] + rect.y * scale,
            offset[2],
          ];
          const size: [number, number, number] = [rect.w * scale, rect.h * scale, 0.02];
          bases.push({ pos, scale: size });
          segments.push(spawnBox(parent, material, pos, size));
        }
        return { segments, bases };
      };

      const setDigit = (digit: DigitHud, active: readonly number[]): void => {
        for (let index = 0; index < digit.segments.length; index += 1) {
          const base = digit.bases[index]!;
          const visible = active.includes(index);
          const entity = digit.segments[index]!;
          world
            .set(entity, Transform, {
              pos: visible ? base.pos : [base.pos[0], base.pos[1] + HIDDEN_Y, base.pos[2]],
              scale: base.scale,
            })
            .unwrap();
        }
      };

      const setRootVisible = (
        root: EntityHandle,
        visible: boolean,
        pos: readonly [number, number, number] = [0, 0, 0],
        quat: readonly [number, number, number, number] = [0, 0, 0, 1],
        scale = 1,
      ): void => {
        world
          .set(root, Transform, {
            pos: visible ? [pos[0], pos[1], pos[2]] : [0, HIDDEN_Y, 0],
            quat: [quat[0], quat[1], quat[2], quat[3]],
            scale: [scale, scale, scale],
          })
          .unwrap();
      };

      // ---- F 提示 ----
      const promptRoot = createRoot();
      spawnBox(promptRoot, darkMaterial, [0, 0, 0], [0.42, 0.42, 0.06]);
      const promptF = createDigit(promptRoot, yellowMaterial, 0.24, [0, 0, 0.05]);
      setDigit(promptF, LETTER_F_SEGMENTS);

      // ---- 进度条 ----
      const progressRoot = createRoot();
      spawnBox(progressRoot, darkMaterial, [0, 0, 0], [0.9, 0.12, 0.02]);
      const progressFill = spawnBox(progressRoot, greenMaterial, [0, 0, 0.02], [0.002, 0.07, 0.03]);

      // ---- 获得资源 “+1” ----
      const toastRoot = createRoot();
      spawnBox(toastRoot, yellowMaterial, [-0.2, 0, 0.02], [PLUS_RECTS[0]!.w * 0.9, PLUS_RECTS[0]!.h * 0.9, 0.02]);
      spawnBox(toastRoot, yellowMaterial, [-0.2, 0, 0.02], [PLUS_RECTS[1]!.w * 0.9, PLUS_RECTS[1]!.h * 0.9, 0.02]);
      const toastOne = createDigit(toastRoot, yellowMaterial, 0.3, [0.22, 0, 0.02]);
      setDigit(toastOne, digitSegments(1));

      // ---- 枯竭提示 “0” ----
      const depletedRoot = createRoot();
      const depletedDigit = createDigit(depletedRoot, greyMaterial, 0.3, [0, 0, 0]);
      setDigit(depletedDigit, DEPLETED_SEGMENTS);

      // ---- 铁矿石总数（相机子节点，固定在画面左上） ----
      const inventoryRoot = world
        .spawn(
          { component: Transform, data: { pos: [-0.52, 0.3, -0.95] } },
          { component: ChildOf, data: { parent: camera } },
        )
        .unwrap();
      spawnBox(inventoryRoot, oreMaterial, [-0.18, 0, 0], [0.05, 0.05, 0.02]);
      // P2-E3 平衡：铁矿总供给从 80 提高到 240，玩家身上矿石可能超过 99，
      // 因此计数从两位扩展到三位（0–999）。这是资源平衡必需的兼容修复。
      const hundredsDigit = createDigit(inventoryRoot, whiteMaterial, 0.07, [-0.1, 0, 0]);
      const tensDigit = createDigit(inventoryRoot, whiteMaterial, 0.07, [-0.02, 0, 0]);
      const onesDigit = createDigit(inventoryRoot, whiteMaterial, 0.07, [0.06, 0, 0]);

      yield () => {
        for (const root of [promptRoot, progressRoot, toastRoot, depletedRoot, inventoryRoot]) {
          world.despawn(root).unwrap();
        }
      };

      const state = createHarvestState();
      // 采集输入排队：一次采集需要 3 s，玩家/验收脚本经常在前一次还没完成时又按 F。
      // 以前这种按键会被直接忽略（一次输入凭空消失），是「按 N 次只得到 N-1~N-2 个矿」的根因。
      // 现在把「进行中按 F」记为一次待办：当前采集一完成就立刻开始下一次（不额外产出、不自动连采）。
      let queuedHarvest = false;
      let elapsedTotal = 0;
      let toastTimer = 0;
      let toastBase: [number, number, number] = [0, 0, 0];
      let depletedTimer = 0;
      let depletedBase: [number, number, number] = [0, 0, 0];
      let lastInventory = -1;

      world
        .addSystem(Update, {
          name: SYSTEM_NAME,
          before: [PROPAGATE_TRANSFORMS_SYSTEM],
          after: [PLAYER_MOVE_SYSTEM_NAME, CAMERA_SYSTEM_NAME],
          queries: [],
          fn: () => {
            const delta = Math.min(world.getResource(Time).delta, MAX_STEP_SECONDS);
            if (!(delta > 0)) return;
            elapsedTotal += delta;
            const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
            const playerState = world.getResource<PlayerState>(PLAYER_STATE_KEY);
            const px = playerState.position[0];
            const pz = playerState.position[2];
            const cameraTransform = world.get(camera, Transform).unwrap();
            const rawQuat = cameraTransform.quat;
            const camQuat: [number, number, number, number] = [
              rawQuat?.[0] ?? 0,
              rawQuat?.[1] ?? 0,
              rawQuat?.[2] ?? 0,
              rawQuat?.[3] ?? 1,
            ];

            // ---- 铁矿石总数数字（唯一来源：库存服务） ----
            const total = inventory.count(ITEM_IDS.IRON_ORE);
            if (total !== lastInventory) {
              lastInventory = total;
              // 三位显示：<10 只显示个位；<100 显示十位+个位；>=100 显示三位（上限 999）。
              const capped = Math.min(Math.max(0, Math.floor(total)), 999);
              const digits = splitDigits(capped, 3);
              setDigit(hundredsDigit, capped >= 100 ? digitSegments(digits[0] ?? 0) : []);
              setDigit(tensDigit, capped >= 10 ? digitSegments(digits[1] ?? 0) : []);
              setDigit(onesDigit, digitSegments(digits[2] ?? 0));
            }

            // 建筑搬动期间：隐藏交互提示，取消进行中的采集，禁止开始新采集。
            if (world.hasResource(BUILD_ADJUSTING_KEY)) {
              setRootVisible(promptRoot, false);
              setRootVisible(progressRoot, false);
              if (state.nodeId !== null) advanceHarvest(state, 0, false, true);
              return;
            }

            // ---- 漂浮动画 ----
            if (toastTimer > 0) {
              toastTimer = Math.max(0, toastTimer - delta);
              const progress = 1 - toastTimer / TOAST_DURATION;
              const scale = 0.95 - 0.35 * progress;
              setRootVisible(
                toastRoot,
                toastTimer > 0,
                [toastBase[0], toastBase[1] + 0.6 * progress, toastBase[2]],
                camQuat,
                scale,
              );
            }
            if (depletedTimer > 0) {
              depletedTimer = Math.max(0, depletedTimer - delta);
              setRootVisible(depletedRoot, depletedTimer > 0, depletedBase, camQuat);
            }

            const nodes = resourceNodes.nodes;

            // ---- 采集状态机 ----
            if (state.nodeId === null) {
              setRootVisible(progressRoot, false);
              const target = findHarvestTarget(px, pz, nodes);
              if (target !== undefined) {
                const center = placementCenter({ gx: target.gx, gz: target.gz, w: target.w, d: target.d, rotation: 0, level: 0 });
                const bob = Math.sin(elapsedTotal * 3) * 0.05;
                setRootVisible(promptRoot, true, [center[0], PROMPT_HEIGHT + bob, center[2]], camQuat);
                if (input.keyboard.justPressedCode('KeyF')) {
                  startHarvest(state, target.id);
                  queuedHarvest = false;
                  setRootVisible(promptRoot, false);
                }
              } else {
                setRootVisible(promptRoot, false);
              }
            } else {
              setRootVisible(promptRoot, false);
              const locked = nodes.find((node) => node.id === state.nodeId);
              const alive = locked !== undefined && !locked.depleted && locked.amount > 0;
              const inRange = alive && distanceToNodeAabb(px, pz, locked) <= HARVEST_RANGE;
              // 进行中再按 F：排队一次（不是丢弃、也不是无限连采）。
              if (input.keyboard.justPressedCode('KeyF')) queuedHarvest = true;
              const tick = advanceHarvest(state, delta, inRange, alive);
              if (tick.status === 'cancelled') queuedHarvest = false;

              if (locked !== undefined) {
                const center = placementCenter({ gx: locked.gx, gz: locked.gz, w: locked.w, d: locked.d, rotation: 0, level: 0 });
                if (tick.status === 'progress') {
                  setRootVisible(progressRoot, true, [center[0], PROGRESS_HEIGHT, center[2]], camQuat);
                  const width = Math.max(0.002, 0.9 * tick.progress);
                  world
                    .set(progressFill, Transform, {
                      pos: [-0.45 + width / 2, 0, 0.02],
                      scale: [width, 0.07, 0.03],
                    })
                    .unwrap();
                } else {
                  setRootVisible(progressRoot, false);
                }

                if (tick.status === 'completed') {
                  const nodeId = locked.id;
                  const result = resourceNodes.harvest(nodeId, HARVEST_YIELD);
                  // 只有真正扣除了矿点储量才发放物品，且一次完成事件只走这里一次。
                  if (result !== undefined && result.deducted > 0) {
                    awardHarvest(inventory, result);
                    toastTimer = TOAST_DURATION;
                    toastBase = [center[0], TOAST_HEIGHT, center[2]];
                    if (result.remaining === 0) {
                      depletedTimer = DEPLETED_DURATION;
                      depletedBase = [center[0], 1.45, center[2]];
                    }
                  }
                  // 排队的那一次立刻开始（仍需站在原地、节点仍有储量）。
                  if (queuedHarvest) {
                    queuedHarvest = false;
                    if (inRange && (result?.remaining ?? 0) > 0) startHarvest(state, nodeId);
                  }
                } else if (tick.status === 'cancelled') {
                  queuedHarvest = false;
                }
              } else {
                setRootVisible(progressRoot, false);
                queuedHarvest = false;
              }
            }
          },
        })
        .unwrap();
      yield () => world.removeSystem(Update, SYSTEM_NAME).unwrap();
    }, SYSTEM_NAME);
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.harvest,
  name: 'ISLAND INDUSTRIA / Harvest',
  plugins: true,
  build: () =>
    ok({
      'plugin/harvest': {
        kind: 'plugin',
        module: { specifier: './harvest.pack.ts', export: 'ironHarvest' },
      },
    }),
});