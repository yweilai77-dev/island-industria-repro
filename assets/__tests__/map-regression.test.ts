import { describe, expect, it } from 'vitest';
import { cellKey, cellsOf, type Cell } from '../grid/grid.ts';
import { PLAYER_START_CELL } from '../player/player.ts';
import { IRON_ORE_MAX_AMOUNT, IRON_ORE_NODES, nodePlacement } from '../resource/resource.ts';
import { SupportRegistry } from '../spatial/support.ts';
import {
  MAIN_STAIRS,
  PLATFORM_AABB,
  PLATFORM_CELLS,
  PLATFORM_LEVEL,
  PLATFORM_SUPPORT,
  PLATFORM_WORLD_Y,
  STAIRS_TRAVERSAL,
  stairStepCenter,
} from '../spatial/structures.ts';
import { MAP_CONFIG } from '../world/map-config.ts';

const LEGACY_MIN = -10;
const LEGACY_MAX = 9;

function insideLegacy20x20(cell: Cell): boolean {
  return cell.gx >= LEGACY_MIN && cell.gx <= LEGACY_MAX
    && cell.gz >= LEGACY_MIN && cell.gz <= LEGACY_MAX;
}

/** 与生产 spatial.pack.ts 相同的注册方式：地面格集合由 MapConfig 提供。 */
function registerMapGround(): SupportRegistry {
  const supports = new SupportRegistry();
  supports.register({
    id: 'support:ground',
    level: 0,
    worldY: 0,
    cells: MAP_CONFIG.cells(),
    kind: 'ground',
    buildable: true,
    walkable: true,
    active: true,
  });
  return supports;
}

describe('legacy fixed content on the 32x32 map', () => {
  it('keeps the fixed platform at 48 cells, level 1 and world Y 3', () => {
    expect(PLATFORM_CELLS).toHaveLength(48);
    expect(PLATFORM_CELLS[0]).toEqual({ gx: 0, gz: 2 });
    expect(PLATFORM_CELLS.at(-1)).toEqual({ gx: 7, gz: 7 });
    expect(PLATFORM_LEVEL).toBe(1);
    expect(PLATFORM_WORLD_Y).toBe(3);
    expect(PLATFORM_AABB).toEqual({ min: [0, 2.7, 2], max: [8, 3, 8] });
    expect(PLATFORM_SUPPORT.level).toBe(1);
    expect(PLATFORM_SUPPORT.worldY).toBe(3);
    expect(PLATFORM_SUPPORT.buildable).toBe(true);
    expect(PLATFORM_SUPPORT.walkable).toBe(true);
    for (const cell of PLATFORM_CELLS) {
      expect(MAP_CONFIG.containsCell(cell)).toBe(true);
    }
  });

  it('keeps the main stairs origin, four cells, eight steps and step centers', () => {
    expect(MAIN_STAIRS.originCell).toEqual({ gx: -4, gz: 3 });
    expect(MAIN_STAIRS.cells).toEqual([
      { gx: -4, gz: 3 },
      { gx: -3, gz: 3 },
      { gx: -2, gz: 3 },
      { gx: -1, gz: 3 },
    ]);
    expect(MAIN_STAIRS.stepCount).toBe(8);
    expect(MAIN_STAIRS.worldYLow).toBe(0);
    expect(MAIN_STAIRS.worldYHigh).toBe(3);
    expect(STAIRS_TRAVERSAL.stepCount).toBe(8);
    expect(stairStepCenter(0)).toEqual({ x: -3.75, z: 3.5, topY: 0.375 });
    expect(stairStepCenter(7)).toEqual({ x: -0.25, z: 3.5, topY: 3 });
    for (const cell of MAIN_STAIRS.cells) {
      expect(MAP_CONFIG.containsCell(cell)).toBe(true);
    }
  });

  it('keeps the player spawn cell and gives it walkable level 0 support', () => {
    expect(PLAYER_START_CELL).toEqual({ gx: -2, gz: 2 });
    expect(MAP_CONFIG.containsCell(PLAYER_START_CELL)).toBe(true);

    const supports = registerMapGround();
    const spawnSupport = supports.supportAt(PLAYER_START_CELL, 0);
    expect(spawnSupport).toBeDefined();
    expect(spawnSupport?.id).toBe('support:ground');
    expect(spawnSupport?.walkable).toBe(true);
    expect(spawnSupport?.buildable).toBe(true);
  });
});

describe('resource nodes on the 32x32 map', () => {
  it('anchors A/B/C/D at their literal cells', () => {
    expect(IRON_ORE_NODES.map((node) => [node.id, node.gx, node.gz, node.w, node.d])).toEqual([
      [1, -5, 4, 2, 2],
      [2, 4, -5, 2, 2],
      [3, -13, -7, 2, 2],
      [4, 10, 10, 2, 2],
    ]);
  });

  it('keeps every node cell inside the map, and C/D outside the legacy 20x20 area', () => {
    for (const node of IRON_ORE_NODES) {
      for (const cell of cellsOf(nodePlacement(node))) {
        expect(MAP_CONFIG.containsCell(cell)).toBe(true);
      }
    }
    for (const node of IRON_ORE_NODES.slice(2)) {
      for (const cell of cellsOf(nodePlacement(node))) {
        expect(insideLegacy20x20(cell)).toBe(false);
      }
    }
  });

  it('totals 80 reserves, below the 99 two-digit HUD cap', () => {
    expect(IRON_ORE_MAX_AMOUNT).toBe(20);
    expect(IRON_ORE_NODES).toHaveLength(4);
    const total = IRON_ORE_NODES.length * IRON_ORE_MAX_AMOUNT;
    expect(total).toBe(80);
    expect(total).toBeLessThanOrEqual(99);
  });

  it('keeps the four nodes mutually non-overlapping', () => {
    for (let i = 0; i < IRON_ORE_NODES.length; i += 1) {
      for (let j = i + 1; j < IRON_ORE_NODES.length; j += 1) {
        const a = IRON_ORE_NODES[i]!;
        const b = IRON_ORE_NODES[j]!;
        const bCells = new Set(cellsOf(nodePlacement(b)).map(cellKey));
        for (const cell of cellsOf(nodePlacement(a))) {
          expect(bCells.has(cellKey(cell))).toBe(false);
        }
      }
    }
  });

  it('never covers the platform, the main stairs or the player spawn', () => {
    const platformCells = new Set(PLATFORM_CELLS.map(cellKey));
    const stairCells = new Set(MAIN_STAIRS.cells.map(cellKey));
    const spawnKey = cellKey(PLAYER_START_CELL);
    for (const node of IRON_ORE_NODES) {
      for (const cell of cellsOf(nodePlacement(node))) {
        expect(platformCells.has(cellKey(cell))).toBe(false);
        expect(stairCells.has(cellKey(cell))).toBe(false);
        expect(cellKey(cell)).not.toBe(spawnKey);
        expect(cell).not.toEqual(PLAYER_START_CELL);
      }
    }
  });
});
