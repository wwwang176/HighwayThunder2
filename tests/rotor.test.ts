import { describe, expect, it } from 'vitest';
import { ROTOR, rotorBeat } from '../src/audio/rotor';
import { HELI } from '../src/game/helicopter';

describe('helicopter rotor sound', () => {
  it('beats blades x the rotor\'s turns a second, Doppler-shifted, at the race\'s time scale', () => {
    expect(ROTOR.rotorHz).toBe(HELI.rotorHz); // (heard turning as it is drawn turning)
    expect(rotorBeat(1, 1)).toBeCloseTo(ROTOR.blades * HELI.rotorHz);
    expect(rotorBeat(1.1, 0.5)).toBeCloseTo(ROTOR.blades * HELI.rotorHz * 0.55); // (coming closer, in slow motion)
  });
});
