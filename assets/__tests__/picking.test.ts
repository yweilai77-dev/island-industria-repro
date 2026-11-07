import { describe, expect, it } from 'vitest';
import { BUILD_AREA_MAX_CELL, BUILD_AREA_MIN_CELL } from '../grid/grid-overlay.ts';
import type { Cell } from '../grid/grid.ts';
import { pickSupportTarget } from '../spatial/picking.ts';
import { SupportRegistry, GROUND_SUPPORT_ID, type SupportSurface } from '../spatial/support.ts';
import { PLATFORM_SUPPORT } from '../spatial/structures.ts';

function createSupports(): SupportRegistry {
  const supports = new SupportRegistry();
  const cells: Cell[] = [];
  for (let gz = BUILD_AREA_MIN_CELL; gz <= BUILD_AREA_MAX_CELL; gz += 1) {
    for (let gx = BUILD_AREA_MIN_CELL; gx <= BUILD_AREA_MAX_CELL; gx += 1) {
      cells.push({ gx, gz });
    }
  }
  supports.register({
    id: GROUND_SUPPORT_ID,
    level: 0,
    worldY: 0,
    cells,
    kind: 'ground',
    buildable: true,
    walkable: true,
    active: true,
  });
  supports.register(PLATFORM_SUPPORT);
  return supports;
}

const DOWN = [0, -1, 0] as const;

describe('support target ray picking', () => {
  const supports = createSupports();

  it('picks a platform target from above', () => {
    const target = pickSupportTarget([0.5, 10, 3.5, ...DOWN], 1, supports);
    expect(target).toEqual({
      cell: { gx: 0, gz: 3 },
      level: 1,
      baseY: 3,
      supportId: PLATFORM_SUPPORT.id,
    });
  });

  it('picks a ground target at level 0', () => {
    const target = pickSupportTarget([2.5, 10, 2.5, ...DOWN], 0, supports);
    expect(target?.cell).toEqual({ gx: 2, gz: 2 });
    expect(target?.baseY).toBe(0);
    expect(target?.supportId).toBe(GROUND_SUPPORT_ID);
  });

  it('allows an upward ray for adjustment (positive t)', () => {
    const target = pickSupportTarget([0.5, 1, 3.5, 0, 1, 0], 1, supports);
    expect(target?.cell).toEqual({ gx: 0, gz: 3 });
    expect(target?.baseY).toBe(3);
  });

  it('rejects a parallel ray', () => {
    expect(pickSupportTarget([0.5, 10, 3.5, 0, 0, 1], 1, supports)).toBeUndefined();
  });

  it('rejects a backward intersection (t <= 0)', () => {
    expect(pickSupportTarget([0.5, 1, 3.5, 0, -1, 0], 1, supports)).toBeUndefined();
  });

  it('rejects a level 1 target outside the platform footprint', () => {
    expect(pickSupportTarget([9, 10, 5, ...DOWN], 1, supports)).toBeUndefined();
  });

  it('rejects a level 1 target with no support under the pointer', () => {
    expect(pickSupportTarget([-5.5, 10, 3.5, ...DOWN], 1, supports)).toBeUndefined();
  });

  it('uses worldToCell floor semantics at cell boundaries', () => {
    const target = pickSupportTarget([1.0, 10, 3.0, ...DOWN], 1, supports);
    expect(target?.cell).toEqual({ gx: 1, gz: 3 });
    const maxEdge = pickSupportTarget([7.999, 10, 7.999, ...DOWN], 1, supports);
    expect(maxEdge?.cell).toEqual({ gx: 7, gz: 7 });
  });

  it('filters inactive and non-buildable supports', () => {
    const local = createSupports();
    const inactive: SupportSurface = {
      id: 'inactive', level: 1, worldY: 3, cells: [{ gx: 0, gz: 3 }],
      kind: 'platform', buildable: true, walkable: true, active: false,
    };
    const nonBuildable: SupportSurface = {
      id: 'non-buildable', level: 1, worldY: 3, cells: [{ gx: 0, gz: 3 }],
      kind: 'platform', buildable: false, walkable: true, active: true,
    };
    local.register(inactive);
    local.register(nonBuildable);
    expect(pickSupportTarget([0.5, 10, 3.5, ...DOWN], 1, local)?.supportId)
      .toBe(PLATFORM_SUPPORT.id);
  });

  it('ties equal intersections by supportId', () => {
    const local = createSupports();
    local.register({
      id: 'z-support', level: 1, worldY: 3, cells: [{ gx: 0, gz: 3 }],
      kind: 'platform', buildable: true, walkable: true, active: true,
    });
    local.register({
      id: 'a-support', level: 1, worldY: 3, cells: [{ gx: 0, gz: 3 }],
      kind: 'platform', buildable: true, walkable: true, active: true,
    });
    expect(pickSupportTarget([0.5, 10, 3.5, ...DOWN], 1, local)?.supportId).toBe('a-support');
  });
});
