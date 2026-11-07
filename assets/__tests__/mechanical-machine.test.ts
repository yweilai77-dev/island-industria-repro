import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MACHINE_GEOMETRY,
  machinePose,
  machineStroke,
  validateMachineGeometry,
} from '../mechanical/machine.ts';

describe('M1.7-B slider-crank kinematics', () => {
  it('has the specified stroke and endpoints', () => {
    expect(machineStroke()).toBeCloseTo(0.24, 12);
    const top = machinePose(0);
    const bottom = machinePose(Math.PI);
    expect(top.ramY).toBeCloseTo(0.9, 12);
    expect(bottom.ramY).toBeCloseTo(0.66, 12);
    expect(top.ramY - bottom.ramY).toBeCloseTo(0.24, 12);
  });

  it('keeps the connecting rod length constant', () => {
    for (const angle of [0, Math.PI / 6, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      const pose = machinePose(angle);
      const dy = pose.ramY - pose.pinY;
      const dz = -pose.pinZ;
      expect(Math.hypot(dy, dz)).toBeCloseTo(DEFAULT_MACHINE_GEOMETRY.rodLength, 10);
    }
  });

  it('is symmetric under reverse rotation', () => {
    for (const angle of [0.3, 0.8, 1.7]) {
      const forward = machinePose(angle);
      const reverse = machinePose(-angle);
      expect(reverse.ramY).toBeCloseTo(forward.ramY, 12);
      expect(reverse.rodAngle).toBeCloseTo(-forward.rodAngle, 12);
    }
  });

  it('freezes when angle does not change', () => {
    expect(machinePose(1.2)).toEqual(machinePose(1.2));
  });

  it('rejects invalid geometry and non-finite angles', () => {
    expect(() => validateMachineGeometry({ ...DEFAULT_MACHINE_GEOMETRY, crankRadius: 0 })).toThrow(RangeError);
    expect(() => validateMachineGeometry({ ...DEFAULT_MACHINE_GEOMETRY, rodLength: 0.1 })).toThrow(RangeError);
    expect(() => machinePose(Number.NaN)).toThrow(RangeError);
  });
});
