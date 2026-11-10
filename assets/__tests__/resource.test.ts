import { describe, expect, it } from 'vitest';
import { cellsOf } from '../grid/grid.ts';
import { isBuildAreaCell } from '../grid/grid-overlay.ts';
import { PLAYER_START_CELL } from '../player/player.ts';
import {
  IRON_ORE_MAX_AMOUNT,
  IRON_ORE_NODES,
  isCellBlockedBy,
  nodeBlocksCell,
  nodeContainsCell,
  nodePlacement,
  resourceBlockedCells,
} from '../resource/resource.ts';

/** 旧 M1.5 的 20×20 地图范围（格 -10..9）；M1.6 新增节点必须落在它之外。 */
function insideLegacy20x20(cell: { gx: number; gz: number }): boolean {
  return cell.gx >= -10 && cell.gx <= 9 && cell.gz >= -10 && cell.gz <= 9;
}

describe('iron ore node layout (M1.6: four 2x2 nodes)', () => {
  it('anchors A/B/C/D at their literal cells and keeps A/B unchanged', () => {
    expect(IRON_ORE_NODES.map((node) => [node.id, node.gx, node.gz, node.w, node.d])).toEqual([
      [1, -5, 4, 2, 2],
      [2, 4, -5, 2, 2],
      [3, -13, -7, 2, 2],
      [4, 10, 10, 2, 2],
    ]);
    for (const node of IRON_ORE_NODES) {
      expect(node.type).toBe('iron-ore');
    }
  });

  it('keeps every node inside the 32x32 build area', () => {
    for (const node of IRON_ORE_NODES) {
      for (const cell of cellsOf(nodePlacement(node))) {
        expect(isBuildAreaCell(cell)).toBe(true);
      }
    }
  });

  it('places C and D outside the legacy 20x20 area', () => {
    const [c, d] = IRON_ORE_NODES.slice(2);
    expect(c).toBeDefined();
    expect(d).toBeDefined();
    for (const node of [c!, d!]) {
      for (const cell of cellsOf(nodePlacement(node))) {
        expect(insideLegacy20x20(cell)).toBe(false);
      }
    }
  });

  it('does not overlap the player spawn cell', () => {
    for (const node of IRON_ORE_NODES) {
      expect(nodeContainsCell(node, PLAYER_START_CELL)).toBe(false);
    }
  });

  it('keeps nodes from overlapping each other', () => {
    for (let i = 0; i < IRON_ORE_NODES.length; i += 1) {
      for (let j = i + 1; j < IRON_ORE_NODES.length; j += 1) {
        const a = IRON_ORE_NODES[i]!;
        const b = IRON_ORE_NODES[j]!;
        for (const cell of cellsOf(nodePlacement(a))) {
          expect(nodeContainsCell(b, cell)).toBe(false);
        }
      }
    }
  });

  it('blocks exactly 16 footprint cells while active', () => {
    const blocked = resourceBlockedCells();
    expect(blocked.size).toBe(16);
    for (const node of IRON_ORE_NODES) {
      for (const cell of cellsOf(nodePlacement(node))) {
        expect(blocked.has(`${cell.gx},${cell.gz}`)).toBe(true);
      }
    }
    expect(blocked.has('0,0')).toBe(false);
  });

  it('reports the right node for a cell', () => {
    const first = IRON_ORE_NODES[0]!;
    expect(nodeContainsCell(first, { gx: first.gx, gz: first.gz })).toBe(true);
    expect(nodeContainsCell(first, { gx: first.gx + first.w, gz: first.gz })).toBe(false);
    expect(nodeContainsCell(first, { gx: first.gx, gz: first.gz + first.d })).toBe(false);
  });
});

describe('iron ore reserves and dynamic blocking', () => {
  it('gives four nodes 60 each for 240 total, each node below the 99 HUD cap (P2-E3 balance)', () => {
    expect(IRON_ORE_MAX_AMOUNT).toBe(60);
    expect(IRON_ORE_NODES.length).toBe(4);
    expect(IRON_ORE_NODES.length * IRON_ORE_MAX_AMOUNT).toBe(240);
    // 3D 矿石计数是两位数字：单点储量必须 <= 99，总储量不受此限。
    expect(IRON_ORE_MAX_AMOUNT).toBeLessThanOrEqual(99);
  });

  it('stops blocking after a node is depleted', () => {
    const node = IRON_ORE_NODES[0]!;
    const cell = { gx: node.gx, gz: node.gz };
    expect(isCellBlockedBy(IRON_ORE_NODES, cell)).toBe(true);
    const depleted = IRON_ORE_NODES.map((candidate) =>
      candidate.id === node.id ? { ...candidate, depleted: true } : candidate);
    expect(isCellBlockedBy(depleted, cell)).toBe(false);
    expect(nodeBlocksCell({ ...node, depleted: true }, cell)).toBe(false);
  });

  it('keeps the other node blocked when one is depleted', () => {
    const first = IRON_ORE_NODES[0]!;
    const second = IRON_ORE_NODES[1]!;
    const state = IRON_ORE_NODES.map((node) =>
      node.id === first.id ? { ...node, depleted: true } : node);
    expect(isCellBlockedBy(state, { gx: second.gx, gz: second.gz })).toBe(true);
  });

  it('frees all four cells of a depleted node', () => {
    const node = IRON_ORE_NODES[0]!;
    const state = IRON_ORE_NODES.map((candidate) =>
      candidate.id === node.id ? { ...candidate, depleted: true } : candidate);
    for (const cell of cellsOf(nodePlacement(node))) {
      expect(isCellBlockedBy(state, cell)).toBe(false);
    }
  });
});