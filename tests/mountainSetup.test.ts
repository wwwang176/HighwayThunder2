import { describe, it, expect } from 'vitest';
import { MOUNTAIN_SETUP, mountainSetup } from '../src/vehicles/mountainSetup';
import { JDM_CAR, MUSCLE_CAR, STREET_RACER } from '../src/vehicles/cars';

describe('mountainSetup', () => {
  for (const spec of [STREET_RACER, MUSCLE_CAR, JDM_CAR]) {
    const p = spec.params;
    const m = mountainSetup(p);

    it(`${spec.id}: the front's anti-roll bar softer and the rear's stiffer (less understeer)`, () => {
      expect(m.antiRollFront).toBeCloseTo(p.antiRollFront * MOUNTAIN_SETUP.arbFront, 6);
      expect(m.antiRollRear).toBeCloseTo(p.antiRollRear * MOUNTAIN_SETUP.arbRear, 6);
      expect(m.antiRollFront / m.antiRollRear).toBeLessThan(p.antiRollFront / p.antiRollRear);
    });

    it(`${spec.id}: its diff lets the rear wheels roll round a tight bend; braking a little more on the rear; the stability control lighter; quicker steering`, () => {
      expect(m.lsdTurnFree).toBeGreaterThanOrEqual(MOUNTAIN_SETUP.lsdTurnFree);
      expect(m.lsdTurnFree).toBeGreaterThanOrEqual(p.lsdTurnFree ?? 1);
      expect(m.brakeFrontBias).toBeCloseTo(p.brakeFrontBias + MOUNTAIN_SETUP.brakeBias, 6);
      expect(m.escGain).toBeCloseTo(p.escGain * MOUNTAIN_SETUP.esc, 6);
      expect(m.steerRise).toBeCloseTo(p.steerRise * MOUNTAIN_SETUP.steerRise, 6);
    });

    it(`${spec.id}: everything else as it was, and the car's own params untouched`, () => {
      expect(m.mass).toBe(p.mass);
      expect(m.muPeak).toBe(p.muPeak);
      expect(m.maxSteer).toBe(p.maxSteer);
      expect(m).not.toBe(p);
    });
  }

  it('a car whose diff is already free (lsdTurnFree 1) stays free', () => {
    expect(mountainSetup({ ...STREET_RACER.params, lsdTurnFree: 1 }).lsdTurnFree).toBe(1);
  });
});
