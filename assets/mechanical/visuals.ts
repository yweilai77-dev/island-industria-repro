import { createBoxGeometry, createCylinderGeometry } from '@forgeax/engine/geometry';
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

export interface MechanicalViewAssets {
  readonly shaftMesh: AssetHandle<'mesh'>;
  readonly keywayMesh: AssetHandle<'mesh'>;
  readonly gearDiscMesh: AssetHandle<'mesh'>;
  readonly toothMesh: AssetHandle<'mesh'>;
  readonly bodyMesh: AssetHandle<'mesh'>;
  readonly wheelMesh: AssetHandle<'mesh'>;
  readonly ghostMesh: AssetHandle<'mesh'>;
  readonly jointMesh: AssetHandle<'mesh'>;
  readonly shaftMaterial: AssetHandle<'material'>;
  readonly gearMaterial: AssetHandle<'material'>;
  readonly bodyMaterial: AssetHandle<'material'>;
  readonly accentMaterial: AssetHandle<'material'>;
  readonly ghostValidMaterial: AssetHandle<'material'>;
  readonly ghostInvalidMaterial: AssetHandle<'material'>;
  readonly jointMaterial: AssetHandle<'material'>;
}

export interface PartView {
  readonly root: EntityHandle;
  readonly spinner?: EntityHandle;
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
    shaftMaterial: assets.create(Materials.standard({ baseColor: [0.45, 0.5, 0.56, 1], metallic: 0.5, roughness: 0.45 })).unwrap(),
    gearMaterial: assets.create(Materials.standard({ baseColor: [0.72, 0.54, 0.25, 1], metallic: 0.35, roughness: 0.5 })).unwrap(),
    bodyMaterial: assets.create(Materials.standard({ baseColor: [0.24, 0.28, 0.32, 1], metallic: 0.25, roughness: 0.65 })).unwrap(),
    accentMaterial: assets.create(Materials.unlit([0.9, 0.55, 0.16, 1])).unwrap(),
    ghostValidMaterial: assets.create(overlayMaterial([0.3, 0.9, 0.45, 0.35])).unwrap(),
    ghostInvalidMaterial: assets.create(overlayMaterial([0.95, 0.25, 0.2, 0.35])).unwrap(),
    jointMaterial: assets.create(Materials.unlit([0.3, 0.9, 0.45, 1])).unwrap(),
  };
}

export function releaseMechanicalViewAssets(assets: AssetRegistry, view: MechanicalViewAssets): void {
  for (const handle of [
    view.shaftMesh, view.keywayMesh, view.gearDiscMesh, view.toothMesh,
    view.bodyMesh, view.wheelMesh, view.ghostMesh, view.jointMesh,
    view.shaftMaterial, view.gearMaterial, view.bodyMaterial, view.accentMaterial,
    view.ghostValidMaterial, view.ghostInvalidMaterial, view.jointMaterial,
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

  if (part.def.kind === 'shaft') {
    spawnChild(world, root, view.shaftMesh, view.shaftMaterial, [0, 0.5, 0]);
    spawnChild(world, root, view.keywayMesh, view.accentMaterial, [0, 0.5 + SHAFT_RADIUS - 0.01, 0]);
    return { root };
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
    return { root, spinner };
  }

  // 源/机器：机体 + 轮/冲头占位。
  spawnChild(world, root, view.bodyMesh, view.bodyMaterial, [0, 0.45, 0]);
  const wheelAlign = quat.fromAxisAngle(quat.create(), [0, 0, 1], -Math.PI / 2);
  const wheel = world
    .spawn(
      {
        component: Transform,
        data: {
          pos: part.def.kind === 'power-source' ? [0.46, 0.5, 0] : [-0.46, 0.5, 0],
          quat: [wheelAlign[0] ?? 0, wheelAlign[1] ?? 0, wheelAlign[2] ?? 0, wheelAlign[3] ?? 1],
        },
      },
      { component: ChildOf, data: { parent: root } },
      { component: MeshFilter, data: { assetHandle: view.wheelMesh } },
      { component: MeshRenderer, data: { materials: [view.accentMaterial] } },
    )
    .unwrap();
  return { root, spinner: wheel };
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
          { component: Transform, data: { pos: anchor, scale: [0.12, 0.12, 0.12] } },
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

