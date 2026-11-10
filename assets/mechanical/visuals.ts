import { createBoxGeometry, createCylinderGeometry, createExtrusionGeometry } from '@forgeax/engine/geometry';
import { quat } from '@forgeax/engine/math';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { ChildOf, Transform } from '@forgeax/engine/scene';
import type { EntityHandle } from '@forgeax/engine/ecs';
import type { AssetHandle } from '@forgeax/engine/types';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { placementCenter } from '../grid/grid.ts';
import { placementBaseY } from '../spatial/space.ts';
import type { MechanicalPart } from './parts.ts';
import {
  GEAR_FACE_WIDTH,
  GEAR_OUTER_RADIUS,
  GEAR_ROOT_RADIUS,
  SHAFT_LENGTH,
  SHAFT_RADIUS,
} from './parts.ts';

const DEG = Math.PI / 180;
const HIDDEN_Y = -1000;

type Vec3 = readonly [number, number, number];
type QuatTuple = readonly [number, number, number, number];

const IDENTITY_QUAT: QuatTuple = [0, 0, 0, 1];

function toQuatTuple(value: ArrayLike<number>): QuatTuple {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1];
}

function axisQuat(axis: Vec3, angleRadians: number): QuatTuple {
  return toQuatTuple(quat.fromAxisAngle(quat.create(), [axis[0], axis[1], axis[2]], angleRadians));
}

/** 圆柱默认沿 Y 轴；立式/飞轮/炉体传动轮都要绕本地 X 轴转，先把它对齐到 X。 */
const ALIGN_Y_TO_X: QuatTuple = axisQuat([0, 0, 1], -Math.PI / 2);
/** 重力溜槽整体绕本地 Z 轴下倾 16°（本地 +X 端更低）。 */
const CHUTE_TILT_ANGLE = -16 * DEG;
const CHUTE_TILT: QuatTuple = axisQuat([0, 0, 1], CHUTE_TILT_ANGLE);
/** 摇柄细杆默认沿 Y；转 90° 后指向 spinner 本地 -X（= 零件本地 +Y）。 */
const CRANK_ARM_ROT: QuatTuple = axisQuat([0, 0, 1], Math.PI / 2);

/**
 * 带齿滚筒截面（XY 平面，沿 Z 挤出）：6 齿星形，外径 0.19 / 根径 0.13，均径 0.16。
 * 用一条挤出网格替代「圆柱 + 6 个 markerMesh」，破碎机实体数从 20 降到 6。
 */
function toothedContour(teeth: number, rootRadius: number, tipRadius: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index < teeth * 2; index += 1) {
    const angle = (index / (teeth * 2)) * Math.PI * 2;
    const radius = index % 2 === 0 ? tipRadius : rootRadius;
    points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return points;
}

