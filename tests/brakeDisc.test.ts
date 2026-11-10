import { describe, expect, it } from 'vitest';
import { discUv, slotEnds } from '../src/vehicles/brakeDisc';

describe('brake disc slots', () => {
  it('lays the disc across the map', () => {
    expect(discUv(0, 0, 0.19)).toEqual([0.5, 0.5]);
    expect(discUv(0.19, 0, 0.19)).toEqual([1, 0.5]);
    expect(discUv(0, -0.19, 0.19)[1]).toBeCloseTo(0);
  });

  it('lays each slot straight across the friction ring, passing the centre by', () => {
    for (let i = 0; i < 8; i++) {
      const [[x0, y0], [x1, y1]] = slotEnds(i);
      expect(Math.hypot(x0, y0)).toBeCloseTo(0.64);
      expect(Math.hypot(x1, y1)).toBeCloseTo(0.965);
      // its line's distance from the centre
      expect(Math.abs(x0 * y1 - y0 * x1) / Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(0.6);
    }
  });
});
