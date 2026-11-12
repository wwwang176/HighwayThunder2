import { describe, it, expect } from 'vitest';
import { solveWheel, DEFAULT_TIRE, WheelIn, lateralCurve, kineticMu } from '../src/vehicles/tireModel';

const dt = 1 / 120;
const R = 0.34;
const I = 1.2;
const Fz = 3200;

const base = (o: Partial<WheelIn>): WheelIn => ({
  vx: 0, vy: 0, omega: 0, Fz, driveTorque: 0, brakeTorque: 0, R, I, dt, mEff: Fz / 9.81, tire: DEFAULT_TIRE, ...o,
});

describe('lateralCurve', () => {
  it('rises to the peak then falls gently toward sliding friction', () => {
    const t = DEFAULT_TIRE;
    expect(lateralCurve(t.slipAnglePeak, t)).toBeCloseTo(t.muPeak);
    expect(lateralCurve(t.slipAnglePeak * 0.5, t)).toBeCloseTo(t.muPeak * 0.5);
    // Still ~90% of peak at 3x the peak slip angle; sliding level only far beyond.
    expect(lateralCurve(t.slipAnglePeak * 3, t)).toBeCloseTo(Math.max(t.muSlide, t.muPeak * 0.9));
    expect(lateralCurve(t.slipAnglePeak * 8, t)).toBeCloseTo(t.muSlide);
  });
});

describe('kineticMu', () => {
  it('sliding friction falls as the slip gets faster (burnouts keep spinning, slow slides grip more)', () => {
    const t = DEFAULT_TIRE;
    expect(kineticMu(0, t)).toBeCloseTo(t.muPeak);
    expect(kineticMu(5, t)).toBeLessThan(kineticMu(1, t));
    expect(kineticMu(60, t)).toBeCloseTo(t.muSlide, 2);
  });
});

describe('solveWheel', () => {
  it('free rolling: wheel speed follows ground speed, no force', () => {
    const r = solveWheel(base({ vx: 30, omega: 30 / R }));
    expect(r.omega * R).toBeCloseTo(30, 3);
    expect(Math.abs(r.Fx)).toBeLessThan(0.02 * Fz);
    expect(r.sliding).toBe(false);
  });

  it('moderate throttle at speed: grip, force ≈ torque / R', () => {
    const r = solveWheel(base({ vx: 30, omega: 30 / R, driveTorque: 500 }));
    expect(r.sliding).toBe(false);
    expect(r.Fx).toBeCloseTo(500 / R - DEFAULT_TIRE.rollingResistance * Fz, -1);
  });

  it('full torque from standstill beyond grip → wheelspin', () => {
    let w = { omega: 0 };
    let r = solveWheel(base({ vx: 0, omega: 0, driveTorque: 1700 }));
    for (let i = 0; i < 12; i++) {
      w = { omega: r.omega };
      r = solveWheel(base({ vx: 0.5, omega: w.omega, driveTorque: 1700 }));
    }
    expect(r.sliding).toBe(true);
    expect(r.omega * R).toBeGreaterThan(3); // tyre surface much faster than the car
    expect(r.Fx).toBeLessThanOrEqual(kineticMu(r.slip * 0.5, DEFAULT_TIRE) * Fz + 1); // well below peak grip
  });

  it('wheelspin starts even when the wheel was a hair below rolling speed (real launch)', () => {
    // Previous step gripped (omega = old rolling speed); the car has since sped up a bit.
    let omega = 2 / R;
    let vx = 2.02;
    let r = solveWheel(base({ vx, omega, driveTorque: 1700 }));
    for (let i = 0; i < 20; i++) {
      omega = r.omega;
      vx += 0.03;
      r = solveWheel(base({ vx, omega, driveTorque: 1700 }));
    }
    expect(r.sliding).toBe(true);
    expect(r.omega * R - vx).toBeGreaterThan(2);
  });

  it('hard braking at speed locks the wheel', () => {
    let omega = 40 / R;
    let r = solveWheel(base({ vx: 40, omega, brakeTorque: 3000 }));
    for (let i = 0; i < 30; i++) {
      omega = r.omega;
      r = solveWheel(base({ vx: 40, omega, brakeTorque: 3000 }));
    }
    expect(r.omega).toBeCloseTo(0, 5);
    expect(r.sliding).toBe(true);
    expect(r.Fx).toBeLessThan(0);
    expect(Math.abs(r.Fx)).toBeCloseTo(kineticMu(40, DEFAULT_TIRE) * Fz, -2);
  });

  it('a locked wheel has almost no cornering force left (friction circle)', () => {
    const rolling = solveWheel(base({ vx: 30, vy: 2, omega: 30 / R }));
    const locked = solveWheel(base({ vx: 30, vy: 2, omega: 0, brakeTorque: 3000 }));
    expect(Math.abs(locked.Fy)).toBeLessThan(Math.abs(rolling.Fy) * 0.5);
  });

  it('wheelspin also eats lateral grip', () => {
    const rolling = solveWheel(base({ vx: 15, vy: 1.5, omega: 15 / R }));
    const spinning = solveWheel(base({ vx: 15, vy: 1.5, omega: 30 / R, driveTorque: 1700 }));
    expect(spinning.sliding).toBe(true);
    expect(Math.abs(spinning.Fy)).toBeLessThan(Math.abs(rolling.Fy) * 0.6);
  });

  it('lateral force never overshoots at crawling speed', () => {
    const r = solveWheel(base({ vx: 0.2, vy: 0.05, omega: 0.2 / R }));
    // Impulse cannot exceed what stops the lateral motion this step.
    expect(Math.abs(r.Fy * dt)).toBeLessThanOrEqual((Fz / 9.81) * 0.05 + 1e-6);
  });

  it('wheel in the air: no forces, torque spins it freely', () => {
    const r = solveWheel(base({ Fz: 0, vx: 10, omega: 10 / R, driveTorque: 1000 }));
    expect(r.Fx).toBe(0);
    expect(r.Fy).toBe(0);
    expect(r.omega).toBeGreaterThan(10 / R);
  });

  it('cornering just past the limit at high speed keeps (nearly) peak grip - no sudden drop', () => {
    const v = 55;
    const alphaPeak = DEFAULT_TIRE.slipAnglePeak;
    // A little drive torque, as when holding the throttle through a corner.
    const below = solveWheel(base({ vx: v, vy: v * Math.tan(alphaPeak * 0.9), omega: v / R, driveTorque: 150 }));
    const above = solveWheel(base({ vx: v, vy: v * Math.tan(alphaPeak * 1.1), omega: v / R, driveTorque: 150 }));
    expect(Math.abs(above.Fy)).toBeGreaterThan(Math.abs(below.Fy) * 0.95);
  });

  it('total force always inside the friction circle', () => {
    for (const o of [
      { vx: 30, vy: 6, omega: 0, brakeTorque: 3000 },
      { vx: 10, vy: 3, omega: 60, driveTorque: 1700 },
      { vx: 50, vy: 10, omega: 50 / R },
    ]) {
      const r = solveWheel(base(o));
      expect(Math.hypot(r.Fx, r.Fy)).toBeLessThanOrEqual(DEFAULT_TIRE.muPeak * Fz + 1);
    }
  });
});

