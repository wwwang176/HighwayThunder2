import { describe, it, expect } from 'vitest';
import { CARS, STREET_RACER } from '../src/vehicles/cars';

const ascending = (table: [number, number][]) => table.every(([kmh], i) => i === 0 || kmh > table[i - 1][0]);

describe('cars', () => {
  it('the supercar, the muscle car and the tuned JDM car, by id', () => {
    expect(CARS['street-racer'].name).toBe('超跑');
    expect(CARS['muscle-car'].name).toBe('肌肉車');
    expect(CARS.jdm.name).toBe('改裝車');
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

  it('the muscle car pulls harder but tops out lower than the supercar', () => {
    const m = CARS['muscle-car'].params;
    expect(m.maxSpeed).toBeLessThan(STREET_RACER.params.maxSpeed);
    expect(m.engineTorque).toBeGreaterThan(STREET_RACER.params.engineTorque);
  });
});
