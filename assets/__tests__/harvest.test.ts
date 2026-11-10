import { describe, expect, it } from 'vitest';
import {
  HARVEST_DURATION,
  HARVEST_RANGE,
  advanceHarvest,
  createHarvestState,
  distanceToNodeAabb,
  findHarvestTarget,
  startHarvest,
} from '../harvest/harvest.ts';
import {
  DEPLETED_SEGMENTS,
  LETTER_F_SEGMENTS,
  digitSegments,
  splitDigits,
} from '../hud/hud.ts';

const NODE_A = { id: 1, gx: -5, gz: 4, w: 2, d: 2, amount: 20, depleted: false };
const NODE_B = { id: 2, gx: 4, gz: -5, w: 2, d: 2, amount: 20, depleted: false };

describe('harvest range', () => {
  it('measures distance to the node AABB edge', () => {
    expect(distanceToNodeAabb(-4, 5, NODE_A)).toBe(0);
    expect(distanceToNodeAabb(-5.5, 5, NODE_A)).toBeCloseTo(0.5, 9);
    expect(distanceToNodeAabb(-6, 5, NODE_A)).toBeCloseTo(1, 9);
    expect(distanceToNodeAabb(-6, 7, NODE_A)).toBeCloseTo(Math.SQRT2, 9);
  });

  it('selects the nearest node inside range', () => {
    expect(findHarvestTarget(-4, 5, [NODE_A, NODE_B])?.id).toBe(1);
    expect(findHarvestTarget(3, -4.5, [NODE_A, NODE_B])?.id).toBe(2);
  });

  it('ignores out-of-range and depleted nodes', () => {
    expect(findHarvestTarget(0, 0, [NODE_A, NODE_B])).toBeUndefined();
    expect(findHarvestTarget(-4, 5, [{ ...NODE_A, depleted: true }])).toBeUndefined();
    expect(findHarvestTarget(-4, 5, [{ ...NODE_A, amount: 0 }])).toBeUndefined();
  });

  it('accepts exactly the configured range', () => {
    const node = { ...NODE_A };
    expect(findHarvestTarget(node.gx - HARVEST_RANGE, node.gz, [node])).toBeDefined();
    expect(findHarvestTarget(node.gx - HARVEST_RANGE - 0.01, node.gz, [node])).toBeUndefined();
  });
});

describe('harvest progress', () => {
  it('locks the target without switching', () => {
    const state = createHarvestState();
    startHarvest(state, NODE_A.id);
    const tick = advanceHarvest(state, 1, true, true);
    expect(tick.status).toBe('progress');
    expect(state.nodeId).toBe(1);
  });

  it('completes after three seconds', () => {
    const state = createHarvestState();
    startHarvest(state, NODE_A.id);
    advanceHarvest(state, 1, true, true);
    advanceHarvest(state, 1, true, true);
    const tick = advanceHarvest(state, 1, true, true);
    expect(tick.status).toBe('completed');
    expect(state.nodeId).toBeNull();
  });

  it('cancels without yielding when the player leaves range', () => {
    const state = createHarvestState();
    startHarvest(state, NODE_A.id);
    const tick = advanceHarvest(state, 2.9, false, true);
    expect(tick.status).toBe('cancelled');
    expect(state.nodeId).toBeNull();
    expect(state.elapsed).toBe(0);
  });

  it('cancels when the node becomes unavailable', () => {
    const state = createHarvestState();
    startHarvest(state, NODE_A.id);
    const tick = advanceHarvest(state, 0.5, true, false);
    expect(tick.status).toBe('cancelled');
  });

  it('reports progress fractions up to one', () => {
    const state = createHarvestState();
    startHarvest(state, NODE_A.id);
    expect(advanceHarvest(state, HARVEST_DURATION / 2, true, true).progress).toBeCloseTo(0.5, 9);
  });
});

describe('block glyph layout', () => {
  it('lights the expected segment counts', () => {
    expect(digitSegments(1)).toHaveLength(2);
    expect(digitSegments(0)).toHaveLength(6);
    expect(digitSegments(8)).toHaveLength(7);
    expect(DEPLETED_SEGMENTS).toEqual(digitSegments(0));
    expect(LETTER_F_SEGMENTS).toHaveLength(4);
  });

  it('splits numbers into digits', () => {
    expect(splitDigits(40, 2)).toEqual([4, 0]);
    expect(splitDigits(0, 2)).toEqual([0, 0]);
    expect(splitDigits(7)).toEqual([7]);
    // P2-E3：矿石供给 240 后，库存计数用三位显示。
    expect(splitDigits(240, 3)).toEqual([2, 4, 0]);
    expect(splitDigits(100, 3)).toEqual([1, 0, 0]);
    expect(splitDigits(0, 3)).toEqual([0, 0, 0]);
  });
});