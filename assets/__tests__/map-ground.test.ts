import { describe, expect, it } from 'vitest';
import { cellKey, createPlacement } from '../grid/grid.ts';
import {
  groundSupportSurface,
  registerGroundSupport,
} from '../spatial/ground-support.ts';
import { SupportRegistry } from '../spatial/support.ts';
import {
  EDGE_TRIM,
  MAP_CONFIG,
  createMapConfig,
  edgeTrimBoxes,
} from '../world/map-config.ts';

/** 直接复用生产 spatial.pack.ts 的注册函数，避免测试复制一份注册逻辑。 */
function registerMapGround(): SupportRegistry {
  const supports = new SupportRegistry();
  registerGroundSupport(supports, MAP_CONFIG);
  return supports;
}

describe('ground SupportSurface from MAP_CONFIG.cells()', () => {
  it('registers one surface covering 1024 unique cells', () => {
    const supports = registerMapGround();
    expect(supports.size).toBe(1);

    const ground = groundSupportSurface(MAP_CONFIG);
    expect(supports.get(ground.id)).toEqual(ground);
    expect(supports.get('support:ground')).toBeDefined();
    expect(ground).toBeDefined();
    expect(ground.cells).toHaveLength(1024);
    expect(new Set(ground.cells.map(cellKey)).size).toBe(1024);

    expect(ground.level).toBe(0);
    expect(ground.worldY).toBe(0);
    expect(ground.kind).toBe('ground');
    expect(ground.buildable).toBe(true);
    expect(ground.walkable).toBe(true);
    expect(ground.active).toBe(true);
  });

  it('covers the four corners, four edge midpoints and the center', () => {
    const supports = registerMapGround();
    const corners = [
      { gx: -16, gz: -16 },
      { gx: 15, gz: -16 },
      { gx: -16, gz: 15 },
      { gx: 15, gz: 15 },
    ];
    for (const cell of corners) {
      expect(supports.supportAt(cell, 0)?.id).toBe('support:ground');
      expect(supports.buildableSupportAt(cell, 0, 0)?.id).toBe('support:ground');
    }
    const edgeMidpoints = [
      { gx: -16, gz: 0 },
      { gx: 15, gz: 0 },
      { gx: 0, gz: -16 },
      { gx: 0, gz: 15 },
    ];
    for (const cell of edgeMidpoints) {
      expect(supports.supportAt(cell, 0)?.id).toBe('support:ground');
    }
    expect(supports.supportAt({ gx: 0, gz: 0 }, 0)?.id).toBe('support:ground');
  });

  it('has no support at any cell outside -16..15 or at a different level', () => {
    const supports = registerMapGround();
    for (const cell of [
      { gx: 16, gz: 0 },
      { gx: -17, gz: 0 },
      { gx: 0, gz: 16 },
      { gx: 0, gz: -17 },
      { gx: 16, gz: 16 },
    ]) {
      expect(supports.supportAt(cell, 0)).toBeUndefined();
    }
    expect(supports.supportAt({ gx: 0, gz: 0 }, 1)).toBeUndefined();
  });

  it('accepts a full footprint inside the map and rejects one crossing +16', () => {
    const supports = registerMapGround();
    expect(supports.hasBuildableSupport(createPlacement(14, 14, 2, 2))).toBe(true);
    expect(supports.hasBuildableSupport(createPlacement(15, 15, 2, 2))).toBe(false);
    expect(supports.hasBuildableSupport(createPlacement(-16, -16, 2, 2))).toBe(true);
  });

  it('removes every cell on unregister', () => {
    const supports = registerMapGround();
    supports.unregister('support:ground');
    expect(supports.size).toBe(0);
    expect(supports.all()).toHaveLength(0);
    expect(supports.supportAt({ gx: 0, gz: 0 }, 0)).toBeUndefined();
    expect(supports.supportsAtPoint(0, 0)).toHaveLength(0);
  });
});

