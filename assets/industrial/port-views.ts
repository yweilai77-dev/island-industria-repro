import type { EntityHandle } from '@forgeax/engine/ecs';
import { createBoxGeometry } from '@forgeax/engine/geometry';
import { quat } from '@forgeax/engine/math';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { Transform } from '@forgeax/engine/scene';
import type { AssetHandle } from '@forgeax/engine/types';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import type { MechanicalPart } from '../mechanical/parts.ts';
import { coreForPart } from './catalog.ts';
import type { MaterialLinkSnapshot } from './link-runtime.ts';
import type { InstalledPort } from './port-runtime.ts';
import { slotWorldOf, type SlotWorld } from './port-slot-world.ts';
import type { PortSlotId } from './ids.ts';

/**
 * P2-C 接口盒 / 物料连接的世界表现（纯视图，不持逻辑状态）。
 *
 * 视觉规则（让玩家一眼分辨功能）：
 * - 盒体统一金属灰；接口口颜色按功能区分：
 *   基础盒 = 琥珀、输出盒 = 蓝色、分流盒 = 绿色、合流盒 = 紫色；
 * - 已建立的物料连接画成一根细铜管（失效连接为暗红色），沿两个接口的世界锚点摆放；
 * - 建链时被选为源头的接口上方显示一个绿色标记。
 *
 * 位置**每帧**按机器当前 Placement 重算（旋转/搬动后自动跟随），不缓存世界坐标。
 */

const HIDDEN_Y = -1000;
const CABLE_THICKNESS = 0.055;
const CABLE_MIN_LENGTH = 0.16;
const MARKER_Y_OFFSET = 0.26;

interface ViewAssets {
  readonly bodyMesh: AssetHandle<'mesh'>;
  readonly accentMesh: AssetHandle<'mesh'>;
  readonly cableMesh: AssetHandle<'mesh'>;
  readonly markerMesh: AssetHandle<'mesh'>;
  readonly bodyMaterial: AssetHandle<'material'>;
  readonly throughMaterial: AssetHandle<'material'>;
  readonly outputMaterial: AssetHandle<'material'>;
  readonly splitterMaterial: AssetHandle<'material'>;
  readonly mergerMaterial: AssetHandle<'material'>;
  readonly cableActiveMaterial: AssetHandle<'material'>;
  readonly cableInactiveMaterial: AssetHandle<'material'>;
  readonly markerMaterial: AssetHandle<'material'>;
}

function createAssets(assets: AssetRegistry): ViewAssets {
  const bodyMesh = assets.create(createBoxGeometry(0.42, 0.3, 0.22).unwrap()).unwrap();
  const accentMesh = assets.create(createBoxGeometry(0.2, 0.16, 0.14).unwrap()).unwrap();
  const cableMesh = assets.create(createBoxGeometry(1, 1, 1).unwrap()).unwrap();
  const markerMesh = assets.create(createBoxGeometry(0.3, 0.05, 0.3).unwrap()).unwrap();
  const standard = (color: readonly [number, number, number, number], metallic = 0.45) =>
    assets.create(Materials.standard({ baseColor: [...color], metallic, roughness: 0.45 })).unwrap();
  return {
    bodyMesh,
    accentMesh,
    cableMesh,
    markerMesh,
    bodyMaterial: standard([0.52, 0.57, 0.62, 1], 0.55),
    throughMaterial: standard([0.85, 0.6, 0.2, 1], 0.4),
    outputMaterial: standard([0.35, 0.65, 0.92, 1], 0.4),
    splitterMaterial: standard([0.35, 0.8, 0.45, 1], 0.35),
    mergerMaterial: standard([0.7, 0.45, 0.88, 1], 0.35),
    cableActiveMaterial: standard([0.78, 0.5, 0.22, 1], 0.7),
    cableInactiveMaterial: standard([0.45, 0.2, 0.18, 1], 0.2),
    markerMaterial: standard([0.4, 0.95, 0.5, 1], 0.1),
  };
}

function releaseAssets(assets: AssetRegistry, view: ViewAssets): void {
  for (const handle of [
    view.bodyMesh,
    view.accentMesh,
    view.cableMesh,
    view.markerMesh,
    view.bodyMaterial,
    view.throughMaterial,
    view.outputMaterial,
    view.splitterMaterial,
    view.mergerMaterial,
    view.cableActiveMaterial,
    view.cableInactiveMaterial,
    view.markerMaterial,
  ]) {
    assets.release(handle).unwrap();
  }
}

function accentMaterialOf(view: ViewAssets, port: InstalledPort): AssetHandle<'material'> {
  switch (port.module.id) {
    case 'port.output': return view.outputMaterial;
    case 'port.splitter': return view.splitterMaterial;
    case 'port.merger': return view.mergerMaterial;
    default: return view.throughMaterial;
  }
}

function quatTuple(value: ArrayLike<number>): [number, number, number, number] {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1];
}

export interface PortViewInput {
  readonly parts: readonly MechanicalPart[];
  readonly ports: readonly InstalledPort[];
  readonly links: readonly MaterialLinkSnapshot[];
  readonly armed: { readonly partId: number; readonly slotId: PortSlotId } | undefined;
}

export class PortViewRegistry {
  private readonly boxes = new Map<string, { body: EntityHandle; accent: EntityHandle }>();
  private readonly cables = new Map<string, EntityHandle>();
  private readonly marker: EntityHandle;
  private readonly assets: ViewAssets;

  constructor(private readonly world: any, assets: AssetRegistry) {
    this.assets = createAssets(assets);
    this.marker = this.spy(this.assets.markerMesh, this.assets.markerMaterial);
    this.hide(this.marker);
  }

