import { createBoxGeometry } from '@forgeax/engine/geometry';
import { quat } from '@forgeax/engine/math';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { ChildOf, Transform } from '@forgeax/engine/scene';
import type { EntityHandle } from '@forgeax/engine/ecs';
import type { AssetHandle } from '@forgeax/engine/types';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { SEGMENT_RECTS, digitSegments } from '../hud/hud.ts';

/**
 * M1.7-C 最小机械状态可视化：选中/悬停零件的世界空间 3D 读数牌。
 *
 * 只读消费 MechanicalRuntimeState，不写 Registry / SpatialIndex / Inventory：
 * - 3 位数字显示该零件当前转速（RPM，取绝对值）；
 * - 背板颜色表达网络状态：绿=满速、琥珀=负载减速、红=停转、灰=无动力/不支持；
 * - 读数牌始终朝向相机（yaw 对准相机），保证截图可读。
 */

const HIDDEN_Y = -1000;
const DIGIT_SCALE = 0.34;
const DIGIT_SPACING = 0.24;
/** 读数牌相对零件顶部的高度偏移。 */
const LIFT = 0.78;
const PANEL_Z = -0.01;
const SEGMENT_Z = 0.02;
const UP: readonly [number, number, number] = [0, 1, 0];

export type ReadoutStatus = 'running' | 'slowed' | 'stalled' | 'idle';

interface DigitHud {
  readonly segments: readonly EntityHandle[];
  readonly bases: readonly { readonly pos: readonly [number, number, number]; readonly scale: readonly [number, number, number] }[];
}

export interface MechanicalReadout {
  update(
    target: { readonly x: number; readonly y: number; readonly z: number; readonly omega: number; readonly status: ReadoutStatus } | undefined,
    cameraPosition: readonly [number, number, number] | undefined,
  ): void;
  dispose(): void;
}