export interface MechanicalViewAssets {
  readonly shaftMesh: AssetHandle<'mesh'>;
  readonly keywayMesh: AssetHandle<'mesh'>;
  readonly gearDiscMesh: AssetHandle<'mesh'>;
  readonly toothMesh: AssetHandle<'mesh'>;
  readonly bodyMesh: AssetHandle<'mesh'>;
  readonly wheelMesh: AssetHandle<'mesh'>;
  readonly ghostMesh: AssetHandle<'mesh'>;
  readonly jointMesh: AssetHandle<'mesh'>;
  readonly rodMesh: AssetHandle<'mesh'>;
  readonly ramMesh: AssetHandle<'mesh'>;
  readonly markerMesh: AssetHandle<'mesh'>;
  // M1.8 新零件专用网格（立式传动带 / 手摇飞轮 / 破碎机 / 熔炼炉 / 锻压机 / 溜槽）。
  readonly pulleyMesh: AssetHandle<'mesh'>;
  readonly beltMesh: AssetHandle<'mesh'>;
  readonly postMesh: AssetHandle<'mesh'>;
  readonly plateMesh: AssetHandle<'mesh'>;
  readonly flywheelMesh: AssetHandle<'mesh'>;
  readonly hopperMesh: AssetHandle<'mesh'>;
  readonly hopperBodyMesh: AssetHandle<'mesh'>;
  readonly crusherBaseMesh: AssetHandle<'mesh'>;
  readonly rollerMesh: AssetHandle<'mesh'>;
  readonly furnaceMesh: AssetHandle<'mesh'>;
  readonly furnaceMouthMesh: AssetHandle<'mesh'>;
  readonly anvilMesh: AssetHandle<'mesh'>;
  readonly chuteDeckMesh: AssetHandle<'mesh'>;
  readonly chuteRailMesh: AssetHandle<'mesh'>;
  readonly chuteFootMesh: AssetHandle<'mesh'>;
  readonly shaftMaterial: AssetHandle<'material'>;
  readonly gearMaterial: AssetHandle<'material'>;
  readonly bodyMaterial: AssetHandle<'material'>;
  readonly accentMaterial: AssetHandle<'material'>;
  readonly brickMaterial: AssetHandle<'material'>;
  readonly ghostValidMaterial: AssetHandle<'material'>;
  readonly ghostInvalidMaterial: AssetHandle<'material'>;
  readonly selectionMaterial: AssetHandle<'material'>;
  readonly jointMaterial: AssetHandle<'material'>;
}

export interface MachineView {
  readonly crank: EntityHandle;
  readonly crankPin: EntityHandle;
  readonly rod: EntityHandle;
  readonly ram: EntityHandle;
}

/**
 * 与主 spinner 同角度自转的附加实体（立式传动带的上轮、破碎机的双滚筒）。
 * 默认与主 spinner 共用零件本地有向轴；滚筒这类自转轴不同的零件用 `axis` 覆盖。
 */
export interface ExtraSpinner {
  readonly entity: EntityHandle;
  /** 自转轴（零件 root 本地坐标）；缺省同主 spinner。 */
  readonly axis?: readonly [number, number, number];
  /** 基准朝向；运行时先乘自转四元数再写入。 */
  readonly baseQuat?: readonly [number, number, number, number];
  /** 1 = 与主轴同向；−1 = 反向（破碎机双滚筒对转）。 */
  readonly direction?: 1 | -1;
}

export interface PartView {
  readonly root: EntityHandle;
  readonly spinner?: EntityHandle;
  /** spinner 的基准朝向；运行时先乘自转四元数。 */
  readonly spinBaseQuat?: readonly [number, number, number, number];
  readonly machine?: MachineView;
  /** 跟随同一自转角度的附加实体；没有 spinner 的零件（破碎机）也能靠它自转。 */
  readonly extraSpinners?: readonly ExtraSpinner[];
}

function overlayMaterial(color: readonly [number, number, number, number]) {
  return Materials.unlit([...color], {
    renderState: {
      depthWriteEnabled: false,
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
    },
  });
}

