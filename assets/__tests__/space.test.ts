import { describe, expect, it } from 'vitest';
import { createPlacement, placementCenter } from '../grid/grid.ts';
import {
  STANDARD_LEVEL_HEIGHT,
  aabbIntersects,
  assertValidLevel,
  cellKey3,
  levelBaseY,
  levelsForSpan,
  normalizeLevel,
  placementAabb,
  placementBaseY,
  worldYToLevel,
} from '../spatial/space.ts';

describe('Level validation', () => {
  it('accepts non-negative integers, including many levels and high levels', () => {
    for (const level of [0, 1, 2, 3, 100]) {
      expect(() => assertValidLevel(level)).not.toThrow();
      expect(levelBaseY(level)).toBe(level * STANDARD_LEVEL_HEIGHT);
    }
  });

  it('rejects negative, fractional, NaN and infinite levels', () => {
    for (const value of [-1, -3, 1.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => assertValidLevel(value)).toThrow(RangeError);
    }
  });

  it('treats missing level as legacy level 0 but rejects explicit invalid values', () => {
    expect(normalizeLevel(undefined)).toBe(0);
    expect(normalizeLevel(null)).toBe(0);
    expect(normalizeLevel(2)).toBe(2);
    expect(() => normalizeLevel(Number.NaN)).toThrow(RangeError);
    expect(() => normalizeLevel(1.5)).toThrow(RangeError);
    expect(placementBaseY({ level: undefined })).toBe(0);
    expect(placementBaseY({ level: 2 })).toBe(6);
  });

  it('treats omitted createPlacement level as legacy level 0', () => {
    expect(createPlacement(1, 2, 1, 1).level).toBe(0);
  });

  it('exposes 3D cell keys and Level ↔ world Y mapping', () => {
    expect(cellKey3({ gx: 2, gz: -3 }, 0)).toBe('2,-3,0');
    expect(cellKey3({ gx: 2, gz: -3 }, 3)).toBe('2,-3,3');
    expect(worldYToLevel(0)).toBe(0);
    expect(worldYToLevel(2.999)).toBe(0);
    expect(worldYToLevel(3)).toBe(1);
    expect(worldYToLevel(10)).toBe(3);
    expect(() => worldYToLevel(-1)).toThrow(RangeError);
    expect(() => worldYToLevel(Number.NaN)).toThrow(RangeError);
  });

  it('rejects invalid levels at createPlacement entry', () => {
    expect(() => createPlacement(0, 0, 1, 1, 0, -1)).toThrow(RangeError);
    expect(() => createPlacement(0, 0, 1, 1, 0, 1.5)).toThrow(RangeError);
    expect(() => createPlacement(0, 0, 1, 1, 0, Number.NaN)).toThrow(RangeError);
    expect(() => createPlacement(0, 0, 1, 1, 0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('Placement level and world height', () => {
  it('keeps level 0 behavior identical to the old 2D placement', () => {
    const placement = createPlacement(2, 3, 2, 2);
    expect(placement.level).toBe(0);
    expect(placementCenter(placement)).toEqual([3, 0, 4]);
    expect(placementBaseY(placement)).toBe(0);
  });

  it('places higher levels at 3.0m intervals', () => {
    expect(placementCenter(createPlacement(2, 3, 2, 2, 0, 1))).toEqual([3, 3, 4]);
    expect(placementCenter(createPlacement(2, 3, 2, 2, 0, 2))).toEqual([3, 6, 4]);
    expect(placementBaseY(createPlacement(0, 0, 1, 1, 0, 5))).toBe(15);
  });

  it('builds a 3D AABB from level and height', () => {
    const aabb = placementAabb(createPlacement(2, 3, 2, 2, 0, 1), 1);
    expect(aabb.min).toEqual([2, 3, 3]);
    expect(aabb.max).toEqual([4, 4, 5]);
  });
});

describe('levelsForSpan and AABB', () => {
  it('maps vertical spans to the correct level slabs', () => {
    expect(levelsForSpan(0, 1)).toEqual([0]);
    expect(levelsForSpan(0, 3)).toEqual([0]);
    expect(levelsForSpan(0, 4)).toEqual([0, 1]);
    expect(levelsForSpan(3, 1)).toEqual([1]);
    expect(levelsForSpan(2.7, 0.3)).toEqual([0]);
    expect(levelsForSpan(0, 0)).toEqual([]);
    expect(() => levelsForSpan(-1, 1)).toThrow(RangeError);
    expect(() => levelsForSpan(0, -1)).toThrow(RangeError);
  });

  it('requires real 3D overlap, not merely equal levels', () => {
    const base = { min: [0, 0, 0] as const, max: [1, 1, 1] as const };
    expect(aabbIntersects(base, { min: [0.5, 0.5, 0.5], max: [1.5, 1.5, 1.5] })).toBe(true);
    // XZ 重叠但 Y 不重叠
    expect(aabbIntersects(base, { min: [0.5, 1, 0.5], max: [1.5, 2, 1.5] })).toBe(false);
    // 贴合不算重叠
    expect(aabbIntersects(base, { min: [1, 0, 0], max: [2, 1, 1] })).toBe(false);
    expect(aabbIntersects(base, { min: [0, 1, 0], max: [1, 2, 1] })).toBe(false);
  });
});