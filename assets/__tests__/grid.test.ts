import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE,
  GRID_PLANE_Y,
  cellKey,
  cellToCenter,
  cellToMinCorner,
  cellsOf,
  createPlacement,
  isCellInside,
  isRotation,
  normalizeRotation,
  placementBounds,
  placementCenter,
  rotatePlacement,
  worldExtent,
  worldToCell,
  withRotation,
} from '../grid/grid.ts';

describe('build grid coordinates', () => {
  it('maps world positions to half-open integer cells', () => {
    expect(worldToCell(0, 0)).toEqual({ gx: 0, gz: 0 });
    expect(worldToCell(0.999, 0.999)).toEqual({ gx: 0, gz: 0 });
    // 半开区间：正好在格线上属于 +1 那一格
    expect(worldToCell(1, 1)).toEqual({ gx: 1, gz: 1 });
    expect(worldToCell(-0.001, -0.001)).toEqual({ gx: -1, gz: -1 });
    expect(worldToCell(-1, 0)).toEqual({ gx: -1, gz: 0 });
  });

  it('round-trips cell corners and centers', () => {
    expect(cellToMinCorner({ gx: 2, gz: 3 })).toEqual([2 * CELL_SIZE, GRID_PLANE_Y, 3 * CELL_SIZE]);
    expect(cellToCenter({ gx: 2, gz: 3 })).toEqual([2.5, GRID_PLANE_Y, 3.5]);
    const center = cellToCenter({ gx: -2, gz: -3 });
    expect(worldToCell(center[0], center[2])).toEqual({ gx: -2, gz: -3 });
  });

  it('keeps cell keys unique per cell', () => {
    expect(cellKey({ gx: 0, gz: 0 })).toBe('0,0');
    expect(cellKey({ gx: -1, gz: 2 })).toBe('-1,2');
    expect(cellKey({ gx: 0, gz: 0 })).not.toBe(cellKey({ gx: 0, gz: 1 }));
  });

  it('rejects non-integer anchors and invalid footprints', () => {
    expect(() => createPlacement(0.5, 0, 1, 1)).toThrow(RangeError);
    expect(() => createPlacement(0, 0, 0, 1)).toThrow(RangeError);
    expect(() => createPlacement(0, 0, 1, -1)).toThrow(RangeError);
    expect(() => createPlacement(0, 0, 1.5, 1)).toThrow(RangeError);
  });
});

describe('placement anchor vs rotation', () => {
  it('derives world extent from local footprint and rotation', () => {
    const p = createPlacement(2, 3, 3, 2);
    expect(worldExtent(p)).toEqual({ w: 3, d: 2 });
    expect(worldExtent(withRotation(p, 90))).toEqual({ w: 2, d: 3 });
    expect(worldExtent(withRotation(p, 180))).toEqual({ w: 3, d: 2 });
    expect(worldExtent(withRotation(p, 270))).toEqual({ w: 2, d: 3 });
  });

  it('keeps the integer anchor fixed when rotating', () => {
    const p = createPlacement(-1, 0, 3, 2);
    for (const rotated of [
      rotatePlacement(p, 90),
      rotatePlacement(p, 180),
      rotatePlacement(p, 270),
      rotatePlacement(p, 360),
    ]) {
      expect(rotated.gx).toBe(-1);
      expect(rotated.gz).toBe(0);
      expect(Number.isInteger(rotated.gx)).toBe(true);
      expect(Number.isInteger(rotated.gz)).toBe(true);
      expect(rotated.w).toBe(3);
      expect(rotated.d).toBe(2);
    }
  });

  it('rotates four quarter turns back to the original direction', () => {
    const p = createPlacement(0, 0, 2, 2);
    const back = rotatePlacement(rotatePlacement(rotatePlacement(rotatePlacement(p, 90), 90), 90), 90);
    expect(back.rotation).toBe(p.rotation);
    expect(back).toEqual(p);
  });

  it('normalizes rotation values and rejects non-multiples of 90', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(isRotation(180)).toBe(true);
    expect(isRotation(45)).toBe(false);
    expect(() => normalizeRotation(45)).toThrow(RangeError);
    expect(() => withRotation(createPlacement(0, 0, 1, 1), 45 as never)).toThrow(RangeError);
  });
});

describe('odd and even footprints', () => {
  it('places a 3x2 footprint on integer cells with a derived half-cell center', () => {
    const p = createPlacement(-1, 0, 3, 2);
    expect(placementBounds(p)).toEqual({ minX: -1, maxX: 2, minZ: 0, maxZ: 2 });
    expect(placementCenter(p)).toEqual([0.5, GRID_PLANE_Y, 1]);
    expect(cellsOf(p)).toHaveLength(6);
  });

  it('places a 2x2 footprint with an integer center on cell boundaries', () => {
    const p = createPlacement(2, 3, 2, 2);
    expect(placementBounds(p)).toEqual({ minX: 2, maxX: 4, minZ: 3, maxZ: 5 });
    expect(placementCenter(p)).toEqual([3, GRID_PLANE_Y, 4]);
    // 偶数尺寸的中心落在格线上，因此不能用中心反推锚点
    expect(worldToCell(3, 4)).toEqual({ gx: 3, gz: 4 });
  });

  it('enumerates distinct cells for every footprint size', () => {
    for (const [w, d] of [[1, 1], [2, 2], [3, 2], [4, 3]] as const) {
      const cells = cellsOf(createPlacement(0, 0, w, d));
      expect(cells).toHaveLength(w * d);
      expect(new Set(cells.map(cellKey)).size).toBe(w * d);
    }
  });

  it('occupies swapped cells when rotated 90 degrees', () => {
    const p = createPlacement(0, 0, 3, 2);
    const rotated = rotatePlacement(p, 90);
    expect(placementBounds(rotated)).toEqual({ minX: 0, maxX: 2, minZ: 0, maxZ: 3 });
    expect(cellsOf(rotated)).toHaveLength(6);
    // 旋转前后占地格集合不同（默认绕锚点转）
    expect(cellsOf(p).map(cellKey)).not.toEqual(cellsOf(rotated).map(cellKey));
  });

  it('checks cell membership with half-open bounds', () => {
    const bounds = placementBounds(createPlacement(0, 0, 2, 2));
    expect(isCellInside({ gx: 0, gz: 0 }, bounds)).toBe(true);
    expect(isCellInside({ gx: 1, gz: 1 }, bounds)).toBe(true);
    expect(isCellInside({ gx: 2, gz: 1 }, bounds)).toBe(false);
  });
});
