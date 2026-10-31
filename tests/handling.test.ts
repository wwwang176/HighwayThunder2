import { describe, it, expect } from 'vitest';
import { DEFAULT_CAR, driveCommand, steerLimit, smoothSteer, Gearbox, GEAR_TOP_KMH } from '../src/vehicles/handling';

const P = DEFAULT_CAR;

describe('driveCommand', () => {
  it('full throttle from standstill is traction limited', () => {
    const c = driveCommand({ throttle: 1, brake: 0, steer: 0 }, 0, P);
    expect(c.engineForce).toBeCloseTo(P.maxDriveForce);
    expect(c.brake).toBe(0);
  });
  it('power limited at high speed', () => {
    expect(driveCommand({ throttle: 1, brake: 0, steer: 0 }, 60, P).engineForce).toBeCloseTo(P.power / 60);
  });
  it('no drive beyond the rev limiter', () => {
    expect(driveCommand({ throttle: 1, brake: 0, steer: 0 }, P.maxSpeed + 0.1, P).engineForce).toBe(0);
  });
  it('brake key brakes while rolling forward', () => {
    const c = driveCommand({ throttle: 0, brake: 1, steer: 0 }, 20, P);
    expect(c.engineForce).toBe(0);
    expect(c.brake).toBe(1);
  });
  it('brake key reverses when (almost) stopped, up to reverseMax', () => {
    expect(driveCommand({ throttle: 0, brake: 1, steer: 0 }, 0.2, P).engineForce).toBeLessThan(0);
    expect(driveCommand({ throttle: 0, brake: 1, steer: 0 }, -P.reverseMax - 0.1, P).engineForce).toBe(0);
  });
  it('throttle while rolling backwards brakes first', () => {
    const c = driveCommand({ throttle: 1, brake: 0, steer: 0 }, -3, P);
    expect(c.engineForce).toBe(0);
    expect(c.brake).toBeGreaterThan(0);
  });
  it('handbrake holds the car', () => {
    const c = driveCommand({ throttle: 0, brake: 0, steer: 0, handbrake: true }, 0, P);
    expect(c.engineForce).toBe(0);
    expect(c.brake).toBe(1);
  });
});

describe('steering', () => {
  it('full lock at low speed, tiny angle at 300 km/h', () => {
    expect(steerLimit(2, P)).toBeCloseTo(P.maxSteer);
    const high = steerLimit(83.3, P);
    expect(high).toBeLessThan(0.025);
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

describe('Gearbox', () => {
  it('starts in 1st and limits wheel speed per gear', () => {
    const g = new Gearbox();
    expect(g.gear).toBe(1);
    expect(g.wheelSpeedLimit()).toBeCloseTo(GEAR_TOP_KMH[0] / 3.6);
  });
  it('upshifts on road speed, not on wheelspin', () => {
    const g = new Gearbox();
    g.update(5, 0.05); // car slow, wheels spinning wildly → stays in 1st
    expect(g.gear).toBe(1);
    g.update((GEAR_TOP_KMH[0] / 3.6) * 0.95, 0.05);
    expect(g.gear).toBe(2);
  });
  it('downshifts when slowing and never skips below 1 or above 6', () => {
    const g = new Gearbox();
    for (let i = 0; i < 20; i++) g.update(90, 0.5);
    expect(g.gear).toBe(6);
    for (let i = 0; i < 20; i++) g.update(3, 0.5);
    expect(g.gear).toBe(1);
  });
});

describe('engine through the gearbox', () => {
  const R = 0.34;
  it('1st gear at launch overpowers the rear tyres (burnout), but not once rolling with weight transfer', () => {
    const g = new Gearbox();
    const rearStatic = (P.mass * 9.81) / 2;
    expect(g.wheelTorque(1, 0, P) / R).toBeGreaterThan(P.muPeak * P.rearGrip * (rearStatic + 1900));
    // Mid 1st gear, wheels rolling: peak grip with weight transfer holds the engine.
    const omega = 45 / 3.6 / R;
    expect(g.wheelTorque(1, omega, P) / R).toBeLessThan(P.muPeak * P.rearGrip * (rearStatic + 1900));
  });
  it('2nd gear (from its upshift speed) does not overpower the rear tyres', () => {
    const g = new Gearbox();
    g.gear = 2;
    const omega = (GEAR_TOP_KMH[0] * 0.93) / 3.6 / R;
    expect(g.wheelTorque(1, omega, P) / R).toBeLessThan(P.muPeak * P.rearGrip * ((P.mass * 9.81) / 2 + 1500));
  });
  it('torque converter multiplies torque at launch and fades out with wheel speed', () => {
    const g = new Gearbox();
    const atRest = g.wheelTorque(1, 0, P);
    const rolling = g.wheelTorque(1, 40 / 3.6 / R, P);
    expect(atRest).toBeGreaterThan(rolling * 1.5);
  });
  it('higher gears multiply less', () => {
    const g = new Gearbox();
    const t1 = g.wheelTorque(1, 0, P);
    g.gear = 4;
    expect(g.wheelTorque(1, 0, P)).toBeLessThan(t1 / 2);
  });
  it('rpm follows wheel speed and gear; rev limiter cuts torque', () => {
    const g = new Gearbox();
    const vTop = GEAR_TOP_KMH[0] / 3.6;
    expect(g.engineRpm(vTop / R)).toBeCloseTo(P.redline, -1);
    expect(g.engineRpm(0)).toBe(P.idleRpm);
    expect(g.wheelTorque(1, (vTop * 1.01) / R, P)).toBe(0);
  });
  it('power-limited near the top of a gear', () => {
    const g = new Gearbox();
    g.gear = 6;
    const omega = 80 / R;
    const t = g.wheelTorque(1, omega, P);
    expect(t * omega).toBeLessThanOrEqual(P.power * P.driveEfficiency + 1);
  });
});
