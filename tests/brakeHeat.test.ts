import { describe, it, expect } from 'vitest';
import { BRAKE_HEAT, discGlow, discHeatStep } from '../src/vehicles/brakeHeat';

const air = BRAKE_HEAT.ambient;

describe('brake disc heat', () => {
  it('heats by what the brake takes out of the turning wheel (gain x torque x speed of turning / capacity)', () => {
    const t = discHeatStep(air, 1000, 100, 0, 0.01); // 100 kW for 10 ms
    expect(t - air).toBeCloseTo((BRAKE_HEAT.gain * 1000 * 100 * 0.01) / BRAKE_HEAT.capacity, 6);
  });
  it('a locked or held wheel heats nothing', () => {
    expect(discHeatStep(air, 3000, 0, 40, 0.01)).toBe(air);
  });
  it('cools toward the air, quicker the faster the car, never past it', () => {
    const still = discHeatStep(600, 0, 0, 0, 1);
    const fast = discHeatStep(600, 0, 0, 60, 1);
    expect(still).toBeLessThan(600);
    expect(fast).toBeLessThan(still);
    expect(discHeatStep(600, 0, 0, 60, 1e4)).toBeCloseTo(air, 6);
  });
  it('never past its most', () => {
    expect(discHeatStep(990, 1e6, 300, 0, 1)).toBe(BRAKE_HEAT.most);
  });
  it('glows from glowFrom (0) to glowFull (1)', () => {
    expect(discGlow(air)).toBe(0);
    expect(discGlow(BRAKE_HEAT.glowFrom)).toBe(0);
    expect(discGlow((BRAKE_HEAT.glowFrom + BRAKE_HEAT.glowFull) / 2)).toBeCloseTo(0.5);
    expect(discGlow(BRAKE_HEAT.most)).toBe(1);
  });
});
