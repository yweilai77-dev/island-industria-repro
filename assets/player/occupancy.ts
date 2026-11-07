import type { Aabb } from '../spatial/space.ts';

/**
 * 玩家占用体与机械阻挡的共享几何。
 *
 * M1.7-A 统一规则：
 * - 玩家 = 水平半宽 0.35m、高度 1.0m 的 AABB；
 * - 机械放置不能与玩家 AABB 相交；
 * - 机械零件注册 blocksPlayer=true；玩家移动用“扫掠线段 vs 扩展 AABB”判断，
 *   不重写 vertical.ts 的支撑/楼梯解析。
 */
export const PLAYER_HALF_EXTENT = 0.35;
export const PLAYER_HEIGHT = 1.0;

/** 玩家脚底在 (x, feetY, z) 时的三维 AABB。 */
export function playerAabb(x: number, feetY: number, z: number): Aabb {
  return {
    min: [x - PLAYER_HALF_EXTENT, feetY, z - PLAYER_HALF_EXTENT],
    max: [x + PLAYER_HALF_EXTENT, feetY + PLAYER_HEIGHT, z + PLAYER_HALF_EXTENT],
  };
}

/** 线段是否与 XZ 矩形相交（Liang-Barsky）。 */
export function segmentIntersectsRectXZ(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): boolean {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  let tMin = 0;
  let tMax = 1;
  const constraints: readonly (readonly [number, number])[] = [
    [-dx, fromX - minX],
    [dx, maxX - fromX],
    [-dz, fromZ - minZ],
    [dz, maxZ - fromZ],
  ];
  for (const [p, q] of constraints) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > tMin) tMin = t;
    } else if (t < tMax) {
      tMax = t;
    }
    if (tMin > tMax) return false;
  }
  return true;
}

/**
 * 玩家从 (fromX,fromZ) 移动到 (toX,toZ)、脚底高度范围 [yMin,yMax] 时，
 * 是否会被一个 blocksPlayer 的机械/结构 AABB 挡住。
 * 把机械 AABB 在 XZ 上按玩家半宽膨胀，等价于玩家 AABB 的扫掠体。
 */
export function blocksPlayerMove(
  collider: Aabb,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  yMin: number,
  yMax: number,
): boolean {
  const top = yMax + PLAYER_HEIGHT;
  if (!(collider.max[1] > yMin && collider.min[1] < top)) return false;
  return segmentIntersectsRectXZ(
    fromX,
    fromZ,
    toX,
    toZ,
    (collider.min[0] as number) - PLAYER_HALF_EXTENT,
    (collider.max[0] as number) + PLAYER_HALF_EXTENT,
    (collider.min[2] as number) - PLAYER_HALF_EXTENT,
    (collider.max[2] as number) + PLAYER_HALF_EXTENT,
  );
}

/** 机械/结构 AABB 是否与玩家当前占用体重叠。 */
export function overlapsPlayer(
  collider: Aabb,
  x: number,
  feetY: number,
  z: number,
): boolean {
  const player = playerAabb(x, feetY, z);
  return collider.min[0] < player.max[0]
    && collider.max[0] > player.min[0]
    && collider.min[1] < player.max[1]
    && collider.max[1] > player.min[1]
    && collider.min[2] < player.max[2]
    && collider.max[2] > player.min[2];
}
