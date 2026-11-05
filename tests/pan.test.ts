import { describe, expect, it } from 'vitest';
import { azimuthDeg, equalPowerMono, inverseDistanceGain, type EarPose } from '../src/audio/pan';

// The ear at the origin facing -z (three's camera), up +y.
const EAR: EarPose = { px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };

describe('azimuth', () => {
  it('is 0 ahead, +90 right, -90 left, 180 behind', () => {
    expect(azimuthDeg(0, 0, -10, EAR)).toBeCloseTo(0);
    expect(azimuthDeg(10, 0, 0, EAR)).toBeCloseTo(90);
    expect(azimuthDeg(-10, 0, 0, EAR)).toBeCloseTo(-90);
    expect(Math.abs(azimuthDeg(0, 0, 10, EAR))).toBeCloseTo(180);
  });

  it('ignores height', () => {
    expect(azimuthDeg(10, 7, 0, EAR)).toBeCloseTo(90);
  });

  it('turns with the ear', () => {
    const right: EarPose = { ...EAR, fx: 1, fz: 0 }; // facing +x
    expect(azimuthDeg(10, 0, 0, right)).toBeCloseTo(0);
  });
});

describe('equal-power pan (mono)', () => {
  const out = new Float32Array(2);
  it('splits evenly ahead, all to one side at ±90', () => {
    equalPowerMono(0, 1, out);
    expect(out[0]).toBeCloseTo(Math.SQRT1_2);
    expect(out[1]).toBeCloseTo(Math.SQRT1_2);
    equalPowerMono(90, 1, out);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(1);
  });

  it('keeps the power, and folds behind onto ahead', () => {
    for (let az = -180; az <= 180; az += 15) {
      equalPowerMono(az, 1, out);
      expect(out[0] ** 2 + out[1] ** 2).toBeCloseTo(1);
    }
    const ahead = new Float32Array(2);
    equalPowerMono(30, 1, ahead);
    equalPowerMono(150, 1, out);
    expect(out[0]).toBeCloseTo(ahead[0]);
  });
});

describe('inverse distance', () => {
  it('is full within ref, half at twice it (rolloff 1)', () => {
    expect(inverseDistanceGain(3, 10, 1)).toBe(1);
    expect(inverseDistanceGain(20, 10, 1)).toBeCloseTo(0.5);
    expect(inverseDistanceGain(20, 10, 0)).toBe(1);
  });
});
