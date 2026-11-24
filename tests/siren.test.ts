import { describe, it, expect } from 'vitest';
import { SIREN, sirenPitch } from '../src/audio/siren';

describe('siren', () => {
  it('wails between its low and high pitch, once a period', () => {
    const at = Array.from({ length: 200 }, (_, i) => sirenPitch((i / 200) * SIREN.period));
    expect(Math.min(...at)).toBeGreaterThanOrEqual(SIREN.lo - 1e-6);
    expect(Math.max(...at)).toBeLessThanOrEqual(SIREN.hi + 1e-6);
    expect(Math.max(...at) - Math.min(...at)).toBeGreaterThan((SIREN.hi - SIREN.lo) * 0.9);
    expect(sirenPitch(0.3)).toBeCloseTo(sirenPitch(0.3 + SIREN.period));
  });
});
