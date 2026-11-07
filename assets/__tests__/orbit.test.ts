import { describe, expect, it } from 'vitest';
import {
  CAMERA_PITCH,
  DEFAULT_DISTANCE,
  MAX_DISTANCE,
  MIN_DISTANCE,
  PAN_LIMIT,
  YAW_STEP,
  cameraOffset,
  clampDistance,
  clampPan,
  damp,
  horizontalAxes,
  zoomDistance,
} from '../camera/orbit.ts';

describe('eight-way orbit camera math', () => {
  it('steps 45 degrees per direction index', () => {
    expect(YAW_STEP).toBeCloseTo(Math.PI / 4, 12);
    const offsetAtZero = cameraOffset(0, DEFAULT_DISTANCE);
    expect(offsetAtZero[0]).toBeCloseTo(0, 6);
    expect(offsetAtZero[2]).toBeGreaterThan(0);
  });

  it('keeps the camera at a fixed pitch and constant distance', () => {
    for (const index of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const offset = cameraOffset(index * YAW_STEP, DEFAULT_DISTANCE);
      expect(offset[1]).toBeCloseTo(Math.sin(CAMERA_PITCH) * DEFAULT_DISTANCE, 9);
      const length = Math.hypot(offset[0], offset[1], offset[2]);
      expect(length).toBeCloseTo(DEFAULT_DISTANCE, 9);
    }
  });

  it('keeps camera above the ground at the minimum distance', () => {
    const offset = cameraOffset(0, MIN_DISTANCE);
    expect(offset[1]).toBeGreaterThan(3);
  });

  it('builds an orthonormal horizontal basis', () => {
    const axes = horizontalAxes(Math.PI / 4);
    expect(Math.hypot(axes.forwardX, axes.forwardZ)).toBeCloseTo(1, 9);
    expect(Math.hypot(axes.rightX, axes.rightZ)).toBeCloseTo(1, 9);
    // 前与右互相垂直
    expect(axes.forwardX * axes.rightX + axes.forwardZ * axes.rightZ).toBeCloseTo(0, 9);
  });

  it('clamps zoom between the near and far limits', () => {
    expect(zoomDistance(DEFAULT_DISTANCE, 1)).toBeGreaterThan(DEFAULT_DISTANCE);
    expect(zoomDistance(DEFAULT_DISTANCE, -1)).toBeLessThan(DEFAULT_DISTANCE);
    expect(zoomDistance(DEFAULT_DISTANCE, 100)).toBe(MAX_DISTANCE);
    expect(zoomDistance(DEFAULT_DISTANCE, -100)).toBe(MIN_DISTANCE);
    expect(clampDistance(1)).toBe(MIN_DISTANCE);
    expect(clampDistance(999)).toBe(MAX_DISTANCE);
  });

  it('clamps panning to the play area', () => {
    expect(clampPan(0)).toBe(0);
    expect(clampPan(999)).toBe(PAN_LIMIT);
    expect(clampPan(-999)).toBe(-PAN_LIMIT);
  });

  it('damps toward the target frame-rate independently', () => {
    const oneStep = damp(0, 1, 12, 1 / 60);
    expect(oneStep).toBeGreaterThan(0);
    expect(oneStep).toBeLessThan(1);
    const twoHalfSteps = damp(damp(0, 1, 12, 1 / 120), 1, 12, 1 / 120);
    expect(twoHalfSteps).toBeCloseTo(oneStep, 6);
  });
});
