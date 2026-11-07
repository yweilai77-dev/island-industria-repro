import { describe, expect, it } from 'vitest';
import { isMechanicalSelection } from '../build/input-mode.ts';
import { ITEM_IDS } from '../items/items.ts';

describe('mechanical input mode isolation', () => {
  it('is true only for mechanical item ids', () => {
    expect(isMechanicalSelection(ITEM_IDS.SHAFT)).toBe(true);
    expect(isMechanicalSelection(ITEM_IDS.GEAR_12)).toBe(true);
    expect(isMechanicalSelection(ITEM_IDS.POWER_SOURCE)).toBe(true);
    expect(isMechanicalSelection(ITEM_IDS.MACHINE)).toBe(true);
    expect(isMechanicalSelection(ITEM_IDS.IRON_ORE)).toBe(false);
    expect(isMechanicalSelection(null)).toBe(false);
  });
});