export function createMechanicalViewAssets(assets: AssetRegistry): MechanicalViewAssets {
  return {
    shaftMesh: assets.create(createBoxGeometry(SHAFT_LENGTH, SHAFT_RADIUS * 2, SHAFT_RADIUS * 2).unwrap()).unwrap(),
    keywayMesh: assets.create(createBoxGeometry(0.36, 0.035, 0.035).unwrap()).unwrap(),
    gearDiscMesh: assets.create(createCylinderGeometry(GEAR_OUTER_RADIUS, GEAR_OUTER_RADIUS, GEAR_FACE_WIDTH, 24).unwrap()).unwrap(),
    toothMesh: assets.create(createBoxGeometry(0.16, GEAR_FACE_WIDTH * 0.7, 0.14).unwrap()).unwrap(),
    bodyMesh: assets.create(createBoxGeometry(0.8, 0.9, 0.8).unwrap()).unwrap(),
    wheelMesh: assets.create(createCylinderGeometry(0.25, 0.25, 0.12, 16).unwrap()).unwrap(),
    ghostMesh: assets.create(createBoxGeometry(1, 1, 1).unwrap()).unwrap(),
    jointMesh: assets.create(createBoxGeometry(0.12, 0.12, 0.12).unwrap()).unwrap(),
    rodMesh: assets.create(createBoxGeometry(0.06, 1, 0.06).unwrap()).unwrap(),
    ramMesh: assets.create(createBoxGeometry(0.24, 0.18, 0.24).unwrap()).unwrap(),
    markerMesh: assets.create(createBoxGeometry(0.08, 0.08, 0.08).unwrap()).unwrap(),
    pulleyMesh: assets.create(createCylinderGeometry(0.32, 0.32, 0.16, 20).unwrap()).unwrap(),
    beltMesh: assets.create(createBoxGeometry(0.1, 3.0, 0.05).unwrap()).unwrap(),
    postMesh: assets.create(createBoxGeometry(0.08, 3.2, 0.08).unwrap()).unwrap(),
    plateMesh: assets.create(createBoxGeometry(0.9, 0.08, 0.9).unwrap()).unwrap(),
    flywheelMesh: assets.create(createCylinderGeometry(0.36, 0.36, 0.1, 24).unwrap()).unwrap(),
    hopperMesh: assets.create(createBoxGeometry(0.9, 0.12, 0.9).unwrap()).unwrap(),
    hopperBodyMesh: assets.create(createBoxGeometry(0.7, 0.3, 0.7).unwrap()).unwrap(),
    crusherBaseMesh: assets.create(createBoxGeometry(0.9, 0.25, 0.9).unwrap()).unwrap(),
    rollerMesh: assets.create(createExtrusionGeometry(toothedContour(6, 0.13, 0.19), 0.7).unwrap()).unwrap(),
    furnaceMesh: assets.create(createBoxGeometry(0.8, 0.85, 0.8).unwrap()).unwrap(),
    furnaceMouthMesh: assets.create(createBoxGeometry(0.34, 0.22, 0.04).unwrap()).unwrap(),
    anvilMesh: assets.create(createBoxGeometry(0.5, 0.2, 0.5).unwrap()).unwrap(),
    chuteDeckMesh: assets.create(createBoxGeometry(1.0, 0.05, 0.5).unwrap()).unwrap(),
    chuteRailMesh: assets.create(createBoxGeometry(1.0, 0.16, 0.05).unwrap()).unwrap(),
    chuteFootMesh: assets.create(createBoxGeometry(0.08, 1, 0.12).unwrap()).unwrap(),
    shaftMaterial: assets.create(Materials.standard({ baseColor: [0.45, 0.5, 0.56, 1], metallic: 0.5, roughness: 0.45 })).unwrap(),
    gearMaterial: assets.create(Materials.standard({ baseColor: [0.72, 0.54, 0.25, 1], metallic: 0.35, roughness: 0.5 })).unwrap(),
    bodyMaterial: assets.create(Materials.standard({ baseColor: [0.24, 0.28, 0.32, 1], metallic: 0.25, roughness: 0.65 })).unwrap(),
    accentMaterial: assets.create(Materials.unlit([0.9, 0.55, 0.16, 1])).unwrap(),
    brickMaterial: assets.create(Materials.standard({ baseColor: [0.45, 0.26, 0.2, 1], metallic: 0.05, roughness: 0.85 })).unwrap(),
    ghostValidMaterial: assets.create(overlayMaterial([0.3, 0.9, 0.45, 0.35])).unwrap(),
    ghostInvalidMaterial: assets.create(overlayMaterial([0.95, 0.25, 0.2, 0.35])).unwrap(),
    selectionMaterial: assets.create(overlayMaterial([0.3, 0.85, 1, 0.32])).unwrap(),
    jointMaterial: assets.create(Materials.unlit([0.3, 0.9, 0.45, 1])).unwrap(),
  };
}

