import { describe, expect, it } from 'vitest';
import { discUv, slotPoint } from '../src/vehicles/brakeDisc';

describe('brake disc slots', () => {
  it('lays the disc across the map', () => {
    expect(discUv(0, 0, 0.19)).toEqual([0.5, 0.5]);
    expect(discUv(0.19, 0, 0.19)).toEqual([1, 0.5]);
    expect(discUv(0, -0.19, 0.19)[1]).toBeCloseTo(0);
  });

  it('keeps the slots on the friction ring, sweeping one way', () => {
    const [r0, a0] = slotPoint(0, 0);
    const [r1, a1] = slotPoint(0, 1);
    expect(r0).toBeGreaterThan(0.52);
    expect(r1).toBeLessThan(1);
    expect(a1).toBeGreaterThan(a0);
  });
});
