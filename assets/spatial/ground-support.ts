import type { MapConfig } from '../world/map-config.ts';
import {
  GROUND_SUPPORT_ID,
  type SupportRegistry,
  type SupportSurface,
} from './support.ts';

/**
 * M1.6 Ground SupportSurface 的纯构造函数。
 *
 * 生产（spatial.pack.ts）与测试共用这一处，避免测试自建一份“看起来一样”的
 * 注册逻辑；地图格集合、地面高度都只从 MapConfig 读取。
 */
export function groundSupportSurface(config: MapConfig): SupportSurface {
  return {
    id: GROUND_SUPPORT_ID,
    level: 0,
    worldY: config.groundTopY,
    cells: config.cells(),
    kind: 'ground',
    buildable: true,
    walkable: true,
    active: true,
  };
}

/** 把完整地面注册进 SupportRegistry；返回注册后的 surface。 */
export function registerGroundSupport(
  supports: SupportRegistry,
  config: MapConfig,
): SupportSurface {
  const surface = groundSupportSurface(config);
  supports.register(surface);
  return surface;
}
