import { describe, it, expect } from 'vitest';
import { CARS, STREET_RACER } from '../src/vehicles/cars';

const ascending = (table: [number, number][]) => table.every(([kmh], i) => i === 0 || kmh > table[i - 1][0]);

describe('cars', () => {
  it('the supercar and the muscle car, by id', () => {
    expect(CARS['street-racer'].name).toBe('超跑');
    expect(CARS['muscle-car'].name).toBe('肌肉車');
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