  dispose(assets: AssetRegistry): void {
    for (const box of this.boxes.values()) {
      this.world.despawn(box.body).unwrap();
      this.world.despawn(box.accent).unwrap();
    }
    for (const cable of this.cables.values()) this.world.despawn(cable).unwrap();
    this.world.despawn(this.marker).unwrap();
    this.boxes.clear();
    this.cables.clear();
    releaseAssets(assets, this.assets);
  }

  private spy(handle: AssetHandle<'mesh'>, material: AssetHandle<'material'>): EntityHandle {
    return this.world
      .spawn(
        { component: Transform, data: { pos: [0, HIDDEN_Y, 0], scale: [1, 1, 1] } },
        { component: MeshFilter, data: { assetHandle: handle } },
        { component: MeshRenderer, data: { materials: [material] } },
      )
      .unwrap();
  }

  private hide(entity: EntityHandle): void {
    this.world.set(entity, Transform, { pos: [0, HIDDEN_Y, 0] }).unwrap();
  }

  update(input: PortViewInput): void {
    const partsById = new Map<number, MechanicalPart>();
    for (const part of input.parts) partsById.set(part.id, part);
    this.updateBoxes(partsById, input.ports);
    this.updateCables(partsById, input.links);
    this.updateMarker(partsById, input.armed);
  }

  /** 建链时选中的源头端口：绿色小方块浮在接口上方。 */
  private updateMarker(
    partsById: ReadonlyMap<number, MechanicalPart>,
    armed: PortViewInput['armed'],
  ): void {
    if (!armed) {
      this.hide(this.marker);
      return;
    }
    const part = partsById.get(armed.partId);
    const slot = part ? this.findSlot(part, armed.slotId) : undefined;
    if (!part || !slot) {
      this.hide(this.marker);
      return;
    }
    this.world.set(this.marker, Transform, {
      pos: [slot.center[0], slot.center[1] + MARKER_Y_OFFSET, slot.center[2]],
      scale: [1, 1, 1],
    }).unwrap();
  }

  private updateBoxes(partsById: ReadonlyMap<number, MechanicalPart>, ports: readonly InstalledPort[]): void {
    const alive = new Set<string>();
    for (const port of ports) {
      const part = partsById.get(port.partId);
      if (!part) continue;
      const key = `${port.partId}:${port.slot.id}`;
      alive.add(key);
      let view = this.boxes.get(key);
      if (!view) {
        view = {
          body: this.spy(this.assets.bodyMesh, this.assets.bodyMaterial),
          accent: this.spy(this.assets.accentMesh, accentMaterialOf(this.assets, port)),
        };
        this.boxes.set(key, view);
        console.log('PORTVIEW-SPAWN ' + key + ' module=' + port.module.id);
      }
      const slot = slotWorldOf(part, port.slot);
      const rotation = quatTuple(quat.fromAxisAngle(quat.create(), [0, 1, 0], slot.yaw * (Math.PI / 180)));
      this.world.set(view.body, Transform, {
        pos: [slot.center[0], slot.center[1], slot.center[2]],
        quat: rotation,
        scale: [1, 1, 1],
      }).unwrap();
      this.world.set(view.accent, Transform, {
        pos: [
          slot.center[0] + slot.outward[0] * 0.19,
          slot.center[1] + slot.outward[1] * 0.19,
          slot.center[2] + slot.outward[2] * 0.19,
        ],
        quat: rotation,
        scale: [1, 1, 1],
      }).unwrap();
    }
    for (const [key, view] of [...this.boxes]) {
      if (alive.has(key)) continue;
      this.boxes.delete(key);
      console.log('PORTVIEW-DESPAWN ' + key);
      this.world.despawn(view.body).unwrap();
      this.world.despawn(view.accent).unwrap();
    }
  }

  /** 用端口世界锚点把连接画成一根细管；同一对锚点（对接）也保留一小段可见铜管。 */
  private updateCables(partsById: ReadonlyMap<number, MechanicalPart>, links: readonly MaterialLinkSnapshot[]): void {
    const alive = new Set<string>();
    for (const link of links) {
      const fromPart = partsById.get(link.from.entityId);
      const toPart = partsById.get(link.to.entityId);
      if (!fromPart || !toPart) continue;
      const fromCore = this.findSlot(fromPart, link.from.slotId);
      const toCore = this.findSlot(toPart, link.to.slotId);
      if (!fromCore || !toCore) continue;
      alive.add(link.id);
      let cable = this.cables.get(link.id);
      if (!cable) {
        cable = this.spy(
          this.assets.cableMesh,
          link.active ? this.assets.cableActiveMaterial : this.assets.cableInactiveMaterial,
        );
        this.cables.set(link.id, cable);
      }
      const a = fromCore.anchor;
      const b = toCore.anchor;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const length = Math.hypot(dx, dy, dz);
      const scale = Math.max(length, CABLE_MIN_LENGTH);
      const ix = length > 1e-6 ? dx / length : 1;
      const iy = length > 1e-6 ? dy / length : 0;
      const iz = length > 1e-6 ? dz / length : 0;
      const rotation = quatTuple(quat.fromUnitVectors(quat.create(), [1, 0, 0], [ix, iy, iz]));
      this.world.set(cable, Transform, {
        pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
        quat: rotation,
        scale: [scale, CABLE_THICKNESS, CABLE_THICKNESS],
      }).unwrap();
    }
    for (const [id, cable] of [...this.cables]) {
      if (alive.has(id)) continue;
      this.cables.delete(id);
      this.world.despawn(cable).unwrap();
    }
  }

  private findSlot(part: MechanicalPart, slotId: PortSlotId): SlotWorld | undefined {
    const core = coreForPart(part.def.id);
    const slot = core?.portSlots.find((entry) => entry.id === slotId);
    if (!slot) return undefined;
    return slotWorldOf(part, slot);
  }
}
