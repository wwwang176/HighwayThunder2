import { describe, it, expect } from 'vitest';
import { bustRecoverScale, bustTimeScale, bustVolume } from '../src/game/bustShow';

describe('bustShow', () => {
  it('the bust eases the race from full speed down to 0.3 over 1.5 s, not at once, and holds it', () => {
    expect(bustTimeScale(0)).toBe(1);
    expect(bustTimeScale(0.4)).toBeGreaterThan(0.85); // (0.4 s: it was at its slowest already)
    expect(bustTimeScale(0.75)).toBeCloseTo(0.65);
    expect(bustTimeScale(1.2)).toBeGreaterThan(0.3);
    expect(bustTimeScale(1.5)).toBeCloseTo(0.3);
    expect(bustTimeScale(2.9)).toBeCloseTo(0.3);
  });

  it('put back, the race eases from 0.3 back up to full speed over 1 s, not at once', () => {
    expect(bustRecoverScale(0)).toBeCloseTo(0.3);
    expect(bustRecoverScale(0.5)).toBeCloseTo(0.65);
    expect(bustRecoverScale(0.9)).toBeLessThan(1);
    expect(bustRecoverScale(1)).toBe(1);
    expect(bustRecoverScale(5)).toBe(1);
  });

  it('the sound quieter with the slow motion: half at its slowest, full at full speed', () => {
    expect(bustVolume(1)).toBe(1);
    expect(bustVolume(0.65)).toBeCloseTo(0.75);
    expect(bustVolume(0.3)).toBeCloseTo(0.5);
    expect(bustVolume(0.1)).toBeCloseTo(0.5);
    expect(bustVolume(1.2)).toBe(1);
  });
});