export function releaseMechanicalViewAssets(assets: AssetRegistry, view: MechanicalViewAssets): void {
  for (const handle of [
    view.shaftMesh, view.keywayMesh, view.gearDiscMesh, view.toothMesh,
    view.bodyMesh, view.wheelMesh, view.ghostMesh, view.jointMesh,
    view.shaftMaterial, view.gearMaterial, view.bodyMaterial, view.accentMaterial,
    view.ghostValidMaterial, view.ghostInvalidMaterial, view.selectionMaterial, view.jointMaterial,
    view.rodMesh, view.ramMesh, view.markerMesh,
    view.pulleyMesh, view.beltMesh, view.postMesh, view.plateMesh,
    view.flywheelMesh, view.hopperMesh, view.hopperBodyMesh, view.crusherBaseMesh,
    view.rollerMesh, view.furnaceMesh, view.furnaceMouthMesh, view.anvilMesh,
    view.chuteDeckMesh, view.chuteRailMesh, view.chuteFootMesh,
    view.brickMaterial,
  ]) {
    assets.release(handle).unwrap();
  }
}

function spawnChild(
  world: { spawn: (...args: unknown[]) => { unwrap: () => EntityHandle } },
  parent: EntityHandle,
  mesh: AssetHandle<'mesh'>,
  material: AssetHandle<'material'>,
  pos: readonly [number, number, number],
  scale: readonly [number, number, number] = [1, 1, 1],
  rotation: readonly [number, number, number, number] = [0, 0, 0, 1],
): EntityHandle {
  return world
    .spawn(
      { component: Transform, data: { pos, scale, quat: rotation } },
      { component: ChildOf, data: { parent } },
      { component: MeshFilter, data: { assetHandle: mesh } },
      { component: MeshRenderer, data: { materials: [material] } },
    )
    .unwrap();
}

/** 无渲染的容器实体：给需要叠加平移/旋转的零件做分组（溜槽倾角、锻压机锤头滑块）。 */
function spawnGroup(world: any, parent: EntityHandle, pos: Vec3, rotation: QuatTuple = IDENTITY_QUAT): EntityHandle {
  return world
    .spawn(
      {
        component: Transform,
        data: { pos: [pos[0], pos[1], pos[2]], quat: [rotation[0], rotation[1], rotation[2], rotation[3]] },
      },
      { component: ChildOf, data: { parent } },
    )
    .unwrap();
}

/**
 * 立式传动带（高 3m，AABB y∈[0,3]）：上下皮带轮 + 两条竖直皮带 + 立柱/底板。
 * 9 实体：root、底板、2 立柱、2 皮带、下轮组（spinner + 轮盘）、上轮（自带网格的 extraSpinner）。
 * 上端口锚点在 y=3.5（设计如此），所以上轮画在层高之上。
 */
function createVerticalDriveView(world: any, root: EntityHandle, view: MechanicalViewAssets): PartView {
  spawnChild(world, root, view.plateMesh, view.bodyMaterial, [0, 0.06, 0]);
  spawnChild(world, root, view.postMesh, view.shaftMaterial, [0, 1.6, 0.3]);
  spawnChild(world, root, view.postMesh, view.shaftMaterial, [0, 1.6, -0.3]);
  spawnChild(world, root, view.beltMesh, view.bodyMaterial, [0, 2.0, 0.24]);
  spawnChild(world, root, view.beltMesh, view.bodyMaterial, [0, 2.0, -0.24]);
  const spinner = spawnGroup(world, root, [0, 0.5, 0], ALIGN_Y_TO_X);
  spawnChild(world, spinner, view.pulleyMesh, view.shaftMaterial, [0, 0, 0]);
  const topPulley = spawnChild(world, root, view.pulleyMesh, view.shaftMaterial, [0, 3.5, 0], [1, 1, 1], ALIGN_Y_TO_X);
  return {
    root,
    spinner,
    spinBaseQuat: ALIGN_Y_TO_X,
    extraSpinners: [{ entity: topPulley, axis: [1, 0, 0], baseQuat: ALIGN_Y_TO_X }],
  };
}