describe('front tyres braking apart (brakeApart)', () => {
  // Locked under a hard brake at 50 m/s, the tyre slipping sideways at the cornering force's peak angle.
  const locked = (brakeApart: boolean) =>
    solveWheel(base({ vx: 50, vy: 50 * Math.tan(DEFAULT_TIRE.slipAnglePeak), omega: 0, brakeTorque: 20_000, brakeApart }));

  it('keeps the whole cornering grip while locked and skidding (the brake takes none of it)', () => {
    const r = locked(true);
    expect(r.sliding).toBe(true); // still a skid: marks and smoke
    expect(Math.abs(r.Fy)).toBeCloseTo(DEFAULT_TIRE.muPeak * Fz, 0);
    expect(Math.abs(r.Fx)).toBeCloseTo(kineticMu(50, DEFAULT_TIRE) * Fz, 0);
  });

  it('shares one friction circle otherwise: a locked tyre hardly corners', () => {
    expect(Math.abs(locked(false).Fy)).toBeLessThan(0.5 * DEFAULT_TIRE.muPeak * Fz);
  });
});


describe('a locked tyre dragged (dragged: the handbrake)', () => {
  const drag = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return solveWheel(base({ vx: 25 * Math.cos(a), vy: 25 * Math.sin(a), omega: 0, brakeTorque: 3000, dragged: true }));
  };

  it('pushes straight against its slide: sideways by sin(the slip angle)', () => {
    for (const deg of [10, 30, 60]) {
      const r = drag(deg);
      const total = Math.hypot(r.Fx, r.Fy);
      expect(r.sliding).toBe(true);
      expect(-r.Fy / total).toBeCloseTo(Math.sin((deg * Math.PI) / 180), 3);
      expect(-r.Fx / total).toBeCloseTo(Math.cos((deg * Math.PI) / 180), 3);
    }
  });

  it('holds sideways more than one sharing the friction circle, the more the further it swings', () => {
    const shared = solveWheel(base({ vx: 25 * Math.cos(Math.PI / 6), vy: 25 * Math.sin(Math.PI / 6), omega: 0, brakeTorque: 3000 }));
    expect(Math.abs(drag(30).Fy)).toBeGreaterThan(3 * Math.abs(shared.Fy));
    expect(Math.abs(drag(60).Fy)).toBeGreaterThan(Math.abs(drag(30).Fy));
  });
});
