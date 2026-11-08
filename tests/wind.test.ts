import { describe, expect, it } from 'vitest';
import { WIND_REF, windLevel, windRate } from '../src/audio/wind';

const KMH = 1 / 3.6;

describe('windLevel', () => {
  it('is 1 at its reference speed, silent standing', () => {
    expect(windLevel(WIND_REF)).toBeCloseTo(1, 6);
    expect(windLevel(0)).toBe(0);
    expect(windLevel(-3)).toBe(0);
    expect(windLevel(Number.NaN)).toBe(0);
  });

  it('grows about 12 dB a doubling of the speed below its cap, and stops at it', () => {
    expect(20 * Math.log10(windLevel(100 * KMH) / windLevel(50 * KMH))).toBeCloseTo(12.04, 1);
    expect(windLevel(50 * KMH)).toBeLessThan(0.1); // (a crawl: next to nothing)
    expect(windLevel(400 * KMH)).toBe(windLevel(350 * KMH));
  });
});

describe('windRate', () => {
  it('is 1 at its reference speed, within bounds', () => {
    expect(windRate(WIND_REF)).toBeCloseTo(1, 6);
    expect(windRate(0)).toBeCloseTo(0.75, 6);
    expect(windRate(1000)).toBe(windRate(2000));
    expect(windRate(Number.NaN)).toBe(1);
  });
});
