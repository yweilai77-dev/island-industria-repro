import { worldToCell, type Cell } from '../grid/grid.ts';
import { SPATIAL_EPS, type Level } from './space.ts';
import type { SupportRegistry } from './support.ts';

/** 当前光标对应的目标支撑面位置。 */
export interface SupportTarget {
  readonly cell: Cell;
  readonly level: Level;
  readonly baseY: number;
  readonly supportId: string;
}

/**
 * 射线与目标 Level 的水平支撑面求交。
 *
 * 规则：
 * - 拒绝平行射线（|dirY| < EPS）；
 * - 只接受正向交点 t > EPS；
 * - 不限制 dirY 的符号：允许向上或向下（建筑调整需要）；
 * - 交点必须落在该支撑面实际覆盖格；
 * - 复用 worldToCell 的 floor 取整；
 * - 取最近 t；同 t 时按 supportId 字典序稳定选择。
 */
export function pickSupportTarget(
  ray: ArrayLike<number>,
  level: Level,
  supports: SupportRegistry,
): SupportTarget | undefined {
  const originX = ray[0] as number;
  const originY = ray[1] as number;
  const originZ = ray[2] as number;
  const dirX = ray[3] as number;
  const dirY = ray[4] as number;
  const dirZ = ray[5] as number;
  if (![originX, originY, originZ, dirX, dirY, dirZ].every((value) => Number.isFinite(value))) {
    return undefined;
  }
  if (Math.abs(dirY) < SPATIAL_EPS) return undefined;

  let best: { target: SupportTarget; t: number } | undefined;
  for (const support of supports.all()) {
    if (!support.active || !support.buildable || support.level !== level) continue;
    const t = (support.worldY - originY) / dirY;
    if (!(t > SPATIAL_EPS)) continue;
    const x = originX + dirX * t;
    const z = originZ + dirZ * t;
    const cell = worldToCell(x, z);
    if (!support.cells.some((candidate) => candidate.gx === cell.gx && candidate.gz === cell.gz)) {
      continue;
    }
    const target: SupportTarget = {
      cell,
      level,
      baseY: support.worldY,
      supportId: support.id,
    };
    if (
      best === undefined
      || t < best.t - SPATIAL_EPS
      || (Math.abs(t - best.t) <= SPATIAL_EPS && support.id < best.target.supportId)
    ) {
      best = { target, t };
    }
  }
  return best?.target;
}
