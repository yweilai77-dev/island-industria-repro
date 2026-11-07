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

describe('iron ore node layout', () => {
  it('keeps every node inside the 20x20 build area', () => {
    for (const node of IRON_ORE_NODES) {
      for (const cell of cellsOf(nodePlacement(node))) {
        expect(isBuildAreaCell(cell)).toBe(true);
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

  it('blocks exactly the node footprint cells while active', () => {
    const blocked = resourceBlockedCells();
    expect(blocked.size).toBe(IRON_ORE_NODES.length * 4);
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
  it('gives both nodes 20 each for 40 total', () => {
    expect(IRON_ORE_MAX_AMOUNT).toBe(20);
    expect(IRON_ORE_NODES.length).toBe(2);
    expect(IRON_ORE_NODES.length * IRON_ORE_MAX_AMOUNT).toBe(40);
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
