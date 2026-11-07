import { describe, expect, it } from 'vitest';
import {
  PLAYER_BOUNDS,
  PLAYER_BOUNDS_X,
  PLAYER_BOUNDS_Z,
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
  it('derives the 32m island bounds as ±15.5', () => {
    expect(PLAYER_BOUNDS).toBe(15.5);
    expect(PLAYER_BOUNDS_X).toBe(15.5);
    expect(PLAYER_BOUNDS_Z).toBe(15.5);
  });

  it('clamps positions five metres beyond the island range', () => {
    // 20.5 = PLAYER_BOUNDS + 5，旧 10m 图会把 12 夹到 10；新图 12 是内点
    expect(clampPlayerPosition(PLAYER_BOUNDS + 5, -(PLAYER_BOUNDS + 5))).toEqual([15.5, -15.5]);
    expect(clampPlayerPosition(-(PLAYER_BOUNDS + 5), PLAYER_BOUNDS + 5)).toEqual([-15.5, 15.5]);
    expect(clampPlayerPosition(20.5, 0)).toEqual([15.5, 0]);
    expect(clampPlayerPosition(0, -20.5)).toEqual([0, -15.5]);
    expect(clampPlayerPosition(15.5, -15.5)).toEqual([15.5, -15.5]);
  });

  it('leaves interior positions untouched, including 12 which used to be clamped', () => {
    expect(clampPlayerPosition(12, -12)).toEqual([12, -12]);
    expect(clampPlayerPosition(-12, 12)).toEqual([-12, 12]);
    expect(clampPlayerPosition(1.5, -2.5)).toEqual([1.5, -2.5]);
    expect(clampPlayerPosition(0, 0)).toEqual([0, 0]);
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
