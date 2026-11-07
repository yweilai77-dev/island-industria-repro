import { createBoxGeometry } from '@forgeax/engine/geometry';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { ChildOf, Transform } from '@forgeax/engine/scene';
import type { EntityHandle } from '@forgeax/engine/ecs';
import type { AssetHandle } from '@forgeax/engine/types';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { SEGMENT_RECTS, digitSegments } from '../hud/hud.ts';

/**
 * M1.7-C 最小机械状态可视化：相机锚定的 3D 数字读数。
 *
 * 与 harvest 的资源计数同款（Box 实体拼 7 段数码管，不依赖 DOM）：
 * - 3 位数字显示选中/悬停零件的当前转速（RPM，取绝对值）；
 * - 数字颜色表达网络状态：绿=满速、琥珀=负载减速、红=停转、灰=无动力/不支持；
 * - 只读消费 MechanicalRuntimeState，不写 Registry / SpatialIndex / Inventory。
 */

const HIDDEN_POS: readonly [number, number, number] = [0, -1000, 0];
/** 相机局部坐标：右上角，避开左上角资源计数与底部快捷栏。 */
const PANEL_POS: readonly [number, number, number] = [0.54, 0.26, -0.95];
const DIGIT_SCALE = 0.075;
const DIGIT_SPACING = 0.058;
const SEGMENT_Z = 0.02;

export type ReadoutStatus = 'running' | 'slowed' | 'stalled' | 'idle';

interface DigitHud {
  readonly segments: readonly EntityHandle[];
  readonly bases: readonly { readonly pos: readonly [number, number, number]; readonly scale: readonly [number, number, number] }[];
}

export interface MechanicalReadout {
  update(
    target: { readonly omega: number; readonly status: ReadoutStatus } | undefined,
  ): void;
  dispose(): void;
}

export function createMechanicalReadout(
  world: any,
  assets: AssetRegistry,
  camera: EntityHandle,
): MechanicalReadout {
  const boxMesh = assets.create(createBoxGeometry(1, 1, 1).unwrap()).unwrap();
  const runningMaterial = assets.create(Materials.unlit([0.35, 0.95, 0.5, 1])).unwrap();
  const slowedMaterial = assets.create(Materials.unlit([1, 0.72, 0.2, 1])).unwrap();
  const stalledMaterial = assets.create(Materials.unlit([1, 0.32, 0.26, 1])).unwrap();
  const idleMaterial = assets.create(Materials.unlit([0.62, 0.66, 0.7, 1])).unwrap();

  const root = world
    .spawn(
      { component: Transform, data: { pos: HIDDEN_POS as unknown as [number, number, number], scale: [1, 1, 1] } },
      { component: ChildOf, data: { parent: camera } },
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
            { component: ChildOf, data: { parent: root } },
            { component: MeshFilter, data: { assetHandle: boxMesh } },
            { component: MeshRenderer, data: { materials: [idleMaterial] } },
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
      world
        .set(digit.segments[index]!, Transform, {
          pos: shown ? [base.pos[0], base.pos[1], base.pos[2]] : [base.pos[0], base.pos[1] + HIDDEN_POS[1], base.pos[2]],
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
      // 前导零不显示，只保留有效数字位。
      if (slot < 3 - String(value).length) {
        setDigit(digits[slot]!, []);
      } else {
        setDigit(digits[slot]!, digitSegments(Number(text.charAt(slot))));
      }
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

  const setRootVisible = (next: boolean): void => {
    if (visible === next) return;
    visible = next;
    world
      .set(root, Transform, {
        pos: next ? [PANEL_POS[0], PANEL_POS[1], PANEL_POS[2]] : [HIDDEN_POS[0], HIDDEN_POS[1], HIDDEN_POS[2]],
        scale: [1, 1, 1],
        quat: [0, 0, 0, 1],
      })
      .unwrap();
  };

  return {
    update(target) {
      if (!target) {
        clearDigits();
        setRootVisible(false);
        return;
      }
      setRootVisible(true);
      renderValue(Math.abs(target.omega) * 60 / (Math.PI * 2));
      if (target.status !== lastStatus) {
        lastStatus = target.status;
        const material = materialFor(target.status);
        for (const digit of digits) {
          for (const entity of digit.segments) {
            world.set(entity, MeshRenderer, { materials: [material] }).unwrap();
          }
        }
      }
    },
    dispose() {
      world.despawn(root).unwrap();
      for (const handle of [boxMesh, runningMaterial, slowedMaterial, stalledMaterial, idleMaterial]) {
        assets.release(handle).unwrap();
      }
    },
  };
}