/**
 * 手摇飞轮储能机：机体 + 侧面大飞轮 + 4 枚轮缘标记 + 摇柄（杆 + 手柄）。10 实体。
 * 飞轮中心 (0.46, 0.5, 0) 按规格；摇柄杆与手柄沿本地 +X 再外移 0.06m，
 * 否则 0.06 粗的杆会完全埋进 0.10 厚的轮盘里看不见。
 * spinner 本地 -X = 零件本地 +Y，所以「向 +Y 偏 0.22」写成本地 x = -0.22。
 */
function createFlywheelSourceView(world: any, root: EntityHandle, view: MechanicalViewAssets): PartView {
  spawnChild(world, root, view.bodyMesh, view.bodyMaterial, [0, 0.45, 0]);
  const spinner = spawnGroup(world, root, [0.46, 0.5, 0], ALIGN_Y_TO_X);
  spawnChild(world, spinner, view.flywheelMesh, view.shaftMaterial, [0, 0, 0]);
  const rimRadius = 0.35;
  const diagonal = rimRadius * Math.SQRT1_2;
  const rimMarkers: readonly (readonly [number, number])[] = [
    [diagonal, diagonal],
    [-diagonal, diagonal],
    [-diagonal, -diagonal],
    [diagonal, -diagonal],
  ];
  for (const [localX, localZ] of rimMarkers) {
    // 略高出轮面 0.03m，避免和轮盘正面共面闪烁。
    spawnChild(world, spinner, view.markerMesh, view.accentMaterial, [localX, 0.03, localZ], [1.3, 1.3, 1.3]);
  }
  spawnChild(world, spinner, view.rodMesh, view.gearMaterial, [-0.22, 0.06, 0], [1, 0.3, 1], CRANK_ARM_ROT);
  spawnChild(world, spinner, view.markerMesh, view.accentMaterial, [-0.37, 0.06, 0], [1.5, 1.5, 1.5]);
  return { root, spinner, spinBaseQuat: ALIGN_Y_TO_X };
}

/**
 * 破碎机：顶部漏斗（上宽下窄）+ 中部双齿滚筒（反向自转）+ 底座。6 实体。
 * 滚筒用 6 齿星形挤出网格（轴向 Z），比「圆柱 + 每轮 6 个 markerMesh」少 14 个实体；
 * 自转轴改成零件本地 Z（滚筒轴向），右滚筒用 direction: -1 与左滚筒对转。
 */
function createCrusherView(world: any, root: EntityHandle, view: MechanicalViewAssets): PartView {
  spawnChild(world, root, view.hopperMesh, view.shaftMaterial, [0, 0.92, 0]);
  spawnChild(world, root, view.hopperBodyMesh, view.shaftMaterial, [0, 0.72, 0]);
  spawnChild(world, root, view.crusherBaseMesh, view.bodyMaterial, [0, 0.13, 0]);
  const leftRoller = spawnChild(world, root, view.rollerMesh, view.gearMaterial, [-0.16, 0.5, 0]);
  const rightRoller = spawnChild(world, root, view.rollerMesh, view.gearMaterial, [0.16, 0.5, 0]);
  return {
    root,
    extraSpinners: [
      { entity: leftRoller, axis: [0, 0, 1], direction: 1 },
      { entity: rightRoller, axis: [0, 0, 1], direction: -1 },
    ],
  };
}

/** 熔炼炉：砖色炉体 + 正面橙红炉口 + 顶部排气口 + 侧面传动轮。6 实体。 */
function createSmelterView(world: any, root: EntityHandle, view: MechanicalViewAssets): PartView {
  spawnChild(world, root, view.furnaceMesh, view.brickMaterial, [0, 0.43, 0]);
  spawnChild(world, root, view.furnaceMouthMesh, view.accentMaterial, [0, 0.45, 0.41]);
  spawnChild(world, root, view.markerMesh, view.bodyMaterial, [0, 0.9, 0], [2.5, 1.5, 2.5]);
  const spinner = spawnGroup(world, root, [0.46, 0.5, 0], ALIGN_Y_TO_X);
  spawnChild(world, spinner, view.wheelMesh, view.gearMaterial, [0, 0, 0], [0.8, 0.8, 0.8]);
  return { root, spinner, spinBaseQuat: ALIGN_Y_TO_X };
}

