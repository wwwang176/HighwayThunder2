import { describe, it, expect } from 'vitest';
import { DEFAULT_CAR, driveCommand, steerLimit, smoothSteer } from '../src/vehicles/handling';

const P = DEFAULT_CAR;
const dt = 1 / 120;

describe('driveCommand', () => {
  it('full throttle from standstill is traction limited', () => {
    const c = driveCommand({ throttle: 1, brake: 0, steer: 0 }, 0, P, dt);
    expect(c.engineForce).toBeCloseTo(P.maxDriveForce);
    expect(c.brakeImpulse).toBe(0);
  });
  it('power limited at high speed', () => {
    const c = driveCommand({ throttle: 1, brake: 0, steer: 0 }, 60, P, dt);
    expect(c.engineForce).toBeCloseTo(P.power / 60);
  });
  it('no drive beyond the speed limiter', () => {
    expect(driveCommand({ throttle: 1, brake: 0, steer: 0 }, P.maxSpeed + 0.1, P, dt).engineForce).toBe(0);
  });
  it('brake key brakes while rolling forward', () => {
    const c = driveCommand({ throttle: 0, brake: 1, steer: 0 }, 20, P, dt);
    expect(c.engineForce).toBe(0);
    // Per-wheel impulse that would give brakeDecel across 4 wheels in one step.
    expect(c.brakeImpulse).toBeCloseTo((P.brakeDecel * P.mass * dt) / 4);
  });
  it('brake key reverses when (almost) stopped, up to reverseMax', () => {
    expect(driveCommand({ throttle: 0, brake: 1, steer: 0 }, 0.2, P, dt).engineForce).toBeLessThan(0);
    expect(driveCommand({ throttle: 0, brake: 1, steer: 0 }, -P.reverseMax - 0.1, P, dt).engineForce).toBe(0);
  });
  it('throttle while rolling backwards brakes first', () => {
    const c = driveCommand({ throttle: 1, brake: 0, steer: 0 }, -3, P, dt);
    expect(c.engineForce).toBe(0);
    expect(c.brakeImpulse).toBeGreaterThan(0);
  });
  it('handbrake holds the car', () => {
    const c = driveCommand({ throttle: 0, brake: 0, steer: 0, handbrake: true }, 0, P, dt);
    expect(c.engineForce).toBe(0);
    expect(c.brakeImpulse).toBeGreaterThan(0);
  });
});

describe('steering', () => {
  it('full lock at low speed, tiny angle at 300 km/h', () => {
    expect(steerLimit(2, P)).toBeCloseTo(P.maxSteer);
    const high = steerLimit(83.3, P);
    expect(high).toBeLessThan(0.015);
    expect(high).toBeGreaterThan(0.002);
  });
  it('limit keeps lateral accel near latAccelLimit (kinematic bicycle)', () => {
    for (const v of [20, 40, 60, 80]) {
      const a = (v * v * Math.tan(steerLimit(v, P))) / P.wheelbase;
      expect(a).toBeLessThanOrEqual(P.latAccelLimit + 1e-6);
    }
  });
  it('input smoothing ramps and returns faster', () => {
    let s = 0;
    s = smoothSteer(s, 1, P, 0.05);
    expect(s).toBeCloseTo(P.steerRise * 0.05);
    const back = smoothSteer(0.5, 0, P, 0.05);
    expect(back).toBeCloseTo(Math.max(0, 0.5 - P.steerFall * 0.05));
  });
});
