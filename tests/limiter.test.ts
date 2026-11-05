import { describe, expect, it } from 'vitest';
import { LIMITER_CEILING, WindowPeak, limiterStep, limiterTarget, timeCoeff } from '../src/audio/limiter';

describe('limiter', () => {
  it('leaves what is under the ceiling alone, brings a peak over it to the ceiling', () => {
    expect(limiterTarget(0.5)).toBe(1);
    expect(limiterTarget(2) * 2).toBeCloseTo(LIMITER_CEILING);
  });

  it('drops at the attack\'s rate and recovers at the release\'s', () => {
    const fast = timeCoeff(0.001, 48000), slow = timeCoeff(0.12, 48000);
    const down = limiterStep(1, 0.5, slow, fast);
    const up = limiterStep(0.5, 1, slow, fast);
    expect(1 - down).toBeGreaterThan(up - 0.5); // (falls further in a sample than it rises)
    expect(down).toBeGreaterThan(0.5);
  });

  it('a window\'s peak: the largest of its last values', () => {
    const w = new WindowPeak(3);
    expect(w.push(0.2)).toBeCloseTo(0.2);
    expect(w.push(0.9)).toBeCloseTo(0.9);
    expect(w.push(0.1)).toBeCloseTo(0.9);
    expect(w.push(0.3)).toBeCloseTo(0.9);
    expect(w.push(0.1)).toBeCloseTo(0.3); // (0.9 has left the window)
  });
});
