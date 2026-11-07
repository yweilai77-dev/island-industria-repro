import { createBoxGeometry } from '@forgeax/engine/geometry';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { ChildOf, Transform } from '@forgeax/engine/scene';
import type { EntityHandle } from '@forgeax/engine/ecs';
import type { AssetHandle } from '@forgeax/engine/types';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { SEGMENT_RECTS, digitSegments } from '../hud/hud.ts';
import {
  STATUS_TEXT,
  type ReadoutStatus,
  type ReadoutTarget,
} from './readout-status.ts';

/**
 * M1.7-C 机械状态读数（相机锚定，Box 实体拼装，不依赖 DOM）。
 *
 * 只显示当前选中/悬停零件，数值全部来自 MechanicalRuntimeState 的解算结果：
 *   第一行  <RPM 数字> RPM
 *   第二行  <负载> / <承载> N·M   （负载无解算数据时显示 —）
 *   第三行  状态文字
 *
 * 颜色：绿=正常运行、琥珀=负载减速、红=过载停止、灰=关闭/无动力、紫=不支持（含闭环）。
 * 数字沿用七段数码管风格，文字使用 5×5 点阵。
 */

const HIDDEN_POS: readonly [number, number, number] = [0, -1000, 0];
/** 面板锚点（相机局部坐标）：右上区域，避开左上资源计数与底部快捷栏。 */
const PANEL_ANCHOR: readonly [number, number, number] = [-0.34, 0.30, -0.95];
const DIGIT_SCALE = 0.06;
const DIGIT_STEP = 0.045;
const UNIT_CELL = 0.012;
const STATUS_CELL = 0.009;
const ROW_STEP = 0.075;
const SEGMENT_Z = 0.02;

const NUM_X: readonly [number, number, number] = [0, DIGIT_STEP, DIGIT_STEP * 2];
const SLASH_X = 0.135;
const CAPACITY_X: readonly [number, number, number] = [0.19, 0.19 + DIGIT_STEP, 0.19 + DIGIT_STEP * 2];
const UNIT_RPM_X = 0.16;
const UNIT_TORQUE_X = 0.33;
const STATUS_Y = -ROW_STEP * 2;

