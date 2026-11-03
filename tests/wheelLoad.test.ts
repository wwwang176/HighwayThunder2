import { describe, it, expect } from 'vitest';
import { wheelLoad } from '../src/vehicles/playerCar';

describe('wheelLoad', () => {
  it('splits the weight evenly with the centre of mass midway between the axles', () => {
    const p = { mass: 1400, comFwd: 0, wheelbase: 2.6 };
    expect(wheelLoad(p, true)).toBeCloseTo(350);
    expect(wheelLoad(p, false)).toBeCloseTo(350);
  });

  it('puts 0.5 + comFwd / wheelbase of the weight on the front tyres, and all of it on the four', () => {
    const p = { mass: 1450, comFwd: 0.127, wheelbase: 2.54 }; // 55 / 45
    expect(wheelLoad(p, true)).toBeCloseTo((1450 * 0.55) / 2);
    expect(2 * wheelLoad(p, true) + 2 * wheelLoad(p, false)).toBeCloseTo(1450);
  });
});