/**
 * 锻压机：复用冲压机的曲柄滑块运动（applyMachinePose 驱动 crankPin/rod/ram），
 * 外观换成砧座 + 锤头。10 实体。
 * `ram` 是无渲染的滑块组，锤杆/锤头是它的子物体并整体下移 0.4m：
 * applyMachinePose 把 ram 固定在 y≈0.63–0.90，直接给 ramMesh 会永远悬在 y=0.2 的砧面上方。
 */
function createForgeView(world: any, root: EntityHandle, view: MechanicalViewAssets): PartView {
  spawnChild(world, root, view.bodyMesh, view.bodyMaterial, [0.18, 0.25, 0], [1, 0.55, 1]);
  spawnChild(world, root, view.anvilMesh, view.shaftMaterial, [-0.3, 0.1, 0]);
  const spinner = spawnGroup(world, root, [-0.3, 0.5, 0], ALIGN_Y_TO_X);
  spawnChild(world, spinner, view.wheelMesh, view.gearMaterial, [0, 0, 0], [0.72, 0.72, 0.72]);
  const crankPin = spawnChild(world, root, view.markerMesh, view.accentMaterial, [-0.3, 0.62, 0]);
  const rod = spawnChild(world, root, view.rodMesh, view.gearMaterial, [-0.3, 0.5, 0], [1, 0.28, 1]);
  const ram = spawnGroup(world, root, [-0.3, 0.9, 0]);
  spawnChild(world, ram, view.rodMesh, view.shaftMaterial, [0, -0.146, 0], [1, 0.292, 1]);
  // 锤头用 accentMaterial（与冲压机 ram 同一观感），深灰机体前才看得见。
  spawnChild(world, ram, view.ramMesh, view.accentMaterial, [0, -0.4, 0], [1.4, 1.2, 1.4]);
  return { root, spinner, spinBaseQuat: ALIGN_Y_TO_X, machine: { crank: spinner, crankPin, rod, ram } };
}

/**
 * 重力溜槽：整体绕本地 Z 下倾 16° 的 U 形槽 + 两端支脚。7 实体，不设 spinner（不自转）。
 * 槽底板/挡边放进倾斜组；支脚留在 root 本地保持竖直，高度按倾斜后槽底在 x=±0.36 处的实际高度缩放。
 * 几何取舍：在途物品的视觉高度由 transport.ts 的 CHUTE_ITEM_HEIGHT 固定为 0.34，
 * 16° 倾角让槽面两端高差 ±0.14m，物品在高端会略微埋进槽面（那是一个文件的常量，不在本文件权限内）。
 */
function createChuteView(world: any, root: EntityHandle, view: MechanicalViewAssets): PartView {
  const tilt = spawnGroup(world, root, [0, 0.34, 0], CHUTE_TILT);
  spawnChild(world, tilt, view.chuteDeckMesh, view.shaftMaterial, [0, 0, 0]);
  spawnChild(world, tilt, view.chuteRailMesh, view.shaftMaterial, [0, 0.105, 0.25]);
  spawnChild(world, tilt, view.chuteRailMesh, view.shaftMaterial, [0, 0.105, -0.25]);
  const deckBottomY = (localX: number): number =>
    0.34 + localX * Math.sin(CHUTE_TILT_ANGLE) - 0.025 * Math.cos(CHUTE_TILT_ANGLE);
  for (const localX of [-0.36, 0.36]) {
    // 支脚比槽底多伸 0.02m 埋进去，避免倾斜造成可见缝隙。
    const legHeight = deckBottomY(localX) + 0.02;
    spawnChild(world, root, view.chuteFootMesh, view.bodyMaterial, [localX, legHeight / 2, 0], [1, legHeight, 1]);
  }
  return { root };
}

