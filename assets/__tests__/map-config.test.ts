import { describe, expect, it } from 'vitest';
import {
  MAP_CONFIG,
  createMapConfig,
  type MapConfigInput,
} from '../world/map-config.ts';

const BASE_INPUT: MapConfigInput = { id: 'test-map', widthCells: 32, depthCells: 32 };

function configWith(overrides: Partial<MapConfigInput>): MapConfigInput {
  return { ...BASE_INPUT, ...overrides };
}

describe('MAP_CONFIG 32x32 literals', () => {
  it('locks the production map size and origin-centered cell range', () => {
    expect(MAP_CONFIG.id).toBe('island-main');
    expect(MAP_CONFIG.widthCells).toBe(32);
    expect(MAP_CONFIG.depthCells).toBe(32);
    expect(MAP_CONFIG.cellSize).toBe(1);
    expect(MAP_CONFIG.cellCount).toBe(1024);
    expect(MAP_CONFIG.halfWidth).toBe(16);
    expect(MAP_CONFIG.halfDepth).toBe(16);
    expect(MAP_CONFIG.worldMinX).toBe(-16);
    expect(MAP_CONFIG.worldMaxX).toBe(16);
    expect(MAP_CONFIG.worldMinZ).toBe(-16);
    expect(MAP_CONFIG.worldMaxZ).toBe(16);
    expect(MAP_CONFIG.minCellX).toBe(-16);
    expect(MAP_CONFIG.maxCellX).toBe(15);
    expect(MAP_CONFIG.minCellZ).toBe(-16);
    expect(MAP_CONFIG.maxCellZ).toBe(15);
  });

  it('derives player bounds, grid counts and ground geometry', () => {
    expect(MAP_CONFIG.playerMargin).toBe(0.5);
    expect(MAP_CONFIG.playerBoundsX).toBe(15.5);
    expect(MAP_CONFIG.playerBoundsZ).toBe(15.5);
    expect(MAP_CONFIG.gridLineCountX).toBe(33);
    expect(MAP_CONFIG.gridLineCountZ).toBe(33);
    expect(MAP_CONFIG.groundTopY).toBe(0);
    expect(MAP_CONFIG.groundThickness).toBe(0.2);
    expect(MAP_CONFIG.groundSizeX).toBe(32);
    expect(MAP_CONFIG.groundSizeZ).toBe(32);
    expect(MAP_CONFIG.groundCenterY).toBe(-0.1);
  });

  it('freezes the config object', () => {
    expect(Object.isFrozen(MAP_CONFIG)).toBe(true);
    expect(() => {
      (MAP_CONFIG as unknown as { widthCells: number }).widthCells = 20;
    }).toThrow(TypeError);
  });
});

