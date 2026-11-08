import { describe, expect, it } from 'vitest';
import { ROLL_RECORDED, rollLevel, rollRate } from '../src/audio/rolling';
import { nearestWithin, type EarPose } from '../src/audio/pan';

const KMH = 1 / 3.6;

describe('rollLevel', () => {
  it('is 1 at the recording speed and silent at a standstill', () => {
    expect(rollLevel(ROLL_RECORDED)).toBeCloseTo(1, 6);
    expect(rollLevel(0)).toBe(0);
    expect(rollLevel(-5)).toBe(0);
    expect(rollLevel(Number.NaN)).toBe(0);
  });

  it('grows about 9 dB for each doubling of speed', () => {
    const db = 20 * Math.log10(rollLevel(2 * 50 * KMH) / rollLevel(50 * KMH));
    expect(db).toBeCloseTo(9.03, 1);
  });

  it('fades in from a standstill and is capped flat out', () => {
    expect(rollLevel(1)).toBeLessThan(rollLevel(2));
    expect(rollLevel(1)).toBeGreaterThan(0);
    expect(rollLevel(400 * KMH)).toBe(rollLevel(500 * KMH));
  });
});

describe('rollRate', () => {
  it('is speed over the recording speed, within bounds', () => {
    expect(rollRate(ROLL_RECORDED)).toBeCloseTo(1, 6);
    expect(rollRate(120 * KMH)).toBeCloseTo(120 / 97, 6);
    expect(rollRate(0)).toBeGreaterThan(0);
    expect(rollRate(1000)).toBe(rollRate(2000));
    expect(rollRate(Number.NaN)).toBe(1);
  });
});

describe('nearestWithin', () => {
  const ear: EarPose = { px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };
  const at = (z: number) => ({ pos: [0, 0, z] });

  it('keeps the nearest within range, nearest first', () => {
    const sources = [at(50), at(5), at(300), at(-20), at(10)];
    const idx = new Int32Array(3), d2 = new Float64Array(3);
    const n = nearestWithin(sources, sources.length, ear, 100, idx, d2);
    expect(n).toBe(3);
    expect(Array.from(idx)).toEqual([1, 4, 3]);
    expect(Array.from(d2)).toEqual([25, 100, 400]);
  });

  it('looks only at the first `count`', () => {
    const sources = [at(50), at(5), at(1)];
    const idx = new Int32Array(4), d2 = new Float64Array(4);
    expect(nearestWithin(sources, 2, ear, 100, idx, d2)).toBe(2);
    expect(Array.from(idx.subarray(0, 2))).toEqual([1, 0]);
  });
});
