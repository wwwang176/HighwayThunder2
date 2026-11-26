import { describe, expect, it } from 'vitest';
import { ROTOR, rotorGain, rotorRate } from '../src/audio/rotor';

describe('helicopter rotor sound', () => {
  it('played at its Doppler factor times the race\'s time scale (slower: deeper), never stopped dead', () => {
    expect(rotorRate(1, 1)).toBeCloseTo(1);
    expect(rotorRate(1.1, 0.5)).toBeCloseTo(0.55); // (coming closer, in slow motion)
    expect(rotorRate(0.9, 0.306)).toBeCloseTo(0.2754); // (going away, busted)
    expect(rotorRate(1, 0)).toBeGreaterThan(0); // (paused: silent by its gain, the loop still running)
  });

  it('as loud as ROTOR.volume at ROTOR.ref m, quieter further, none past its range; `loud` scales it (busted: half)', () => {
    expect(rotorGain(ROTOR.ref, 1)).toBeCloseTo(ROTOR.volume);
    expect(rotorGain(ROTOR.ref * 2, 1)).toBeLessThan(rotorGain(ROTOR.ref, 1));
    expect(rotorGain(ROTOR.range + 1, 1)).toBe(0);
    expect(rotorGain(60, 0.5)).toBeCloseTo(rotorGain(60, 1) / 2);
  });
});
