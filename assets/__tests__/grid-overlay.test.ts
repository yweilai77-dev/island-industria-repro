import { describe, expect, it } from 'vitest';
import {
  BUILD_AREA_MAX_CELL,
  BUILD_AREA_MIN_CELL,
  GRID_LINE_COUNT,
  GRID_LINE_Y,
  buildAreaCellAt,
  buildGridLinePositions,
  intersectGroundPlane,
  isBuildAreaCell,
} from '../grid/grid-overlay.ts';

describe('grid overlay geometry', () => {
  it('builds a 21x21 line lattice covering the 20m ground', () => {
    const positions = buildGridLinePositions();
    // 21 条 X 向 + 21 条 Z 向，每条 2 顶点，每顶点 3 float
    expect(positions).toHaveLength(GRID_LINE_COUNT * 2 * 2 * 3);
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < positions.length; index += 3) {
      expect(positions[index + 1]).toBeCloseTo(GRID_LINE_Y, 9);
      min = Math.min(min, positions[index] as number, positions[index + 2] as number);
      max = Math.max(max, positions[index] as number, positions[index + 2] as number);
    }
    expect(min).toBe(-10);
    expect(max).toBe(10);
  });

  it('keeps grid lines in world space (independent of any camera)', () => {
    const a = buildGridLinePositions();
    const b = buildGridLinePositions();
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('ground ray intersection', () => {
  it('hits the plane for a downward ray', () => {
    // 从 (1, 5, 2) 垂直向下
    const hit = intersectGroundPlane([1, 5, 2, 0, -1, 0]);
    expect(hit).toBeDefined();
    expect(hit?.x).toBeCloseTo(1, 9);
    expect(hit?.z).toBeCloseTo(2, 9);
  });

  it('hits at an angle', () => {
    // 方向 (0, -0.5, -0.5) 已归一化；从 (0, 5, 5) 出发应落到 z = 0
    const inv = 1 / Math.SQRT2;
    const hit = intersectGroundPlane([0, 5, 5, 0, -inv, -inv]);
    expect(hit?.x).toBeCloseTo(0, 6);
    expect(hit?.z).toBeCloseTo(0, 6);
  });

  it('rejects parallel, upward and behind rays', () => {
    expect(intersectGroundPlane([0, 5, 0, 1, 0, 0])).toBeUndefined();
    expect(intersectGroundPlane([0, 5, 0, 0, 1, 0])).toBeUndefined();
    // 从地面下方朝下：t < 0
    expect(intersectGroundPlane([0, -1, 0, 0, -1, 0])).toBeUndefined();
  });
});

describe('build area bounds', () => {
  it('accepts cells -10..9 and rejects outside', () => {
    expect(isBuildAreaCell({ gx: BUILD_AREA_MIN_CELL, gz: BUILD_AREA_MIN_CELL })).toBe(true);
    expect(isBuildAreaCell({ gx: BUILD_AREA_MAX_CELL, gz: BUILD_AREA_MAX_CELL })).toBe(true);
    expect(isBuildAreaCell({ gx: BUILD_AREA_MAX_CELL + 1, gz: 0 })).toBe(false);
    expect(isBuildAreaCell({ gx: 0, gz: BUILD_AREA_MIN_CELL - 1 })).toBe(false);
  });

  it('maps world points to build-area cells with half-open bounds', () => {
    expect(buildAreaCellAt(0, 0)).toEqual({ gx: 0, gz: 0 });
    expect(buildAreaCellAt(0.999, 0.999)).toEqual({ gx: 0, gz: 0 });
    expect(buildAreaCellAt(1, 1)).toEqual({ gx: 1, gz: 1 });
    expect(buildAreaCellAt(-10, -10)).toEqual({ gx: -10, gz: -10 });
    // 地面之外（x = 10 正好在地面边缘线上，属于格 10 → 不可建造）
    expect(buildAreaCellAt(10, 0)).toBeUndefined();
    expect(buildAreaCellAt(-10.5, 0)).toBeUndefined();
  });
});
