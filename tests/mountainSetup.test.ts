import { describe, it, expect } from 'vitest';
import { MOUNTAIN_SETUP, mountainAi, mountainSetup, mountainSetupOf } from '../src/vehicles/mountainSetup';
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

  it('grips harder cornering: its cornering grip times MOUNTAIN_SETUP.grip (1.25), on top of its own camber', () => {
    expect(MOUNTAIN_SETUP.grip).toBe(1.25);
    expect(mountainSetup(STREET_RACER.params).latGrip).toBeCloseTo(1.25, 9);
    expect(mountainSetup({ ...STREET_RACER.params, latGrip: 1.1 }).latGrip).toBeCloseTo(1.375, 9);
  });

  it('its AI tables as set up: cornering as much harder, speeding up and braking as they were', () => {
    const ai = mountainAi(STREET_RACER.ai);
    STREET_RACER.ai.latAccel.forEach(([kmh, a], i) => expect(ai.latAccel[i]).toEqual([kmh, a * MOUNTAIN_SETUP.grip]));
    expect(ai.accel).toEqual(STREET_RACER.ai.accel);
    expect(ai.brake).toEqual(STREET_RACER.ai.brake);
  });

  it('the muscle car (its tail loose already, its stability control light): only its front bar softer and the grip', () => {
    const s = mountainSetupOf(MUSCLE_CAR.id);
    expect(s.arbFront).toBe(MOUNTAIN_SETUP.arbFront);
    expect(s.grip).toBe(MOUNTAIN_SETUP.grip);
    expect(s.arbRear).toBe(1);
    expect(s.brakeBias).toBe(0);
    expect(s.esc).toBe(1);
    expect(mountainSetupOf(STREET_RACER.id)).toEqual(MOUNTAIN_SETUP);
    expect(mountainSetupOf('no-such-car')).toEqual(MOUNTAIN_SETUP);
  });

  it("its AI's cornering: as much harder as the car's own `aiGrip` (the muscle car's less: its tail, not its grip, the limit)", () => {
    expect(mountainSetupOf(STREET_RACER.id).aiGrip).toBe(MOUNTAIN_SETUP.grip);
    const muscle = mountainSetupOf(MUSCLE_CAR.id);
    expect(muscle.aiGrip).toBeLessThan(muscle.grip);
    const ai = mountainAi(MUSCLE_CAR.ai, muscle);
    expect(ai.latAccel[2][1]).toBeCloseTo(MUSCLE_CAR.ai.latAccel[2][1] * muscle.aiGrip, 9);
  });

  it('gripping harder it leans no more: the rolling torque its body gets as much less (it tipped the muscle car over)', () => {
    for (const spec of [STREET_RACER, MUSCLE_CAR, JDM_CAR]) {
      const s = mountainSetupOf(spec.id);
      expect(mountainSetup(spec.params, s).rollInfluence).toBeCloseTo(spec.params.rollInfluence / s.grip, 9);
    }
  });

  it('a car whose diff is already free (lsdTurnFree 1) stays free', () => {
    expect(mountainSetup({ ...STREET_RACER.params, lsdTurnFree: 1 }).lsdTurnFree).toBe(1);
  });
});
