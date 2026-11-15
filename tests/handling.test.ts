import { describe, it, expect } from 'vitest';
import { BURNOUT_SPEED, DEFAULT_CAR, driveCommand, steerLimit, smoothSteer, Gearbox, GEAR_TOP_KMH, steerAngle, steerRange, escTargetYawRate, escYawCap, escTorque, effectiveMu, rollInfluenceAt, aeroGripScale, revsFalling, ENGINE_FALL_RATE, shuntRevs, SHUNT_RPM, SHUNT_TIME, limiterBounce, LIMITER_BOUNCE_RPM, LIMITER_BOUNCE_HZ, escPowerTrim, ESC_TRIM_FROM, ESC_TRIM_FULL, ESC_TRIM_LEAST, tractionTrim, TRACTION_LEAST, driftOn, driftEsc, driftDrive, driftLimit, driftCarve, driftRearGrip, driftRearLong, driftRamp, type DriftAssist } from '../src/vehicles/handling';
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
  it('D, (nearly) stopped, both keys: a burnout - the engine drives, the brakes (the front ones: playerCar) hold it', () => {
    const both = { throttle: 1, brake: 1, steer: 0 };
    for (const v of [0, BURNOUT_SPEED - 0.1]) {
      const c = driveCommand(both, v, P, 'D');
      expect(c.burnout).toBe(true);
      expect(c.engineForce).toBeGreaterThan(0);
      expect(c.brake).toBe(1);
      expect(c.mode).toBe('D');
    }
  });
  it('both keys while moving faster, or in R: no burnout, a brake as before', () => {
    const both = { throttle: 1, brake: 1, steer: 0 };
    const moving = driveCommand(both, BURNOUT_SPEED + 1, P, 'D');
    expect(moving.burnout).toBeFalsy();
    expect(moving.engineForce).toBe(0);
    expect(moving.brake).toBe(1);
    expect(driveCommand(both, 0, P, 'R').burnout).toBeFalsy();
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
  it('hold holds the car', () => {
    const c = driveCommand({ throttle: 0, brake: 0, steer: 0, hold: true }, 0, P, 'D');
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
  it('an upshift cuts the drive for shiftTime, then it comes back; a downshift does not', () => {
    const q = { ...P, shiftTime: 0.2 };
    const g = new Gearbox();
    const omega = (GEAR_TOP_KMH[0] * 0.95) / 3.6 / q.wheelRadius;
    g.update((GEAR_TOP_KMH[0] / 3.6) * 0.95, 0.01, q);
    expect(g.gear).toBe(2);
    expect(g.shifting).toBe(true);
    expect(g.wheelTorque(1, omega, q)).toBe(0);
    for (let t = 0; t < 0.19; t += 0.01) g.update((GEAR_TOP_KMH[0] / 3.6) * 0.95, 0.01, q);
    expect(g.wheelTorque(1, omega, q)).toBe(0);
    g.update((GEAR_TOP_KMH[0] / 3.6) * 0.95, 0.02, q);
    expect(g.shifting).toBe(false);
    expect(g.wheelTorque(1, omega, q)).toBeGreaterThan(0);
    // Down a gear: no cut.
    g.update(3, 1, q);
    expect(g.gear).toBe(1);
    expect(g.shifting).toBe(false);
  });
  it('through an upshift the revs fall away from the old gear\'s to the new gear\'s, as off the throttle, not at once', () => {
    const q = { ...P, shiftTime: 0.3 };
    const g = new Gearbox();
    const v = (GEAR_TOP_KMH[0] / 3.6) * 0.95;
    const omega = v / q.wheelRadius;
    const before = g.engineRpm(omega, q);
    g.update(v, 0.01, q, omega);
    const after = new Gearbox();
    after.gear = 2;
    const target = after.engineRpm(omega, q);
    expect(g.engineRpm(omega, q)).toBeGreaterThan(before - (before - target) * 0.1); // hardly dropped yet
    const seen: number[] = [];
    for (let t = 0; t < 0.3; t += 0.03) {
      g.update(v, 0.03, q, omega);
      seen.push(g.engineRpm(omega, q));
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThanOrEqual(seen[i - 1] + 1e-6); // falling all the way
    expect(seen[Math.floor(seen.length / 2)]).toBeGreaterThan(target + 1); // halfway, not there yet
    expect(g.engineRpm(omega, q)).toBeCloseTo(target, 0); // the shift done: the new gear's
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

describe('the engine winding down', () => {
  it('rises at once, falls no faster than its rate', () => {
    expect(revsFalling(1000, 6000, 0.01)).toBe(6000);
    expect(revsFalling(6000, 900, 0.1)).toBeCloseTo(6000 - ENGINE_FALL_RATE * 0.1);
    // a blip let go: back at the idle in about a second, not at once
    let rpm = 6000, t = 0;
    while (rpm > 900) { rpm = revsFalling(rpm, 900, 1 / 60); t += 1 / 60; }
    expect(t).toBeGreaterThan(0.9);
    expect(t).toBeLessThan(1.2);
  });

  it('never falls past the target', () => {
    expect(revsFalling(1000, 900, 1)).toBe(900);
  });
});

describe('the shunt as an upshift bites', () => {
  it('dips first, bounces back, and dies away', () => {
    expect(shuntRevs(0, 1)).toBeCloseTo(0);
    expect(shuntRevs(0.03, 1)).toBeLessThan(-50); // (the dip)
    expect(shuntRevs(0.15, 1)).toBeGreaterThan(0); // (the bounce)
    let peak = 0;
    for (let t = 0; t < SHUNT_TIME; t += 0.001) peak = Math.max(peak, Math.abs(shuntRevs(t, 1)));
    expect(peak).toBeLessThan(SHUNT_RPM);
    for (let t = 0.45; t < SHUNT_TIME; t += 0.01) expect(Math.abs(shuntRevs(t, 1))).toBeLessThan(SHUNT_RPM * 0.05);
    expect(shuntRevs(SHUNT_TIME + 0.01, 1)).toBe(0);
  });

  it('is as hard as the throttle: none off it', () => {
    expect(shuntRevs(0.03, 0)).toBeCloseTo(0);
    expect(shuntRevs(0.03, 0.5)).toBeCloseTo(shuntRevs(0.03, 1) / 2);
  });
});

describe('the gauge on the rev limiter', () => {
  it('drops quickly and climbs back, each cut, never above the revs', () => {
    const period = 1 / LIMITER_BOUNCE_HZ;
    expect(limiterBounce(0)).toBeCloseTo(0);
    expect(limiterBounce(period * 0.3)).toBeCloseTo(-LIMITER_BOUNCE_RPM);
    expect(limiterBounce(period * 0.65)).toBeCloseTo(-LIMITER_BOUNCE_RPM / 2);
    for (let t = 0; t < 1; t += 0.003) expect(limiterBounce(t)).toBeLessThanOrEqual(0);
    expect(limiterBounce(period * 1.3)).toBeCloseTo(-LIMITER_BOUNCE_RPM); // (again, the next cut)
  });
});

describe('escPowerTrim', () => {
  it('full power up to 20 deg of slide, down to 40 % by 45 deg, never less', () => {
    expect(escPowerTrim(0)).toBe(1);
    expect(escPowerTrim(ESC_TRIM_FROM)).toBe(1);
    expect(escPowerTrim((ESC_TRIM_FROM + ESC_TRIM_FULL) / 2)).toBeCloseTo(0.7, 6);
    expect(escPowerTrim(ESC_TRIM_FULL)).toBeCloseTo(ESC_TRIM_LEAST, 6);
    expect(escPowerTrim(Math.PI / 2)).toBeCloseTo(ESC_TRIM_LEAST, 6);
  });
});

describe('traction control (tractionTrim)', () => {
  const dt = 1 / 120;
  it('the rear tyres spinning past the target, its share of the drive falls; under it, rises back to all of it', () => {
    expect(tractionTrim(1, 5, 1, dt)).toBeLessThan(1);
    expect(tractionTrim(0.5, 0.2, 1, dt)).toBeGreaterThan(0.5);
    expect(tractionTrim(1, 0, 1, dt)).toBe(1);
  });
  it('the further over the target, the faster it falls - never under TRACTION_LEAST', () => {
    expect(tractionTrim(1, 10, 1, dt)).toBeLessThan(tractionTrim(1, 3, 1, dt));
    expect(tractionTrim(TRACTION_LEAST, 50, 1, 1)).toBe(TRACTION_LEAST);
  });
});

describe('drift assist (CarParams.drift)', () => {
  const D: DriftAssist = { minSpeed: 7, enter: 0.21, exit: 0.1, exitTime: 0.3, grace: 0.5, escFrom: 0.9, escFull: 1.3, rearGrip: 0.85, rearGripOn: 0.55, rampIn: 0.3, spring: 0.3, limit: 0.45, hold: 20_000, damp: 5000, holdMax: 8000, powerFrom: 0.5, powerTo: 0.8, least: 0.2, carve: 5, carveFull: 0.4 };
  const dt = 1 / 120;
  const st = (on: boolean, quiet = 0) => ({ on, quiet });
  it('on once the car slides past `enter` (either way: from the handbrake, the throttle, a flick), at speed; not crawling', () => {
    expect(driftOn(st(false), 0.3, 20, dt, D).on).toBe(true);
    expect(driftOn(st(false), -0.3, 20, dt, D).on).toBe(true);
    expect(driftOn(st(false), 0.15, 20, dt, D).on).toBe(false); // (a hard bend's own slide)
    expect(driftOn(st(false), 0.3, 3, dt, D).on).toBe(false);
  });
  it('on with a tap of the handbrake at speed (its slide not grown yet), given `grace` s more for it to grow before it can end', () => {
    let s = driftOn(st(false), 0.02, 20, dt, D, true);
    expect(s.on).toBe(true);
    for (let t = 0; t < D.grace + D.exitTime - 0.05; t += dt) s = driftOn(s, 0.02, 20, dt, D);
    expect(s.on).toBe(true);
    for (let t = 0; t < 0.1; t += dt) s = driftOn(s, 0.02, 20, dt, D);
    expect(s.on).toBe(false);
    expect(driftOn(st(false), 0, 3, dt, D, true).on).toBe(false); // (crawling: a handbrake turn, not a drift)
  });

  it('on while it slides, through a flick the other way; off once the slide has been under `exit` for exitTime, or crawling', () => {
    let s = driftOn(st(true), 0.15, 20, dt, D);
    expect(s.on).toBe(true); // (under enter, over exit: still on)
    s = driftOn(s, -0.4, 20, dt, D);
    expect(s.on).toBe(true);
    for (let t = 0; t < D.exitTime - 0.05; t += dt) s = driftOn(s, 0.05, 20, dt, D);
    expect(s.on).toBe(true);
    for (let t = 0; t < 0.1; t += dt) s = driftOn(s, 0.05, 20, dt, D);
    expect(s.on).toBe(false);
    expect(driftOn(st(true, 0.2), 0.3, 20, dt, D).quiet).toBe(0); // (sliding again: its quiet time anew)
    expect(driftOn(st(true), 0.3, 3, dt, D).on).toBe(false);
  });
  it('the drive all of it up to a slide of powerFrom, down to `least` of it by powerTo (full throttle on the keys not spinning it round)', () => {
    expect(driftDrive(0.3, D)).toBe(1);
    expect(driftDrive(0.5, D)).toBe(1);
    expect(driftDrive(0.65, D)).toBeCloseTo(0.6, 9);
    expect(driftDrive(1.2, D)).toBeCloseTo(0.2, 9);
  });
  it('the slide kept under `limit`: nothing under it (left to the driver), past it the body turned back the more the further past, its growing damped (+ slide: its motion to its right; a + torque turns it right, the slide less)', () => {
    expect(driftLimit(0.3, 0, D)).toBe(0);
    expect(driftLimit(0.3, 2, D)).toBe(0); // (growing, but under it: let be)
    expect(driftLimit(0.6, 0, D)).toBeGreaterThan(0);
    expect(driftLimit(0.7, 0, D)).toBeGreaterThan(driftLimit(0.6, 0, D));
    expect(driftLimit(-0.6, 0, D)).toBeLessThan(0); // (the other way)
    expect(driftLimit(0.6, 1, D)).toBeGreaterThan(driftLimit(0.6, 0, D)); // (growing: held back harder)
    expect(Math.abs(driftLimit(3, 5, D))).toBeLessThanOrEqual(D.holdMax);
  });
  it('off the throttle the slide held under `spring` (the handbrake swings it to there), on full throttle under `limit`, in between by it', () => {
    expect(driftLimit(0.35, 0, D, 0)).toBeGreaterThan(0); // (past the spring, off the throttle: turned back)
    expect(driftLimit(0.25, 0, D, 0)).toBe(0);
    expect(driftLimit(0.35, 0, D, 1)).toBe(0); // (on full throttle: let slide on)
    expect(driftLimit(0.4, 0, D, 0.5)).toBeCloseTo(driftLimit(0.325, 0, D, 0), 6); // (half throttle: the limit halfway, 0.375)
    expect(driftLimit(0.36, 0, D, 0.5)).toBe(0);
  });
  it('the stability control none of it in the slide, all of it as it nears a spin', () => {
    expect(driftEsc(0.3, D)).toBe(0);
    expect(driftEsc(D.escFrom, D)).toBe(0);
    expect(driftEsc((D.escFrom + D.escFull) / 2, D)).toBeCloseTo(0.5, 9);
    expect(driftEsc(1.5, D)).toBe(1);
  });
  it('the push toward the nose: on the throttle or off it, growing with the slide up to carveFull', () => {
    expect(driftCarve(0, D)).toBe(0);
    expect(driftCarve(0.2, D)).toBeCloseTo(2.5, 9);
    expect(driftCarve(-0.2, D)).toBeCloseTo(2.5, 9); // (either way: its size)
    expect(driftCarve(0.8, D)).toBe(5);
  });
  it('the drift eased in over rampIn s (its grip not dropped all at once), out at once', () => {
    let k = 0;
    for (let i = 0; i < Math.round(D.rampIn / 2 / dt); i++) k = driftRamp(k, true, dt, D);
    expect(k).toBeCloseTo(0.5, 6);
    for (let i = 0; i < Math.round(D.rampIn / dt); i++) k = driftRamp(k, true, dt, D);
    expect(k).toBe(1);
    expect(driftRamp(k, false, dt, D)).toBe(0);
  });
  it('the rear sideways grip: rearGrip off the throttle, rearGripOn on full throttle, in between by it', () => {
    expect(driftRearGrip(0, D)).toBeCloseTo(0.85, 9);
    expect(driftRearGrip(1, D)).toBeCloseTo(0.55, 9);
    expect(driftRearGrip(0.5, D)).toBeCloseTo(0.7, 9);
  });
  it('the rear straight on: as it was off the throttle, on full throttle as low as sideways (the tyres spin up: power oversteer)', () => {
    expect(driftRearLong(0, D) * driftRearGrip(0, D)).toBeCloseTo(1, 9);
    expect(driftRearLong(1, D)).toBeCloseTo(1, 9);
    expect(driftRearLong(0.5, D) * driftRearGrip(0.5, D)).toBeCloseTo(0.85, 9);
  });
});
