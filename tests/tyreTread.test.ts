import { describe, expect, it } from 'vitest';
import { TREAD_MARGIN, treadV, triangleU } from '../src/vehicles/tyreTread';

describe('tyre tread uvs', () => {
  it('spreads the tread across the band, the sidewalls in the margins', () => {
    expect(treadV(0.1, true, 0.1)).toBeCloseTo(TREAD_MARGIN);
    expect(treadV(-0.1, true, 0.1)).toBeCloseTo(1 - TREAD_MARGIN);
    expect(treadV(0, true, 0.1)).toBeCloseTo(0.5);
    expect(treadV(0.12, false, 0.1)).toBe(0);
    expect(treadV(-0.12, false, 0.1)).toBe(1);
  });

  it('keeps a triangle across the seam together', () => {
    const [u0, u1, u2] = triangleU(Math.PI - 0.05, -Math.PI + 0.05, Math.PI - 0.05, 20);
    expect(u1 - u0).toBeCloseTo((0.1 / (2 * Math.PI)) * 20);
    expect(u2).toBeCloseTo(u0);
    const [a, b] = triangleU(0, 0.1, 0, 20);
    expect(b - a).toBeCloseTo((0.1 / (2 * Math.PI)) * 20);
  });
});
