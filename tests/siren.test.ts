import { describe, it, expect } from 'vitest';
import { HORN, hornCurve, SIREN, sirenPitch } from '../src/audio/siren';

describe('siren', () => {
  it('wails between its low and high pitch, once a period', () => {
    const at = Array.from({ length: 200 }, (_, i) => sirenPitch((i / 200) * SIREN.period));
    expect(Math.min(...at)).toBeGreaterThanOrEqual(SIREN.lo - 1e-6);
    expect(Math.max(...at)).toBeLessThanOrEqual(SIREN.hi + 1e-6);
    expect(Math.max(...at) - Math.min(...at)).toBeGreaterThan((SIREN.hi - SIREN.lo) * 0.9);
    expect(sirenPitch(0.3)).toBeCloseTo(sirenPitch(0.3 + SIREN.period));
  });

  it("the horn driver's soft clip: odd, rising, -1 to 1, steeper than straight through near 0", () => {
    const c = hornCurve(257, HORN.drive);
    expect(c.length).toBe(257);
    expect(c[0]).toBeCloseTo(-1);
    expect(c[256]).toBeCloseTo(1);
    expect(c[128]).toBeCloseTo(0);
    for (let i = 1; i < 257; i++) expect(c[i]).toBeGreaterThan(c[i - 1]);
    for (let i = 0; i < 257; i++) expect(c[i]).toBeCloseTo(-c[256 - i]);
    expect(c[128 + 16]).toBeGreaterThan(16 / 128); // (louder than the input there: it squashes the peaks, not all)
  });
});
