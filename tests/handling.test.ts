import { describe, it, expect } from 'vitest';
import { DEFAULT_CAR, driveCommand, steerLimit, smoothSteer, Gearbox, GEAR_TOP_KMH, steerAngle, steerRange } from '../src/vehicles/handling';

const P = DEFAULT_CAR;

describe('driveCommand', () => {
  const T = { throttle: 1, brake: 0, steer: 0 };
  const B = { throttle: 0, brake: 1, steer: 0 };
  it('D: full throttle from standstill is traction limited', () => {
    const c = driveCommand(T, 0, P, 'D');
    expect(c.engineForce).toBeCloseTo(P.maxDriveForce);
    expect(c.brake).toBe(0);
    expect(c.mode).toBe('D');
  });
  it('D: power limited at speed, nothing past the limiter', () => {
    expect(driveCommand(T, 60, P, 'D').engineForce).toBeCloseTo(P.power / 60);
    expect(driveCommand(T, P.maxSpeed + 0.1, P, 'D').engineForce).toBe(0);
  });
  it('D: brake key brakes while moving, in either direction', () => {
    for (const v of [20, -20, -3]) {
      const c = driveCommand(B, v, P, 'D');
      expect(c.engineForce).toBe(0);
      expect(c.brake).toBe(1);
      expect(c.mode).toBe('D');
    }
  });
  it('D: throttle while rolling backwards (e.g. after a spin) brakes, stays in D', () => {
    const c = driveCommand(T, -15, P, 'D');
    expect(c.engineForce).toBe(0);
    expect(c.brake).toBe(1);
    expect(c.mode).toBe('D');
  });
  it('R is only selected when stopped and the back key is pressed', () => {
    const c = driveCommand(B, 0.2, P, 'D');
    expect(c.mode).toBe('R');
    expect(c.engineForce).toBeLessThan(0);
  });
  it('R: back key reverses up to reverseMax, throttle key brakes', () => {
    expect(driveCommand(B, -3, P, 'R').engineForce).toBeLessThan(0);
    expect(driveCommand(B, -P.reverseMax - 0.1, P, 'R').engineForce).toBe(0);
    const w = driveCommand(T, -5, P, 'R');
    expect(w.engineForce).toBe(0);
    expect(w.brake).toBe(1);
    expect(w.mode).toBe('R');
  });
  it('R: back key brakes if the car is rolling forwards', () => {
    const c = driveCommand(B, 10, P, 'R');
    expect(c.engineForce).toBe(0);
    expect(c.brake).toBe(1);
  });
  it('D is selected again when stopped and the throttle is pressed', () => {
    const c = driveCommand(T, -0.1, P, 'R');
    expect(c.mode).toBe('D');
    expect(c.engineForce).toBeGreaterThan(0);
  });
  it('handbrake holds the car', () => {
    const c = driveCommand({ throttle: 0, brake: 0, steer: 0, handbrake: true }, 0, P, 'D');
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

describe('steering range from speed (grip-limit turn + peak slip angle)', () => {
  it('one formula: full lock when slow, just past the peak slip angle at 250 km/h', () => {
    expect(steerRange(25 / 3.6, P)).toBeCloseTo(P.maxSteer);
    const r250 = steerRange(250 / 3.6, P);
    expect(r250).toBeGreaterThan(P.slipAnglePeak);
    expect(r250).toBeLessThan(P.slipAnglePeak + 0.01);
    // Monotonic: never wider at higher speed.
    let prev = Infinity;
    for (let kmh = 10; kmh <= 300; kmh += 10) {
      const r = steerRange(kmh / 3.6, P);
      expect(r).toBeLessThanOrEqual(prev + 1e-12);
      prev = r;
    }
  });
  it('target: front axle travel (slip + rotation) + input × peak slip angle', () => {
    const v = 15;
    const r = 0.8;
    const travel = Math.atan2(0 + r * (P.wheelbase / 2), v);
    expect(steerAngle(1, v, 0, r, P)).toBeCloseTo(Math.min(travel + P.slipAnglePeak, steerRange(v, P)));
    expect(steerAngle(0, v, 0, r, P)).toBeCloseTo(travel); // hands off: wheels trail the motion
  });
  it('driving straight at speed: full input = peak slip angle', () => {
    expect(steerAngle(1, 250 / 3.6, 0, 0, P)).toBeCloseTo(P.slipAnglePeak);
  });
  it('at high speed the rotation term is bounded by the grip-limit range around the travel direction', () => {
    const v = 250 / 3.6;
    const a = steerAngle(1, v, 0, 3, P); // spinning hard
    expect(a).toBeLessThanOrEqual(steerRange(v, P) + 1e-9);
  });
  it('in a slide the wheels already point along the travel direction', () => {
    const v = 40;
    expect(steerAngle(0, v, 4, 0, P)).toBeCloseTo(Math.atan2(4, v));
  });
  it('reversing and walking pace: plain steering lock; never exceeds full lock', () => {
    expect(steerAngle(1, -5, 1, 0.2, P)).toBeCloseTo(P.maxSteer);
    expect(steerAngle(1, 2, 0, 0, P)).toBeCloseTo(P.maxSteer);
    expect(Math.abs(steerAngle(1, 30, 30, 2, P))).toBeLessThanOrEqual(P.maxSteer);
  });
});