export function createPartView(
  world: any,
  part: MechanicalPart,
  view: MechanicalViewAssets,
): PartView {
  const center = placementCenter(part.placement);
  const yaw = quat.fromAxisAngle(quat.create(), [0, 1, 0], part.placement.rotation * DEG);
  const root = world
    .spawn({ component: Transform, data: { pos: [center[0], placementBaseY(part.placement), center[2]], quat: [yaw[0] ?? 0, yaw[1] ?? 0, yaw[2] ?? 0, yaw[3] ?? 1] } })
    .unwrap();

  // M1.8 新零件按 def.id 分流；旧零件继续走下面的 kind 分支，外观保持不变。
  if (part.def.id === 'vertical_drive') return createVerticalDriveView(world, root, view);
  if (part.def.id === 'flywheel_source') return createFlywheelSourceView(world, root, view);
  if (part.def.id === 'crusher') return createCrusherView(world, root, view);
  if (part.def.id === 'smelter') return createSmelterView(world, root, view);
  if (part.def.id === 'forge') return createForgeView(world, root, view);
  if (part.def.id === 'chute') return createChuteView(world, root, view);

  if (part.def.kind === 'shaft') {
    const spinner = world
      .spawn(
        { component: Transform, data: { pos: [0, 0.5, 0] } },
        { component: ChildOf, data: { parent: root } },
      )
      .unwrap();
    spawnChild(world, spinner, view.shaftMesh, view.shaftMaterial, [0, 0, 0]);
    spawnChild(world, spinner, view.keywayMesh, view.accentMaterial, [0, SHAFT_RADIUS - 0.01, 0]);
    return { root, spinner, spinBaseQuat: [0, 0, 0, 1] };
  }

  if (part.def.kind === 'gear') {
    // 圆柱默认 Y 轴；spinner 把 Y 对齐到本地 X 轴；root 的 yaw 负责世界 X/Z。
    const align = quat.fromAxisAngle(quat.create(), [0, 0, 1], -Math.PI / 2);
    const spinner = world
      .spawn(
        { component: Transform, data: { pos: [0, 0.5, 0], quat: [align[0] ?? 0, align[1] ?? 0, align[2] ?? 0, align[3] ?? 1] } },
        { component: ChildOf, data: { parent: root } },
      )
      .unwrap();
    spawnChild(world, spinner, view.gearDiscMesh, view.gearMaterial, [0, 0, 0]);
    const teeth = part.def.teeth === 24 ? 12 : 8;
    for (let index = 0; index < teeth; index += 1) {
      const angle = (index / teeth) * Math.PI * 2;
      spawnChild(
        world,
        spinner,
        view.toothMesh,
        view.gearMaterial,
        [Math.cos(angle) * (GEAR_ROOT_RADIUS + 0.05), 0, Math.sin(angle) * (GEAR_ROOT_RADIUS + 0.05)],
      );
    }
    return {
      root,
      spinner,
      spinBaseQuat: [align[0] ?? 0, align[1] ?? 0, align[2] ?? 0, align[3] ?? 1],
    };
  }

  const align = quat.fromAxisAngle(quat.create(), [0, 0, 1], -Math.PI / 2);
  const alignQuat: [number, number, number, number] = [align[0] ?? 0, align[1] ?? 0, align[2] ?? 0, align[3] ?? 1];

  // P2-D 结构框架：底座 + 四角立柱 + 顶梁 + 橙色铆钉。钢灰色、无运动部件，
  // 与加工核心（深灰机体/砖红炉体）在远处也能区分；四角铆钉帮助读出朝向与边界。
  if (part.def.kind === 'structure') {
    spawnChild(world, root, view.plateMesh, view.shaftMaterial, [0, 0.04, 0]);
    spawnChild(world, root, view.plateMesh, view.shaftMaterial, [0, 0.96, 0]);
    const corners: readonly (readonly [number, number])[] = [
      [-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4],
    ];
    for (const [x, z] of corners) {
      // 橙色立柱让结构模块在灰色地坪/深灰机器旁一眼可辨；上下钢板仍是钢灰色。
      spawnChild(world, root, view.postMesh, view.accentMaterial, [x, 0.5, z], [1, 0.3, 1]);
      spawnChild(world, root, view.markerMesh, view.bodyMaterial, [x, 0.14, z], [1.2, 1.2, 1.2]);
    }
    return { root };
  }

  if (part.def.kind === 'power-source') {
    spawnChild(world, root, view.bodyMesh, view.bodyMaterial, [0, 0.45, 0]);
    const spinner = world
      .spawn(
        { component: Transform, data: { pos: [0.46, 0.5, 0], quat: alignQuat } },
        { component: ChildOf, data: { parent: root } },
      )
      .unwrap();
    spawnChild(world, spinner, view.wheelMesh, view.accentMaterial, [0, 0, 0]);
    // 深色 marker 让旋转可见。
    spawnChild(world, spinner, view.markerMesh, view.bodyMaterial, [0.16, 0, 0]);
    return { root, spinner, spinBaseQuat: alignQuat };
  }

  // 冲压机：缩小机体并向右偏移，给左侧曲柄/连杆/冲头留出可见空间。
  spawnChild(world, root, view.bodyMesh, view.bodyMaterial, [0.18, 0.25, 0], [1, 0.55, 1]);
  const spinner = world
    .spawn(
      { component: Transform, data: { pos: [-0.30, 0.5, 0], quat: alignQuat } },
      { component: ChildOf, data: { parent: root } },
    )
    .unwrap();
  spawnChild(world, spinner, view.wheelMesh, view.gearMaterial, [0, 0, 0], [0.72, 0.72, 0.72]);
  const crankPin = spawnChild(world, root, view.markerMesh, view.accentMaterial, [-0.30, 0.62, 0]);
  const rod = spawnChild(world, root, view.rodMesh, view.gearMaterial, [-0.30, 0.5, 0], [1, 0.28, 1]);
  const ram = spawnChild(world, root, view.ramMesh, view.accentMaterial, [-0.30, 0.9, 0]);
  return {
    root,
    spinner,
    spinBaseQuat: alignQuat,
    machine: { crank: spinner, crankPin, rod, ram },
  };
}

