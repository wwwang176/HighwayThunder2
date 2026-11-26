import { describe, it, expect } from 'vitest';
import { bustTimeScale } from '../src/game/bustShow';

describe('bustShow', () => {
  it('the bust eases the race from full speed down to 0.15 over 1.5 s, not at once, and holds it', () => {
    expect(bustTimeScale(0)).toBe(1);
    expect(bustTimeScale(0.4)).toBeGreaterThan(0.8); // (0.4 s: it was at its slowest already)
    expect(bustTimeScale(0.75)).toBeCloseTo(0.575);
    expect(bustTimeScale(1.2)).toBeGreaterThan(0.15);
    expect(bustTimeScale(1.5)).toBeCloseTo(0.15);
    expect(bustTimeScale(2.9)).toBeCloseTo(0.15);
  });
});
