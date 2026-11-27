import { describe, it, expect } from 'vitest';
import { coursePlan } from '../src/ai/coursePlanner';
import type { PlanEgo } from '../src/ai/planner';
import type { TrafficBox } from '../src/ai/sensors';
import { STREET_RACER } from '../src/vehicles/cars/streetRacer';

/**
 * Standing behind a standing car (the player stopped, a rival stopped behind it): pulling out round it from there.
 * At low speed a car turns about its rear axle - its nose and middle swing out faster than they would going round
 * the arc its middle is on; planned so (the middle on the arc), it needed 4.25 m of room ahead, the car itself ~3.
 */
describe('coursePlan from a standstill behind a standing car', () => {
  const p = STREET_RACER.params;
  const hl = p.length / 2, hw = p.width / 2;
  const ego: PlanEgo = {
    s: 0, d: 0, v: 0, speedCap: p.maxSpeed, yaw: 0, vLat: 0, vD: 0, halfLength: hl, halfWidth: hw,
    accel: STREET_RACER.ai.accel, latAccel: STREET_RACER.ai.latAccel, brake: STREET_RACER.ai.brake,
    turnMax: Math.tan(p.maxSteer) / p.wheelbase, rearOffset: p.wheelbase / 2,
  };
  /** A standing car `gap` m ahead, bumper to bumper, `off` m to the side. */
  const ahead = (gap: number, off = 0): TrafficBox => ({ id: 9, s: hl + gap + 2.2, dMin: off - 0.95, dMax: off + 0.95, v: 0, length: 4.4, body: { yaw: 0, halfLength: 2.2, halfWidth: 0.95 } });
  const end = (gap: number, off = 0) => {
    const plan = coursePlan(ego, [ahead(gap, off)], null);
    return plan.points[plan.points.length - 1].s;
  };

  it('3.5 m of room ahead is enough to pull out round it', () => {
    expect(end(3.5)).toBeGreaterThan(20);
    expect(end(3, 0.9)).toBeGreaterThan(20);
  });

  it('but not 1.5 m (it does not back up)', () => {
    expect(end(1.5)).toBeLessThan(2);
  });
});
