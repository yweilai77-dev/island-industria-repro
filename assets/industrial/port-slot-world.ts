import type { Face, MechanicalPart, PartPortDef } from '../mechanical/parts.ts';
import { portWorld, rotateY } from '../mechanical/ports.ts';
import type { PortSlotDef } from './processing-core.ts';
import type { PortSlotId } from './ids.ts';

/**
 * P2-B 安装位的**世界空间**表达（纯函数、零引擎依赖）。
 *
 * 关键设计：安装位的位置/朝向**不另写一套几何**，而是复用机械端口那套派生逻辑
 * （`mechanical/ports.ts` 的 `portWorld`）。做法是把安装位包成一个没有传动语义的
 * `PartPortDef` 再交给 `portWorld`——这样「面 + 本地格 + 本地高度 + Placement 旋转」
 * 的换算永远和机械端口一致，不会出现两套坐标约定漂移。
 *
 * 旋转的核心保证：`slotWorldOf` 只依赖 `part.placement`，所以机器被旋转/搬动后，
 * 安装位与已装接口盒的世界位置会跟着正确更新（视图每帧重算，不缓存旧坐标）。
 */

/** 安装盒从机器表面向外突出的距离（米）。视图与锚点共用。 */
export const MOUNT_OFFSET = 0.07;

/** 六个面的本地外法线。 */
const FACE_NORMAL: Readonly<Record<Face, readonly [number, number, number]>> = Object.freeze({
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  py: [0, 1, 0],
  ny: [0, -1, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1],
});

/** 安装位的世界表达。 */
export interface SlotWorld {
  readonly slotId: PortSlotId;
  /** 表面中心（机器表面上的锚点）。 */
  readonly anchor: readonly [number, number, number];
  /** 面外法线（世界坐标，已含旋转）。 */
  readonly outward: readonly [number, number, number];
  /** 安装盒中心（锚点沿法线外移 MOUNT_OFFSET）。 */
  readonly center: readonly [number, number, number];
  /** 机器朝向（度）。接口盒视图用它对齐。 */
  readonly yaw: number;
}

/** 把安装位包装成最小端口定义，复用 mechanical/ports.ts 的世界坐标换算。 */
export function slotPortOf(slot: PortSlotDef): PartPortDef {
  return {
    id: slot.id,
    // role 取 'axial' 只是为了让 PartPortDef 类型成立；本函数不做传动匹配。
    role: 'axial',
    axis: 'x',
    face: slot.face,
    localCell: slot.localCell,
    localY: slot.localY,
  };
}

/** 把浮点噪声收敛掉（旋转 90° 时 sin/cos 会留下 1e-17 量级残差）。 */
function clean(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : value;
}

/** 安装位的世界锚点、法线与朝向；随 Placement 旋转自动改变。 */
export function slotWorldOf(part: MechanicalPart, slot: PortSlotDef): SlotWorld {
  const world = portWorld(part, slotPortOf(slot));
  const normal = world.normal;
  const anchor: readonly [number, number, number] = [
    clean(world.anchor[0]),
    clean(world.anchor[1]),
    clean(world.anchor[2]),
  ];
  const outward: readonly [number, number, number] = [
    clean(normal[0]),
    clean(normal[1]),
    clean(normal[2]),
  ];
  return {
    slotId: slot.id,
    anchor,
    outward,
    center: [
      clean(anchor[0] + outward[0] * MOUNT_OFFSET),
      clean(anchor[1] + outward[1] * MOUNT_OFFSET),
      clean(anchor[2] + outward[2] * MOUNT_OFFSET),
    ],
    yaw: part.placement.rotation,
  };
}

/**
 * 物料要进入该安装位时的**水平运动方向**（世界坐标）。
 * 例：输入位在 `nz`、机器 rotation = 0 时，物料必须沿 +Z 走（溜槽朝 +Z 推料）。
 * 竖直面（py/ny）返回 {0,0}，本阶段的数据里不会出现。
 */
export function incomingDirectionOf(
  slot: PortSlotDef,
  rotation: number,
): { readonly dx: number; readonly dz: number } {
  const normal = FACE_NORMAL[slot.face];
  const radians = (rotation * Math.PI) / 180;
  const [nx, nz] = rotateY(normal[0], normal[2], radians);
  // `0 - x` 而不是 `-x`：避免负零（-0），让方向比较与快照输出都稳定。
  return { dx: 0 - Math.round(nx), dz: 0 - Math.round(nz) };
}

/** 给定溜槽的输送方向，判断它是否正好从该安装位的面外侧推入。 */
export function feedsSlotFrom(
  slot: PortSlotDef,
  rotation: number,
  direction: { readonly dx: number; readonly dz: number },
): boolean {
  const incoming = incomingDirectionOf(slot, rotation);
  if (incoming.dx === 0 && incoming.dz === 0) return false;
  return incoming.dx === direction.dx && incoming.dz === direction.dz;
}
