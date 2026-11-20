import { describe, expect, it } from 'vitest';
import { crossFraction, outlineOf, reachAhead } from '../src/vehicles/outline';

describe('reachAhead', () => {
  const box = outlineOf(undefined, 2, 4); // (its box: 2 m wide, 4 long)

  it('is the nose going forward, the tail going backwards', () => {
    expect(reachAhead(box, 0)).toBeCloseTo(2);
    expect(reachAhead(box, Math.PI)).toBeCloseTo(2);
  });

  it('is its side across the road, its corner at an angle', () => {
    expect(reachAhead(box, Math.PI / 2)).toBeCloseTo(1);
    expect(reachAhead(box, -Math.PI / 2)).toBeCloseTo(1);
    const a = 0.3;
    expect(reachAhead(box, a)).toBeCloseTo(2 * Math.cos(a) + 1 * Math.sin(a));
  });

  it('takes a collision shape as it is (the nose toward -z), not as a box about the middle', () => {
    // A long nose (3 m ahead), a short tail (1 m behind).
    const shape = outlineOf([[-1, 0, -3, 1, 0, -3, -1, 0, 1, 1, 0, 1]], 2, 4);
    expect(reachAhead(shape, 0)).toBeCloseTo(3);
    expect(reachAhead(shape, Math.PI)).toBeCloseTo(1);
  });
});

describe('crossFraction', () => {
  it('is where in the step the line was reached', () => {
    expect(crossFraction(98, 102, 100)).toBeCloseTo(0.5);
    expect(crossFraction(99, 103, 100)).toBeCloseTo(0.25);
    expect(crossFraction(96, 100, 100)).toBeCloseTo(1);
  });

  it('is the step start already over it, its end with nothing before', () => {
    expect(crossFraction(101, 103, 100)).toBe(0);
    expect(crossFraction(-Infinity, 103, 100)).toBe(1);
  });
});