export function createMechanicalReadout(
  world: any,
  assets: AssetRegistry,
  camera: EntityHandle | undefined,
): MechanicalReadout {
  const boxMesh = assets.create(createBoxGeometry(1, 1, 1).unwrap()).unwrap();
  const plateMaterial = assets.create(Materials.unlit([0.08, 0.1, 0.12, 0.92])).unwrap();
  const runningMaterial = assets.create(Materials.unlit([0.24, 0.8, 0.42, 1])).unwrap();
  const slowedMaterial = assets.create(Materials.unlit([0.92, 0.62, 0.18, 1])).unwrap();
  const stalledMaterial = assets.create(Materials.unlit([0.9, 0.24, 0.2, 1])).unwrap();
  const idleMaterial = assets.create(Materials.unlit([0.5, 0.55, 0.6, 1])).unwrap();
  const digitMaterial = assets.create(Materials.unlit([0.95, 0.97, 1, 1])).unwrap();

  const panelRoot = world.spawn({ component: Transform, data: { pos: [0, HIDDEN_Y, 0] } }).unwrap();
  const plate = world
    .spawn(
      { component: Transform, data: { pos: [0, 0, PANEL_Z], scale: [0.78, 0.46, 0.03] } },
      { component: ChildOf, data: { parent: panelRoot } },
      { component: MeshFilter, data: { assetHandle: boxMesh } },
      { component: MeshRenderer, data: { materials: [plateMaterial] } },
    )
    .unwrap();

  const spawnDigit = (offsetX: number): DigitHud => {
    const segments: EntityHandle[] = [];
    const bases: { pos: [number, number, number]; scale: [number, number, number] }[] = [];
    for (const rect of SEGMENT_RECTS) {
      const pos: [number, number, number] = [
        offsetX + rect.x * DIGIT_SCALE,
        rect.y * DIGIT_SCALE,
        SEGMENT_Z,
      ];
      const scale: [number, number, number] = [rect.w * DIGIT_SCALE, rect.h * DIGIT_SCALE, 0.02];
      bases.push({ pos, scale });
      segments.push(
        world
          .spawn(
            { component: Transform, data: { pos, scale, quat: [0, 0, 0, 1] } },
            { component: ChildOf, data: { parent: panelRoot } },
            { component: MeshFilter, data: { assetHandle: boxMesh } },
            { component: MeshRenderer, data: { materials: [digitMaterial] } },
          )
          .unwrap(),
      );
    }
    return { segments, bases };
  };

  const digits: DigitHud[] = [spawnDigit(-DIGIT_SPACING), spawnDigit(0), spawnDigit(DIGIT_SPACING)];
  let visible = false;
  let lastStatus: ReadoutStatus | null = null;

  const setDigit = (digit: DigitHud, active: readonly number[]): void => {
    for (let index = 0; index < digit.segments.length; index += 1) {
      const base = digit.bases[index]!;
      const shown = active.includes(index);
      const entity = digit.segments[index]!;
      world
        .set(entity, Transform, {
          pos: shown ? [base.pos[0], base.pos[1], base.pos[2]] : [base.pos[0], base.pos[1] + HIDDEN_Y, base.pos[2]],
          scale: [base.scale[0], base.scale[1], base.scale[2]],
          quat: [0, 0, 0, 1],
        })
        .unwrap();
    }
  };

  const clearDigits = (): void => {
    for (const digit of digits) setDigit(digit, []);
  };

  const renderValue = (rpm: number): void => {
    const value = Math.max(0, Math.min(999, Math.round(Number.isFinite(rpm) ? rpm : 0)));
    const text = String(value).padStart(3, '0');
    for (let slot = 0; slot < 3; slot += 1) {
      const char = text.charAt(slot);
      const digit = digits[slot]!;
      // 前导零不显示，只保留有效数字位。
      setDigit(digit, slot < 3 - String(value).length ? [] : digitSegments(Number(char)));
    }
  };

  const materialFor = (status: ReadoutStatus): AssetHandle<'material'> => {
    switch (status) {
      case 'running': return runningMaterial;
      case 'slowed': return slowedMaterial;
      case 'stalled': return stalledMaterial;
      default: return idleMaterial;
    }
  };

  return {
    update(target, cameraPosition) {
      if (!target) {
        if (visible) {
          visible = false;
          world.set(panelRoot, Transform, { pos: [0, HIDDEN_Y, 0], scale: [1, 1, 1], quat: [0, 0, 0, 1] }).unwrap();
          clearDigits();
        }
        return;
      }
      visible = true;
      // 完整朝向：眼睛放在相机上、看向零件位置，再把牌面翻到朝相机一侧，
      // 这样读数牌会同时跟随水平方位和俯仰角，顶视相机下也不会被压扁。
      const position: [number, number, number] = [target.x, target.y + LIFT, target.z];
      const look = cameraPosition
        ? quat.fromLookAt(
          quat.create(),
          cameraPosition as unknown as readonly [number, number, number],
          position,
          UP,
        )
        : quat.create();
      const flip = quat.fromAxisAngle(quat.create(), [0, 1, 0], Math.PI);
      const oriented = quat.multiply(quat.create(), look, flip);
      world
        .set(panelRoot, Transform, {
          pos: position,
          scale: [1, 1, 1],
          quat: [oriented[0] ?? 0, oriented[1] ?? 0, oriented[2] ?? 0, oriented[3] ?? 1],
        })
        .unwrap();
      renderValue(Math.abs(target.omega) * 60 / (Math.PI * 2));
      if (target.status !== lastStatus) {
        lastStatus = target.status;
        world.set(plate, MeshRenderer, { materials: [materialFor(target.status)] }).unwrap();
      }
    },
    dispose() {
      world.despawn(panelRoot).unwrap();
      for (const handle of [
        boxMesh, plateMaterial, runningMaterial, slowedMaterial, stalledMaterial, idleMaterial, digitMaterial,
      ]) {
        assets.release(handle).unwrap();
      }
    },
  };
}
