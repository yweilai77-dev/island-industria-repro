import { BUILD_AREA_MAX_CELL, BUILD_AREA_MIN_CELL } from '../grid/grid-overlay.ts';
import type { Cell, Placement } from '../grid/grid.ts';
import { SpatialIndex } from '../spatial/occupancy.ts';
import {
  levelBaseY,
  type Level,
} from '../spatial/space.ts';
import { SupportRegistry } from '../spatial/support.ts';
import { validatePlacement, type PlacementContext, type PlacementVerdict } from '../build/build.ts';

/** 测试用地面支撑：覆盖 MapConfig 派生的整个建造区（当前 32×32），level 0 / y=0。 */
export function createGroundSupports(): SupportRegistry {
  const supports = new SupportRegistry();
  const cells: Cell[] = [];
  for (let gz = BUILD_AREA_MIN_CELL; gz <= BUILD_AREA_MAX_CELL; gz += 1) {
    for (let gx = BUILD_AREA_MIN_CELL; gx <= BUILD_AREA_MAX_CELL; gx += 1) {
      cells.push({ gx, gz });
    }
  }
  supports.register({
    id: 'test:ground',
    level: 0,
    worldY: 0,
    cells,
    kind: 'ground',
    buildable: true,
    walkable: true,
    active: true,
  });
  return supports;
}

/** 注册一块标准层高的合成支撑面（测试 Level 2/3 架构用；不进入实际地图）。 */
export function addTestSupport(
  supports: SupportRegistry,
  id: string,
  level: Level,
  cells: readonly Cell[],
  buildable = true,
): void {
  supports.register({
    id,
    level,
    worldY: levelBaseY(level),
    cells,
    kind: 'platform',
    buildable,
    walkable: true,
    active: true,
  });
}

export interface TestPlacementWorld {
  readonly supports: SupportRegistry;
  readonly spatial: SpatialIndex;
  context(overrides?: Partial<PlacementContext>): PlacementContext;
  validate(placement: Placement, height?: number, overrides?: Partial<PlacementContext>): PlacementVerdict;
}

/** 测试用三维空间世界：地面支撑 + 空空间索引。 */
export function createTestWorld(playerCell: Cell = { gx: -9, gz: -9 }): TestPlacementWorld {
  const supports = createGroundSupports();
  const spatial = new SpatialIndex();
  const context = (overrides: Partial<PlacementContext> = {}): PlacementContext => ({
    spatial,
    supports,
    playerCell,
    playerFeetY: 0,
    ...overrides,
  });
  return {
    supports,
    spatial,
    context,
    validate: (placement, height = 1, overrides = {}) =>
      validatePlacement(placement, height, context(overrides)),
  };
}