import { describe, it, expect } from 'vitest';
import { DEFAULT_CAR, driveCommand, steerLimit, smoothSteer, Gearbox, GEAR_TOP_KMH, steerAngle, steerRange, escTargetYawRate, escYawCap, escTorque, effectiveMu, rollInfluenceAt, aeroGripScale } from '../src/vehicles/handling';
import { withMass } from '../src/vehicles/cars/mass';

const P = DEFAULT_CAR;

describe('withMass', () => {
  it('a heavier car with every force as much heavier: the same per kilogram, speeds and grip as they were', () => {
    const base = { ...P, mass: 1000 };
    const h = withMass(base, 1250);
    expect(h.mass).toBe(1250);
    for (const k of ['power', 'engineTorque', 'maxDriveForce', 'brakeForceMax', 'dragK', 'downforceK', 'springK', 'damperBump', 'antiRollFront', 'wheelInertia', 'lsd', 'lsdMax', 'escMaxTorque'] as const) {
      expect(h[k] / h.mass).toBeCloseTo(base[k] / base.mass, 9);
    }
    expect(h.maxSpeed).toBe(base.maxSpeed);
    expect(h.muPeak).toBe(base.muPeak);
    expect(h.suspensionRest).toBe(base.suspensionRest);
  });
});

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
  it('optional speed-scaled turn-in (off by default), returning stays quick', () => {
    expect(smoothSteer(0, 1, P, 0.05, 55)).toBeCloseTo(smoothSteer(0, 1, P, 0.05, 5));
    const Q = { ...P, steerSlowdownSpeed: 40 };
    expect(smoothSteer(0, 1, Q, 0.05, 55)).toBeLessThan(smoothSteer(0, 1, Q, 0.05, 0) / 2);
    expect(smoothSteer(0.5, 0, Q, 0.05, 55)).toBeCloseTo(smoothSteer(0.5, 0, Q, 0.05, 5));
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
  const R = P.wheelRadius;
  it('1st gear overpowers the rear tyres, at launch and still rolling (the 1.5x engine: a street racer)', () => {
    const g = new Gearbox();
    const rearStatic = (P.mass * 9.81) / 2;
    expect(g.wheelTorque(1, 0, P) / R).toBeGreaterThan(P.muPeak * P.rearGrip * (rearStatic + 1900));
    // Mid 1st gear, wheels rolling: even with weight transfer the tyres cannot hold it all (it was the
    // other way round before the engine was made 1.5x stronger for more pull at 150-250 km/h).
    const omega = 45 / 3.6 / R;
    expect(g.wheelTorque(1, omega, P) / R).toBeGreaterThan(P.muPeak * P.rearGrip * (rearStatic + 1900));
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
    expect(r250).toBeLessThan(P.slipAnglePeak + 0.02);
    // Monotonic: never wider at higher speed.
    let prev = Infinity;
    for (let kmh = 10; kmh <= 300; kmh += 10) {
      const r = steerRange(kmh / 3.6, P);
      expect(r).toBeLessThanOrEqual(prev + 1e-12);
      prev = r;
    }
  });
  it('steering into the slide: exactly the input, relative to the nose (no automatic correction)', () => {
    const v = 40;
    const slide = v * Math.tan(0.4);
    expect(steerAngle(-1, v, slide, P)).toBeCloseTo(-steerRange(v, P));
    expect(steerAngle(1, v, -slide, P)).toBeCloseTo(steerRange(v, P));
  });
  it('counter-steering: the input on top of the wheels lined up with the direction of travel (more than hands off)', () => {
    const v = 40;
    const beta = 0.15;
    const slide = v * Math.tan(beta);
    expect(steerAngle(1, v, slide, P)).toBeCloseTo(Math.min(P.maxSteer, steerRange(v, P) + beta));
    expect(steerAngle(-1, v, -slide, P)).toBeCloseTo(-Math.min(P.maxSteer, steerRange(v, P) + beta));
    expect(steerAngle(0.1, v, slide, P)).toBeGreaterThan(steerAngle(0, v, slide, P));
  });
  it('hands off: the wheels trail the direction of travel at counterSteer strength', () => {
    const v = 40;
    const beta = 0.4;
    expect(steerAngle(0, v, v * Math.tan(beta), P)).toBeCloseTo(beta * P.counterSteer);
    expect(steerAngle(0, v, 0, P)).toBe(0);
  });
  it('a partly pressed key blends input and trailing (counter-steering: toward lining up fully)', () => {
    const v = 40;
    const beta = 0.2;
    expect(steerAngle(0.5, v, v * Math.tan(beta), P)).toBeCloseTo(0.5 * steerRange(v, P) + beta * (0.5 * P.counterSteer + 0.5));
    expect(steerAngle(-0.5, v, v * Math.tan(beta), P)).toBeCloseTo(-0.5 * steerRange(v, P) + 0.5 * beta * P.counterSteer);
  });
  it('driving at 250 km/h: full input just past the peak slip angle', () => {
    expect(steerAngle(1, 250 / 3.6, 0, P)).toBeCloseTo(steerRange(250 / 3.6, P));
    expect(steerAngle(1, 250 / 3.6, 0, P)).toBeGreaterThan(P.slipAnglePeak);
  });
  it('reversing: full lock; never exceeds full lock', () => {
    expect(steerAngle(1, -5, 0, P)).toBeCloseTo(P.maxSteer);
    expect(Math.abs(steerAngle(0, 30, 300, P))).toBeLessThanOrEqual(P.maxSteer);
  });
});

