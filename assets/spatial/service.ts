import type { SpatialIndex } from './occupancy.ts';
import type { StructureRegistry } from './structure.ts';
import type { SupportRegistry, TraversalRegistry } from './support.ts';

/** 独立空间服务：由 spatial.pack.ts 创建，build 与固定结构插件共享。 */
export interface SpatialService {
  readonly supports: SupportRegistry;
  readonly traversals: TraversalRegistry;
  readonly index: SpatialIndex;
  readonly structures: StructureRegistry;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    spatial: SpatialService;
  }
}
