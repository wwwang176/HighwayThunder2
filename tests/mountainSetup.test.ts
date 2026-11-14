import { describe, it, expect } from 'vitest';
import { MOUNTAIN_SETUP, mountainAi, mountainSetup, mountainSetupOf } from '../src/vehicles/mountainSetup';
import { JDM_CAR, MUSCLE_CAR, STREET_RACER } from '../src/vehicles/cars';

describe('mountainSetup', () => {
  for (const spec of [STREET_RACER, MUSCLE_CAR, JDM_CAR]) {
    const p = spec.params;
    const s = mountainSetupOf(spec.id);
    const m = mountainSetup(p, s);

    it(`${spec.id}: its centre of mass lower (it leans and tips less), its front anti-roll bar as built, its rear's as set`, () => {
      expect(m.comY).toBeCloseTo(p.comY - MOUNTAIN_SETUP.comDrop, 9);
      expect(m.antiRollFront).toBe(p.antiRollFront);
      expect(m.antiRollRear).toBeCloseTo(p.antiRollRear * s.arbRear, 6);
    });

    it(`${spec.id}: grips harder braking and driving (straight on), its cornering grip as built`, () => {
      expect(m.longGrip).toBeCloseTo((p.longGrip ?? 1) * MOUNTAIN_SETUP.longGrip, 9);
      expect(m.latGrip).toBe(p.latGrip);
      expect(m.rollInfluence).toBe(p.rollInfluence);
    });

    it(`${spec.id}: its diff lets the rear wheels roll round a tight bend; brakes, stability control and steering as set`, () => {
      expect(m.lsdTurnFree).toBeGreaterThanOrEqual(MOUNTAIN_SETUP.lsdTurnFree);
      expect(m.lsdTurnFree).toBeGreaterThanOrEqual(p.lsdTurnFree ?? 1);
      expect(m.brakeFrontBias).toBeCloseTo(p.brakeFrontBias + s.brakeBias, 6);
      expect(m.escGain).toBeCloseTo(p.escGain * s.esc, 6);
      expect(m.steerRise).toBeCloseTo(p.steerRise * MOUNTAIN_SETUP.steerRise, 6);
    });

    it(`${spec.id}: everything else as it was, and the car's own params untouched`, () => {
      expect(m.mass).toBe(p.mass);
      expect(m.muPeak).toBe(p.muPeak);
      expect(m.maxSteer).toBe(p.maxSteer);
      expect(m).not.toBe(p);
    });
  }

  it('its AI tables as set up: braking as much harder (the long grip), cornering and speeding up as they were', () => {
    const ai = mountainAi(STREET_RACER.ai);
    STREET_RACER.ai.brake.forEach(([kmh, a], i) => expect(ai.brake[i]).toEqual([kmh, a * MOUNTAIN_SETUP.longGrip]));
    expect(ai.latAccel).toEqual(STREET_RACER.ai.latAccel);
    expect(ai.accel).toEqual(STREET_RACER.ai.accel);
  });

  it('the muscle car (its tail loose already, its stability control light): its rear, brakes and stability control as built', () => {
    const s = mountainSetupOf(MUSCLE_CAR.id);
    expect(s.arbRear).toBe(1);
    expect(s.brakeBias).toBe(0);
    expect(s.esc).toBe(1);
    expect(s.comDrop).toBe(MOUNTAIN_SETUP.comDrop);
    expect(s.longGrip).toBe(MOUNTAIN_SETUP.longGrip);
    expect(mountainSetupOf(STREET_RACER.id)).toEqual(MOUNTAIN_SETUP);
    expect(mountainSetupOf('no-such-car')).toEqual(MOUNTAIN_SETUP);
  });

  it('a car whose diff is already free (lsdTurnFree 1) stays free', () => {
    expect(mountainSetup({ ...STREET_RACER.params, lsdTurnFree: 1 }).lsdTurnFree).toBe(1);
  });
});
