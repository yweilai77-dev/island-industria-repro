import { describe, expect, it } from 'vitest';
import {
  PLAYER_BOUNDS,
  clampPlayerPosition,
  facingYawFor,
  moveVector,
} from '../player/player.ts';

describe('camera-relative movement', () => {
  it('W walks toward -Z when camera yaw is 0', () => {
    const dir = moveVector(0, 1, 0);
    expect(dir.x).toBeCloseTo(0, 9);
    expect(dir.z).toBeCloseTo(-1, 9);
  });

  it('D walks toward +X when camera yaw is 0', () => {
    const dir = moveVector(0, 0, 1);
    expect(dir.x).toBeCloseTo(1, 9);
    expect(dir.z).toBeCloseTo(0, 9);
  });

  it('rotates with the camera yaw (45 degrees)', () => {
    const dir = moveVector(Math.PI / 4, 1, 0);
    expect(dir.x).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(dir.z).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it('diagonal input stays normalized', () => {
    const dir = moveVector(0, 1, 1);
    expect(Math.hypot(dir.x, dir.z)).toBeCloseTo(1, 9);
  });
});

describe('player bounds', () => {
  it('clamps positions to the island range', () => {
    expect(clampPlayerPosition(12, -12)).toEqual([PLAYER_BOUNDS, -PLAYER_BOUNDS]);
    expect(clampPlayerPosition(-12, 12)).toEqual([-PLAYER_BOUNDS, PLAYER_BOUNDS]);
    expect(clampPlayerPosition(1.5, -2.5)).toEqual([1.5, -2.5]);
  });
});

describe('facing', () => {
  it('faces -Z when moving north', () => {
    expect(facingYawFor(0, -1)).toBeCloseTo(0, 9);
  });

  it('faces +X when moving east (yaw -90 degrees)', () => {
    expect(facingYawFor(1, 0)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('faces -X when moving west (yaw +90 degrees)', () => {
    expect(facingYawFor(-1, 0)).toBeCloseTo(Math.PI / 2, 9);
  });
});