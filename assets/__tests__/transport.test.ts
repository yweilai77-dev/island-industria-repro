import { describe, expect, it } from 'vitest';
import { CELL_SIZE, createPlacement, type Rotation } from '../grid/grid.ts';
import { levelBaseY } from '../spatial/space.ts';
import {
  CHUTE_BLOCKED_PROGRESS,
  CHUTE_ITEM_HEIGHT,
  CHUTE_SPEED,
  acceptItem,
  advanceChute,
  chuteDirectionOf,
  chuteItemWorldPosition,
  chuteNextCell,
  createChuteState,
  flushChute,
  markBlocked,
  readyForHandoff,
  releaseItem,
  unblock,
} from '../production/transport.ts';

/** 按 0.25s 一步推进 seconds 秒（advanceChute 会把单步截到 0.25）。 */
function advance(state: ReturnType<typeof createChuteState>, seconds: number): void {
  const steps = Math.round(seconds / 0.25);
  for (let index = 0; index < steps; index += 1) advanceChute(state, 0.25);
}

describe('M1.8-D gravity chute', () => {
  it('advances the item at 1.2 m/s and stops at t=1', () => {
    const state = createChuteState();
    expect(acceptItem(state, 'iron_ore')).toBe(true);
    expect(state.item?.t).toBe(0);

    advanceChute(state, 0.25);
    expect(state.item?.t).toBeCloseTo((CHUTE_SPEED * 0.25) / CELL_SIZE, 12);

    advance(state, 0.75);
    expect(state.item?.t).toBe(1);

    advance(state, 2);
    expect(state.item?.t).toBe(1);
    expect(state.item?.blocked).toBe(false);
  });

  it('is ready for handoff only at t>=1 and while not blocked', () => {
    const state = createChuteState();
    expect(readyForHandoff(state)).toBe(false);
    acceptItem(state, 'iron_ore');
    expect(readyForHandoff(state)).toBe(false);

    advanceChute(state, 0.25);
    expect(readyForHandoff(state)).toBe(false);

    advance(state, 1);
    expect(readyForHandoff(state)).toBe(true);

    markBlocked(state);
    expect(readyForHandoff(state)).toBe(false);
    unblock(state);
    expect(readyForHandoff(state)).toBe(false); // 位置已退到 0.92，需重新下滑
  });

  it('refuses a second item while occupied and never overwrites it', () => {
    const state = createChuteState();
    expect(acceptItem(state, 'iron_ore')).toBe(true);
    expect(acceptItem(state, 'crushed_ore')).toBe(false);
    expect(state.item?.itemId).toBe('iron_ore');
    expect(state.delivered).toBe(0);
  });

  it('releases the item, clears the slot and bumps delivered', () => {
    const state = createChuteState();
    acceptItem(state, 'iron_ore');
    const released = releaseItem(state);
    expect(released?.itemId).toBe('iron_ore');
    expect(state.item).toBeNull();
    expect(state.delivered).toBe(1);

    expect(releaseItem(state)).toBeUndefined();
    expect(state.delivered).toBe(1);

    // 拆除时的 flushChute 同样交出在途物品。
    acceptItem(state, 'crushed_ore');
    expect(flushChute(state)?.itemId).toBe('crushed_ore');
    expect(state.item).toBeNull();
    expect(state.delivered).toBe(2);
  });

  it('parks the item at 0.92 when blocked and resumes after unblock', () => {
    const state = createChuteState();
    acceptItem(state, 'iron_ore');
    advance(state, 1);
    expect(state.item?.t).toBe(1);

    markBlocked(state);
    expect(state.item?.blocked).toBe(true);
    expect(state.item?.t).toBeCloseTo(CHUTE_BLOCKED_PROGRESS, 12);
    expect(readyForHandoff(state)).toBe(false);

    // 堵塞期间推进不会越过 0.92。
    advance(state, 2);
    expect(state.item?.t).toBeCloseTo(CHUTE_BLOCKED_PROGRESS, 12);

    unblock(state);
    expect(state.item?.blocked).toBe(false);
    advanceChute(state, 0.25);
    expect(state.item?.t).toBe(1);
    expect(readyForHandoff(state)).toBe(true);
  });

  it('positions the item from the entry edge to the exit edge for all rotations', () => {
    const base = { gx: 2, gz: 3 };
    const expected: Record<Rotation, { dx: number; dz: number }> = {
      0: { dx: 1, dz: 0 },
      90: { dx: 0, dz: -1 },
      180: { dx: -1, dz: 0 },
      270: { dx: 0, dz: 1 },
    };

    for (const rotation of [0, 90, 180, 270] as const) {
      const placement = createPlacement(base.gx, base.gz, 1, 1, rotation, 1);
      const { dx, dz } = expected[rotation];
      expect(chuteDirectionOf(rotation)).toEqual({ dx, dz });

      const entry = chuteItemWorldPosition(placement, 0);
      const exit = chuteItemWorldPosition(placement, 1);
      const y = levelBaseY(placement.level) + CHUTE_ITEM_HEIGHT;

      // t=0 在入口边，t=1 在出口边。
      expect(entry).toEqual([
        base.gx + 0.5 - dx * 0.5,
        y,
        base.gz + 0.5 - dz * 0.5,
      ]);
      expect(exit).toEqual([
        base.gx + 0.5 + dx * 0.5,
        y,
        base.gz + 0.5 + dz * 0.5,
      ]);

      // 越界 t 被夹在两端。
      expect(chuteItemWorldPosition(placement, -3)).toEqual(entry);
      expect(chuteItemWorldPosition(placement, 5)).toEqual(exit);
    }
  });

  it('points chuteNextCell along the chute direction', () => {
    expect(chuteNextCell(createPlacement(2, 3, 1, 1, 0, 0))).toEqual({ gx: 3, gz: 3 });
    expect(chuteNextCell(createPlacement(2, 3, 1, 1, 90, 0))).toEqual({ gx: 2, gz: 2 });
    expect(chuteNextCell(createPlacement(2, 3, 1, 1, 180, 0))).toEqual({ gx: 1, gz: 3 });
    expect(chuteNextCell(createPlacement(2, 3, 1, 1, 270, 0))).toEqual({ gx: 2, gz: 4 });
  });
});