describe('stability control (ESC)', () => {
  const v = 250 / 3.6;
  it('target yaw rate follows the steering but is capped by what the tyres (with downforce) allow', () => {
    const cap = escYawCap(v, P);
    expect(escTargetYawRate(0.02, v, P)).toBeCloseTo(Math.min(cap, (v * Math.tan(0.02)) / P.wheelbase));
    expect(escTargetYawRate(0.3, v, P)).toBeCloseTo(cap);
    expect(escTargetYawRate(-0.3, v, P)).toBeCloseTo(-cap);
  });
  it('downforce raises the cap at speed', () => {
    expect(escYawCap(v, P) * v).toBeGreaterThan(P.muPeak * 9.81 * 1.3);
  });
  it('corrective torque pushes the yaw rate toward the target, both ways, limited', () => {
    expect(escTorque(0.1, 0.3, v, P)).toBeGreaterThan(0); // understeering: help it rotate
    expect(escTorque(0.6, 0.3, v, P)).toBeLessThan(0); // oversteering: pull it back
    expect(Math.abs(escTorque(5, -5, v, P))).toBeLessThanOrEqual(P.escMaxTorque);
    expect(escTorque(0.6, 0.3, v, { ...P, escGain: 0 })).toBe(0);
    expect(escTorque(0.6, 0.3, 3, P)).toBe(0); // inactive when crawling
  });
});

describe('aeroGripScale', () => {
  const p = { ...DEFAULT_CAR, aeroGrip: 0.8, aeroGripFrom: 50, aeroGripTo: 250 };
  const at = (kmh: number) => aeroGripScale(kmh / 3.6, p);
  it('none below where it starts, all of it from where it ends, half way in the middle', () => {
    expect(at(0)).toBe(1);
    expect(at(50)).toBe(1);
    expect(at(150)).toBeCloseTo(1.4, 5);
    expect(at(250)).toBeCloseTo(1.8, 5);
    expect(at(320)).toBeCloseTo(1.8, 5);
  });
  it('an S-curve: slow to start and to finish, no kink', () => {
    expect(at(60) - at(50)).toBeLessThan(at(155) - at(145));
    expect(at(250) - at(240)).toBeLessThan(at(155) - at(145));
  });
});

describe('rollInfluenceAt', () => {
  const p = { ...DEFAULT_CAR, rollInfluence: 1, rollRefKmh: 150 };
  it('as set up to rollRefKmh, then less as the grip grows: the most rolling torque stays that there', () => {
    expect(rollInfluenceAt(100 / 3.6, p)).toBe(1);
    expect(rollInfluenceAt(150 / 3.6, p)).toBe(1);
    const at280 = rollInfluenceAt(280 / 3.6, p);
    expect(at280).toBeLessThan(1);
    expect(at280 * effectiveMu(280 / 3.6, p)).toBeCloseTo(effectiveMu(150 / 3.6, p), 5);
  });
});
