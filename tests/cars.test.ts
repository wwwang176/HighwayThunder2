import { describe, it, expect } from 'vitest';
import { CARS, POLICE_SUV, specById, STREET_RACER } from '../src/vehicles/cars';
import { PICKABLE } from '../src/game/carSelection';

const ascending = (table: [number, number][]) => table.every(([kmh], i) => i === 0 || kmh > table[i - 1][0]);

describe('cars', () => {
  it('the supercar, the muscle car and the tuned JDM car, by id', () => {
    for (const id of ['street-racer', 'muscle-car', 'jdm']) expect(CARS[id].id).toBe(id);
  });

  it('the JDM car grips harder than the supercar and tops out lowest of all', () => {
    const j = CARS.jdm.params;
    expect(j.muPeak).toBeGreaterThan(STREET_RACER.params.muPeak);
    for (const other of Object.values(CARS)) if (other.id !== 'jdm') expect(j.maxSpeed).toBeLessThan(other.params.maxSpeed);
  });

  it('every car has its AI tables by ascending speed', () => {
    for (const spec of Object.values(CARS)) {
      expect(ascending(spec.ai.accel)).toBe(true);
      expect(ascending(spec.ai.latAccel)).toBe(true);
    }
  });

  it('the police SUV: heavy, strong, not a car to pick', () => {
    expect(POLICE_SUV.params.mass).toBeGreaterThanOrEqual(2500);
    expect(POLICE_SUV.params.power).toBeGreaterThan(STREET_RACER.params.power);
    expect(PICKABLE).not.toContain(POLICE_SUV.id);
    expect(CARS[POLICE_SUV.id]).toBeUndefined();
    expect(specById(POLICE_SUV.id)).toBe(POLICE_SUV);
    expect(specById('jdm')).toBe(CARS.jdm);
    expect(ascending(POLICE_SUV.ai.accel) && ascending(POLICE_SUV.ai.brake) && ascending(POLICE_SUV.ai.latAccel)).toBe(true);
  });

  it('the muscle car pulls harder but tops out lower than the supercar', () => {
    const m = CARS['muscle-car'].params;
    expect(m.maxSpeed).toBeLessThan(STREET_RACER.params.maxSpeed);
    expect(m.engineTorque).toBeGreaterThan(STREET_RACER.params.engineTorque);
  });
});
