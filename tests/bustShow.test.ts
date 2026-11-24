import { describe, it, expect } from 'vitest';
import { bustTimeScale } from '../src/game/bustShow';

describe('bustShow', () => {
  it('the bust slows the race to 0.15 in 0.4 s and holds it', () => {
    expect(bustTimeScale(0)).toBe(1);
    expect(bustTimeScale(0.2)).toBeLessThan(1);
    expect(bustTimeScale(0.2)).toBeGreaterThan(0.15);
    expect(bustTimeScale(0.4)).toBeCloseTo(0.15);
    expect(bustTimeScale(2.9)).toBeCloseTo(0.15);
  });
});