/** 5×5 点阵字模，只收录读数会用到的字符。 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ['01110', '10001', '11111', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '11111'],
  H: ['10001', '10001', '11111', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '11110', '10000', '10000'],
  R: ['11110', '10001', '11110', '10100', '10011'],
  S: ['01111', '10000', '01110', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10101', '11011', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100'],
  '/': ['00001', '00010', '00100', '01000', '10000'],
  '·': ['00000', '00000', '00100', '00000', '00000'],
  '—': ['00000', '00000', '11111', '00000', '00000'],
  '?': ['01110', '10001', '00110', '00000', '00100'],
};

export interface MechanicalReadout {
  update(target: ReadoutTarget | undefined): void;
  dispose(): void;
}

interface DigitHud {
  readonly segments: readonly EntityHandle[];
  readonly bases: readonly { readonly pos: readonly [number, number, number]; readonly scale: readonly [number, number, number] }[];
}

export function createMechanicalReadout(
  world: any,
  assets: AssetRegistry,
  camera: EntityHandle,
): MechanicalReadout {
  const boxMesh = assets.create(createBoxGeometry(1, 1, 1).unwrap()).unwrap();
  const materials = {
    powered: assets.create(Materials.unlit([0.35, 0.95, 0.5, 1])).unwrap(),
    loaded: assets.create(Materials.unlit([1, 0.72, 0.2, 1])).unwrap(),
    overload: assets.create(Materials.unlit([1, 0.32, 0.26, 1])).unwrap(),
    idle: assets.create(Materials.unlit([0.62, 0.66, 0.7, 1])).unwrap(),
    cyclic: assets.create(Materials.unlit([0.72, 0.5, 1, 1])).unwrap(),
  };

  const root = world
    .spawn(
      { component: Transform, data: { pos: HIDDEN_POS as unknown as [number, number, number], scale: [1, 1, 1] } },
      { component: ChildOf, data: { parent: camera } },
    )
    .unwrap();

  const materialFor = (status: ReadoutStatus): AssetHandle<'material'> => {
    switch (status) {
      case 'powered': return materials.powered;
      case 'loaded': return materials.loaded;
      case 'source-overload':
      case 'branch-overload': return materials.overload;
      case 'cyclic':
      case 'unsupported': return materials.cyclic;
      default: return materials.idle;
    }
  };

  const spawnBox = (
    material: AssetHandle<'material'>,
    pos: readonly [number, number, number],
    scale: readonly [number, number, number],
  ): EntityHandle => world
    .spawn(
      {
        component: Transform,
        data: { pos: [pos[0], pos[1], pos[2]], scale: [scale[0], scale[1], scale[2]], quat: [0, 0, 0, 1] },
      },
      { component: ChildOf, data: { parent: root } },
      { component: MeshFilter, data: { assetHandle: boxMesh } },
      { component: MeshRenderer, data: { materials: [material] } },
    )
    .unwrap();

  const spawnDigit = (offsetX: number, offsetY: number, material: AssetHandle<'material'>): DigitHud => {
    const segments: EntityHandle[] = [];
    const bases: { pos: [number, number, number]; scale: [number, number, number] }[] = [];
    for (const rect of SEGMENT_RECTS) {
      const pos: [number, number, number] = [offsetX + rect.x * DIGIT_SCALE, offsetY + rect.y * DIGIT_SCALE, SEGMENT_Z];
      const scale: [number, number, number] = [rect.w * DIGIT_SCALE, rect.h * DIGIT_SCALE, 0.02];
      bases.push({ pos, scale });
      segments.push(spawnBox(material, pos, scale));
    }
    return { segments, bases };
  };

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

  const clearDigit = (digit: DigitHud): void => setDigit(digit, []);

  const setNumber = (digits: readonly DigitHud[], value: number, xs: readonly number[]): void => {
    const safe = Math.max(0, Math.min(999, Math.round(Number.isFinite(value) ? value : 0)));
    const text = String(safe).padStart(3, '0');
    for (let slot = 0; slot < digits.length; slot += 1) {
      void xs;
      if (slot < 3 - String(safe).length) clearDigit(digits[slot]!);
      else setDigit(digits[slot]!, digitSegments(Number(text.charAt(slot))));
    }
  };

  const digitSet = {
    rpm: [spawnDigit(NUM_X[0], 0, materials.powered), spawnDigit(NUM_X[1], 0, materials.powered), spawnDigit(NUM_X[2], 0, materials.powered)],
    load: [spawnDigit(NUM_X[0], -ROW_STEP, materials.powered), spawnDigit(NUM_X[1], -ROW_STEP, materials.powered), spawnDigit(NUM_X[2], -ROW_STEP, materials.powered)],
    capacity: [spawnDigit(CAPACITY_X[0], -ROW_STEP, materials.powered), spawnDigit(CAPACITY_X[1], -ROW_STEP, materials.powered), spawnDigit(CAPACITY_X[2], -ROW_STEP, materials.powered)],
  };

  let textEntities: EntityHandle[] = [];
  let lastKey = '';
  let status: ReadoutStatus | null = null;
  let visible = false;

  const addText = (text: string, cell: number, offsetX: number, offsetY: number, material: AssetHandle<'material'>): EntityHandle[] => {
    const created: EntityHandle[] = [];
    const advance = cell * 6;
    let x = offsetX;
    for (const char of text) {
      const glyph = GLYPHS[char] ?? GLYPHS['?']!;
      for (let row = 0; row < 5; row += 1) {
        const line = glyph[row]!;
        for (let column = 0; column < 5; column += 1) {
          if (line.charAt(column) !== '1') continue;
          created.push(spawnBox(material, [x + column * cell, offsetY - row * cell, SEGMENT_Z], [cell, cell, 0.02]));
        }
      }
      x += advance;
    }
    return created;
  };

  const rebuildText = (target: ReadoutTarget): void => {
    for (const entity of textEntities) world.despawn(entity).unwrap();
    textEntities = [];
    const material = materialFor(target.status);
    textEntities.push(...addText('RPM', UNIT_CELL, UNIT_RPM_X, 0, material));
    textEntities.push(...addText('/', UNIT_CELL, SLASH_X, -ROW_STEP, material));
    textEntities.push(...addText('N·M', UNIT_CELL, UNIT_TORQUE_X, -ROW_STEP, material));
    textEntities.push(...addText(STATUS_TEXT[target.status], STATUS_CELL, 0, STATUS_Y, material));
    if (target.rpm === null) textEntities.push(...addText('—', UNIT_CELL, 0.02, 0, material));
    if (target.torque === null) textEntities.push(...addText('—', UNIT_CELL, 0.02, -ROW_STEP, material));
  };

  const applyDigitMaterial = (material: AssetHandle<'material'>): void => {
    for (const group of [digitSet.rpm, digitSet.load, digitSet.capacity]) {
      for (const digit of group) {
        for (const entity of digit.segments) world.set(entity, MeshRenderer, { materials: [material] }).unwrap();
      }
    }
  };

  const setVisible = (next: boolean): void => {
    if (visible === next) return;
    visible = next;
    world
      .set(root, Transform, {
        pos: next ? [PANEL_ANCHOR[0], PANEL_ANCHOR[1], PANEL_ANCHOR[2]] : [HIDDEN_POS[0], HIDDEN_POS[1], HIDDEN_POS[2]],
        scale: [1, 1, 1],
        quat: [0, 0, 0, 1],
      })
      .unwrap();
  };

  return {
    update(target) {
      if (!target) {
        if (visible) {
          for (const entity of textEntities) world.despawn(entity).unwrap();
          textEntities = [];
          lastKey = '';
          for (const group of [digitSet.rpm, digitSet.load, digitSet.capacity]) {
            for (const digit of group) clearDigit(digit);
          }
        }
        setVisible(false);
        return;
      }
      setVisible(true);

      if (target.status !== status) {
        status = target.status;
        applyDigitMaterial(materialFor(target.status));
      }

      if (target.rpm === null) for (const digit of digitSet.rpm) clearDigit(digit);
      else setNumber(digitSet.rpm, target.rpm, NUM_X);
      if (target.torque === null) for (const digit of digitSet.load) clearDigit(digit);
      else setNumber(digitSet.load, target.torque, NUM_X);
      setNumber(digitSet.capacity, target.capacity, CAPACITY_X);

      const key = `${target.rpm === null ? 'n' : Math.round(target.rpm)}|${target.torque === null ? 'n' : Math.round(target.torque)}|${Math.round(target.capacity)}|${target.status}`;
      if (key !== lastKey) {
        lastKey = key;
        rebuildText(target);
      }
    },
    dispose() {
      for (const entity of textEntities) world.despawn(entity).unwrap();
      for (const group of [digitSet.rpm, digitSet.load, digitSet.capacity]) {
        for (const digit of group) for (const entity of digit.segments) world.despawn(entity).unwrap();
      }
      world.despawn(root).unwrap();
      for (const handle of [boxMesh, materials.powered, materials.loaded, materials.overload, materials.idle, materials.cyclic]) {
        assets.release(handle).unwrap();
      }
    },
  };
}
