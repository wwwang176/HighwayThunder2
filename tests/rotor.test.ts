import { describe, expect, it } from 'vitest';
import { ROTOR, rotorBeat, rotorGain } from '../src/audio/rotor';
import { HELI } from '../src/game/helicopter';

describe('helicopter rotor sound', () => {
  it('beats blades x the rotor\'s turns a second, Doppler-shifted, at the race\'s time scale', () => {
    expect(ROTOR.rotorHz).toBe(HELI.rotorHz); // (heard turning as it is drawn turning)
    expect(rotorBeat(1, 1)).toBeCloseTo(ROTOR.blades * HELI.rotorHz);
    expect(rotorBeat(1.1, 0.5)).toBeCloseTo(ROTOR.blades * HELI.rotorHz * 0.55); // (coming closer, in slow motion)
  });

  it('as loud as ROTOR.volume at ROTOR.ref m, quieter further, none past its range; `loud` scales it (busted: half)', () => {
    expect(rotorGain(ROTOR.ref, 1)).toBeCloseTo(ROTOR.volume);
    expect(rotorGain(ROTOR.ref * 2, 1)).toBeLessThan(rotorGain(ROTOR.ref, 1));
    expect(rotorGain(ROTOR.range + 1, 1)).toBe(0);
    expect(rotorGain(60, 0.5)).toBeCloseTo(rotorGain(60, 1) / 2);
  });
});