export class PartViewRegistry {
  private readonly views = new Map<number, PartView>();
  private readonly joints = new Map<string, EntityHandle>();

  constructor(private readonly world: any) {}

  add(partId: number, view: PartView): void {
    if (this.views.has(partId)) throw new Error(`part view already exists: ${partId}`);
    this.views.set(partId, view);
  }

  get(partId: number): PartView | undefined {
    return this.views.get(partId);
  }

  /** 幂等清理：先删除 map 记录，再 despawn；重复调用返回 false。 */
  dispose(partId: number): boolean {
    const view = this.views.get(partId);
    if (!view) return false;
    this.views.delete(partId);
    this.world.despawn(view.root);
    return true;
  }

  /**
   * 重建全部连接接头：先清旧接头，再按传入锚点创建（幂等）。
   * 锚点由 pack 从真实端口世界位置计算，visuals 不依赖连接数据结构。
   */
  refreshJoints(
    anchors: readonly { readonly id: string; readonly anchor: readonly [number, number, number] }[],
    assets: MechanicalViewAssets,
  ): void {
    this.clearJoints();
    for (const { id, anchor } of anchors) {
      const entity = this.world
        .spawn(
          { component: Transform, data: { pos: anchor, scale: [1, 1, 1] } },
          { component: MeshFilter, data: { assetHandle: assets.jointMesh } },
          { component: MeshRenderer, data: { materials: [assets.jointMaterial] } },
        )
        .unwrap();
      this.joints.set(id, entity);
    }
  }

  clearJoints(): void {
    for (const [id, entity] of this.joints) {
      this.joints.delete(id);
      this.world.despawn(entity);
    }
  }

  disposeAll(): void {
    this.clearJoints();
    for (const partId of [...this.views.keys()]) this.dispose(partId);
  }

  get jointCount(): number {
    return this.joints.size;
  }

  get viewCount(): number {
    return this.views.size;
  }
}