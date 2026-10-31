import { describe, it, expect } from 'vitest';
import { tripGripScale } from '../src/vehicles/tyreChassis';

const DEG = Math.PI / 180;
const trip = { from: 30 * DEG, to: 90 * DEG, mu: 2.6 };
const max = 2.6 / 1.1;
const share = (deg: number) => (tripGripScale(deg * DEG, trip, 1.1) - 1) / (max - 1);

describe('tripGripScale (sideways "tripping" for rollovers)', () => {
  it('no effect when rolling straight or in ordinary slides', () => {
    expect(tripGripScale(0, trip, 1.1)).toBe(1);
    expect(tripGripScale(20 * DEG, trip, 1.1)).toBe(1);
    expect(tripGripScale(-30 * DEG, trip, 1.1)).toBe(1);
  });
  it('full strength only when dragged fully sideways (90 deg)', () => {
    expect(tripGripScale(90 * DEG, trip, 1.1)).toBeCloseTo(max);
    expect(tripGripScale(-90 * DEG, trip, 1.1)).toBeCloseTo(max);
  });
  it('steep non-linear rise toward 90 deg (cubic)', () => {
    expect(share(60)).toBeCloseTo(0.125, 3);
    expect(share(75)).toBeCloseTo(0.4219, 3);
    expect(share(85)).toBeCloseTo(0.7702, 3);
    expect(share(85)).toBeLessThan(share(90));
  });
  it('no trip setup -> 1', () => {
    expect(tripGripScale(1.2, undefined, 1.1)).toBe(1);
  });
});
