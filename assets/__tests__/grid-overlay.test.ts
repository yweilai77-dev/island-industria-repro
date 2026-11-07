import { describe, expect, it } from 'vitest';
import {
  BUILD_AREA_HALF_EXTENT,
  BUILD_AREA_MAX_CELL,
  BUILD_AREA_MIN_CELL,
  GRID_LINE_COUNT,
  GRID_LINE_COUNT_X,
  GRID_LINE_COUNT_Z,
  GRID_LINE_Y,
  buildAreaCellAt,
  buildGridLinePositions,
  intersectGroundPlane,
  isBuildAreaCell,
} from '../grid/grid-overlay.ts';

describe('grid overlay geometry', () => {
  it('builds a 33x33 line lattice covering the 32m ground', () => {
    const positions = buildGridLinePositions();
    // 33 条 X 向 + 33 条 Z 向，每条 2 顶点，每顶点 3 float → 396
    expect(positions).toHaveLength(396);
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < positions.length; index += 3) {
      expect(positions[index + 1]).toBeCloseTo(GRID_LINE_Y, 9);
      min = Math.min(min, positions[index] as number, positions[index + 2] as number);
      max = Math.max(max, positions[index] as number, positions[index + 2] as number);
    }
    expect(min).toBe(-16);
    expect(max).toBe(16);
  });

  it('derives line counts from half extents for rectangular maps', () => {
    // halfX=2 → 5 条平行 Z 的线；halfZ=3 → 7 条平行 X 的线 → 12 条线 / 72 float
    const positions = buildGridLinePositions(0.01, 2, 3);
    expect(positions).toHaveLength(72);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let index = 0; index < positions.length; index += 3) {
      minX = Math.min(minX, positions[index] as number);
      maxX = Math.max(maxX, positions[index] as number);
      minZ = Math.min(minZ, positions[index + 2] as number);
      maxZ = Math.max(maxZ, positions[index + 2] as number);
    }
    expect([minX, maxX, minZ, maxZ]).toEqual([-2, 2, -3, 3]);
  });

  it('rejects non-positive or non-finite half extents', () => {
    expect(() => buildGridLinePositions(0.01, 0, 3)).toThrow(RangeError);
    expect(() => buildGridLinePositions(0.01, 2, -1)).toThrow(RangeError);
    expect(() => buildGridLinePositions(0.01, Number.NaN, 3)).toThrow(RangeError);
    expect(() => buildGridLinePositions(0.01, 2, Number.POSITIVE_INFINITY)).toThrow(RangeError);
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
  it('exposes the 32m build area and 33 grid lines', () => {
    expect(BUILD_AREA_HALF_EXTENT).toBe(16);
    expect(BUILD_AREA_MIN_CELL).toBe(-16);
    expect(BUILD_AREA_MAX_CELL).toBe(15);
    expect(GRID_LINE_COUNT_X).toBe(33);
    expect(GRID_LINE_COUNT_Z).toBe(33);
    expect(GRID_LINE_COUNT).toBe(33);
  });

  it('accepts cells -16..15 and rejects outside', () => {
    expect(isBuildAreaCell({ gx: BUILD_AREA_MIN_CELL, gz: BUILD_AREA_MIN_CELL })).toBe(true);
    expect(isBuildAreaCell({ gx: BUILD_AREA_MAX_CELL, gz: BUILD_AREA_MAX_CELL })).toBe(true);
    expect(isBuildAreaCell({ gx: 16, gz: 0 })).toBe(false);
    expect(isBuildAreaCell({ gx: -17, gz: 0 })).toBe(false);
    expect(isBuildAreaCell({ gx: 0, gz: 16 })).toBe(false);
    expect(isBuildAreaCell({ gx: 0, gz: -17 })).toBe(false);
  });

  it('maps world points to build-area cells with half-open bounds', () => {
    expect(buildAreaCellAt(0, 0)).toEqual({ gx: 0, gz: 0 });
    expect(buildAreaCellAt(0.999, 0.999)).toEqual({ gx: 0, gz: 0 });
    expect(buildAreaCellAt(1, 1)).toEqual({ gx: 1, gz: 1 });
    expect(buildAreaCellAt(-16, -16)).toEqual({ gx: -16, gz: -16 });
    expect(buildAreaCellAt(15, 15)).toEqual({ gx: 15, gz: 15 });
    expect(buildAreaCellAt(15.999, 15.999)).toEqual({ gx: 15, gz: 15 });
    // 地面之外（世界 x = ±16 是地面边缘线，属于 ±16 那一格 → 不可建造）
    expect(buildAreaCellAt(16, 0)).toBeUndefined();
    expect(buildAreaCellAt(0, 16)).toBeUndefined();
    expect(buildAreaCellAt(-16.5, 0)).toBeUndefined();
    expect(buildAreaCellAt(0, -16.5)).toBeUndefined();
  });
});