describe('edge trim boxes (visual only)', () => {
  it('locks the EDGE_TRIM literals', () => {
    expect(EDGE_TRIM.thickness).toBe(0.2);
    expect(EDGE_TRIM.aboveGround).toBe(0.25);
    expect(Object.isFrozen(EDGE_TRIM)).toBe(true);
  });

  it('lays four boxes flush with the 32m ground edge', () => {
    const boxes = edgeTrimBoxes(MAP_CONFIG);
    expect(boxes).toHaveLength(4);
    expect(boxes.map((box) => box.id)).toEqual(['north', 'south', 'west', 'east']);

    const north = boxes[0]!;
    const south = boxes[1]!;
    const west = boxes[2]!;
    const east = boxes[3]!;

    // 高 0.2 + 0.25 = 0.45，中心 y = 0 - 0.2 + 0.45/2 = 0.025
    for (const box of boxes) {
      expect(box.size[1]).toBeCloseTo(0.45, 9);
      expect(box.pos[1]).toBeCloseTo(0.025, 9);
      // 底面贴地面底 (-0.2)，顶面高出地面 0.25
      expect(box.pos[1] - box.size[1] / 2).toBeCloseTo(-0.2, 9);
      expect(box.pos[1] + box.size[1] / 2).toBeCloseTo(0.25, 9);
    }

    // 浮点派生值逐分量比较（0.2 + 0.25 不保证二进制精确）
    expect(north.pos[0]).toBe(0);
    expect(north.pos[1]).toBeCloseTo(0.025, 12);
    expect(north.pos[2]).toBeCloseTo(-16.1, 12);
    expect(south.pos[0]).toBe(0);
    expect(south.pos[1]).toBeCloseTo(0.025, 12);
    expect(south.pos[2]).toBeCloseTo(16.1, 12);
    expect(west.pos[0]).toBeCloseTo(-16.1, 12);
    expect(west.pos[1]).toBeCloseTo(0.025, 12);
    expect(west.pos[2]).toBe(0);
    expect(east.pos[0]).toBeCloseTo(16.1, 12);
    expect(east.pos[1]).toBeCloseTo(0.025, 12);
    expect(east.pos[2]).toBe(0);

    const expectSize = (size: readonly [number, number, number], expected: readonly [number, number, number]) => {
      expect(size[0]).toBeCloseTo(expected[0], 12);
      expect(size[1]).toBeCloseTo(expected[1], 12);
      expect(size[2]).toBeCloseTo(expected[2], 12);
    };
    expectSize(north.size, [32.2, 0.45, 0.2]);
    expectSize(south.size, [32.2, 0.45, 0.2]);
    expectSize(west.size, [0.2, 0.45, 32.2]);
    expectSize(east.size, [0.2, 0.45, 32.2]);

    // 内侧面与地面边缘齐平在 X/Z = ±16.0
    expect(north.pos[2] + north.size[2] / 2).toBeCloseTo(-16, 9);
    expect(south.pos[2] - south.size[2] / 2).toBeCloseTo(16, 9);
    expect(west.pos[0] + west.size[0] / 2).toBeCloseTo(-16, 9);
    expect(east.pos[0] - east.size[0] / 2).toBeCloseTo(16, 9);
  });

  it('never enters the SupportRegistry or the SpatialIndex', () => {
    const supports = registerMapGround();
    const boxes = edgeTrimBoxes(MAP_CONFIG);
    expect(boxes).toHaveLength(4);

    // 注册表里仍然只有地面一项
    expect(supports.size).toBe(1);
    expect(supports.all().map((surface) => surface.id)).toEqual(['support:ground']);
    for (const box of boxes) {
      expect(supports.get(`support:edge-trim:${box.id}`)).toBeUndefined();
    }

    // 包边中心在地面格之外（例如 z = -16.1 → 格 (0,-17)），不产生支撑
    expect(supports.supportsAtPoint(0, -16.1)).toHaveLength(0);
    expect(supports.supportsAtPoint(0, 16.1)).toHaveLength(0);
    expect(supports.supportsAtPoint(-16.1, 0)).toHaveLength(0);
    expect(supports.supportsAtPoint(16.1, 0)).toHaveLength(0);

    // 说明：包边是否被生产场景/空间索引注册由代码审查与 project play 预览覆盖；
    // 这里只验证包边描述本身不携带任何碰撞/支撑数据，且几何中心落在地面格之外。
    for (const box of boxes) {
      expect(Object.keys(box).sort()).toEqual(['id', 'pos', 'size']);
      expect(Object.isFrozen(box)).toBe(true);
    }
  });

  it('keeps rectangular trim flush with each map axis', () => {
    const wide = createMapConfig({ id: 'wide-test', widthCells: 32, depthCells: 48 });
    const boxes = edgeTrimBoxes(wide);
    const byId = new Map(boxes.map((box) => [box.id, box]));
    // X 向边长 = 32，Z 向边长 = 48；包边内侧仍贴在世界坐标边缘。
    expect(byId.get('north')?.size[0]).toBeCloseTo(32.2, 12);
    expect(byId.get('south')?.size[0]).toBeCloseTo(32.2, 12);
    expect(byId.get('west')?.size[2]).toBeCloseTo(48.2, 12);
    expect(byId.get('east')?.size[2]).toBeCloseTo(48.2, 12);
    expect(byId.get('north')?.pos[2]).toBeCloseTo(-24.1, 12);
    expect(byId.get('east')?.pos[0]).toBeCloseTo(16.1, 12);
  });
});