describe('map cell enumeration', () => {
  it('enumerates 1024 unique frozen row-major cells', () => {
    const cells = MAP_CONFIG.cells();
    expect(cells).toHaveLength(1024);
    expect(cells[0]).toEqual({ gx: -16, gz: -16 });
    expect(cells[1]).toEqual({ gx: -15, gz: -16 }); // 行优先：先 gx
    expect(cells.at(-1)).toEqual({ gx: 15, gz: 15 });
    expect(new Set(cells.map((cell) => `${cell.gx},${cell.gz}`)).size).toBe(1024);
    expect(Object.isFrozen(cells)).toBe(true);
    expect(cells.every((cell) => Object.isFrozen(cell))).toBe(true);
    const mutable = cells as unknown as Array<{ gx: number; gz: number }>;
    expect(() => mutable.push({ gx: 0, gz: 0 })).toThrow(TypeError);
    expect(() => {
      mutable[0]!.gx = 99;
    }).toThrow(TypeError);
  });

  it('returns the same frozen cell list on every call', () => {
    expect(MAP_CONFIG.cells()).toBe(MAP_CONFIG.cells());
  });

  it('checks cells with closed bounds -16..15 plus integer validation', () => {
    expect(MAP_CONFIG.containsCell({ gx: -16, gz: -16 })).toBe(true);
    expect(MAP_CONFIG.containsCell({ gx: 15, gz: 15 })).toBe(true);
    expect(MAP_CONFIG.containsCell({ gx: -16, gz: 15 })).toBe(true);
    expect(MAP_CONFIG.containsCell({ gx: 15, gz: -16 })).toBe(true);
    expect(MAP_CONFIG.containsCell({ gx: 16, gz: 0 })).toBe(false);
    expect(MAP_CONFIG.containsCell({ gx: -17, gz: 0 })).toBe(false);
    expect(MAP_CONFIG.containsCell({ gx: 0, gz: 16 })).toBe(false);
    expect(MAP_CONFIG.containsCell({ gx: 0, gz: -17 })).toBe(false);
    expect(MAP_CONFIG.containsCell({ gx: 0.5, gz: 0 })).toBe(false);
    expect(MAP_CONFIG.containsCell({ gx: 0, gz: 0.5 })).toBe(false);
    expect(MAP_CONFIG.containsCell({ gx: Number.NaN, gz: 0 })).toBe(false);
  });

  it('maps world points to cells with half-open world bounds', () => {
    expect(MAP_CONFIG.buildAreaCellAt(0, 0)).toEqual({ gx: 0, gz: 0 });
    expect(MAP_CONFIG.buildAreaCellAt(0.999, 0.999)).toEqual({ gx: 0, gz: 0 });
    expect(MAP_CONFIG.buildAreaCellAt(1, 1)).toEqual({ gx: 1, gz: 1 });
    expect(MAP_CONFIG.buildAreaCellAt(-16, -16)).toEqual({ gx: -16, gz: -16 });
    expect(MAP_CONFIG.buildAreaCellAt(15.999, 15.999)).toEqual({ gx: 15, gz: 15 });
    expect(MAP_CONFIG.buildAreaCellAt(16, 0)).toBeUndefined();
    expect(MAP_CONFIG.buildAreaCellAt(0, 16)).toBeUndefined();
    expect(MAP_CONFIG.buildAreaCellAt(-16.5, 0)).toBeUndefined();
    expect(MAP_CONFIG.buildAreaCellAt(0, -16.5)).toBeUndefined();
    expect(() => MAP_CONFIG.buildAreaCellAt(Number.NaN, 0)).toThrow(RangeError);
    expect(() => MAP_CONFIG.buildAreaCellAt(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('rectangular createMapConfig(32, 48)', () => {
  const map = createMapConfig({ id: 'rect', widthCells: 32, depthCells: 48 });

  it('keeps X at 32 cells and extends Z to -24..23', () => {
    expect(map.widthCells).toBe(32);
    expect(map.depthCells).toBe(48);
    expect(map.halfWidth).toBe(16);
    expect(map.halfDepth).toBe(24);
    expect(map.minCellX).toBe(-16);
    expect(map.maxCellX).toBe(15);
    expect(map.minCellZ).toBe(-24);
    expect(map.maxCellZ).toBe(23);
    expect(map.worldMinX).toBe(-16);
    expect(map.worldMaxX).toBe(16);
    expect(map.worldMinZ).toBe(-24);
    expect(map.worldMaxZ).toBe(24);
    expect(map.playerBoundsX).toBe(15.5);
    expect(map.playerBoundsZ).toBe(23.5);
    expect(map.gridLineCountX).toBe(33);
    expect(map.gridLineCountZ).toBe(49);
    expect(map.groundSizeX).toBe(32);
    expect(map.groundSizeZ).toBe(48);
    expect(map.cellCount).toBe(1536);
    expect(map.cells()).toHaveLength(1536);
  });

  it('applies the rectangular Z bounds to queries', () => {
    expect(map.containsCell({ gx: 0, gz: -24 })).toBe(true);
    expect(map.containsCell({ gx: 0, gz: 23 })).toBe(true);
    expect(map.containsCell({ gx: 0, gz: 24 })).toBe(false);
    expect(map.containsCell({ gx: 0, gz: -25 })).toBe(false);
    expect(map.buildAreaCellAt(0, 23.5)).toEqual({ gx: 0, gz: 23 });
    expect(map.buildAreaCellAt(0, -24)).toEqual({ gx: 0, gz: -24 });
    expect(map.buildAreaCellAt(0, 24)).toBeUndefined();
    expect(map.buildAreaCellAt(0, -24.5)).toBeUndefined();
  });
});

describe('createMapConfig validation', () => {
  it('rejects odd, zero, negative, NaN and infinite cell counts', () => {
    for (const widthCells of [31, 0, -32, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createMapConfig(configWith({ widthCells }))).toThrow(RangeError);
    }
    for (const depthCells of [31, 0, -32, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => createMapConfig(configWith({ depthCells }))).toThrow(RangeError);
    }
  });

  it('rejects a player margin outside (0, 1)', () => {
    for (const playerMargin of [0, 1, -0.25, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createMapConfig(configWith({ playerMargin }))).toThrow(RangeError);
    }
  });

  it('rejects non-positive or non-finite ground thickness and height', () => {
    for (const groundThickness of [0, -0.2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createMapConfig(configWith({ groundThickness }))).toThrow(RangeError);
    }
    for (const groundTopY of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createMapConfig(configWith({ groundTopY }))).toThrow(RangeError);
    }
  });

  it('rejects a missing or empty id', () => {
    expect(() => createMapConfig(configWith({ id: '' }))).toThrow(RangeError);
    expect(() => createMapConfig(configWith({ id: 123 as unknown as string }))).toThrow(RangeError);
  });
});
