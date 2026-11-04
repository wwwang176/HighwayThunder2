import { describe, it, expect } from 'vitest';
import { stanleySteer, npcDriveForces, wheelLoads } from '../src/vehicles/npcDriver';

const L = 2.9;

describe('stanleySteer', () => {
  it('on the planned line and aligned → no steering', () => {
    expect(stanleySteer({ d: 1.875, yaw: 0, v: 30, yawRate: 0 }, 1.875, 0, L)).toBeCloseTo(0);
  });
  it('plan to the right → steer right (+)', () => {
    expect(stanleySteer({ d: 0, yaw: 0, v: 30, yawRate: 0 }, 1, 0, L)).toBeGreaterThan(0);
  });
  it('heading too far right while on the line → steer left (-)', () => {
    expect(stanleySteer({ d: 0, yaw: 0.05, v: 30, yawRate: 0 }, 0, 0, L)).toBeLessThan(0);
  });
  it('planned lateral motion is fed forward', () => {
    expect(stanleySteer({ d: 0, yaw: 0, v: 30, yawRate: 0 }, 0, 1.5, L)).toBeGreaterThan(0);
  });
  it('clamped to the comfort steering limit at speed', () => {
    const a = stanleySteer({ d: -10, yaw: 0, v: 30, yawRate: 0 }, 10, 0, L);
    // v^2 * tan(a) / L <= 6 m/s^2
    expect((30 * 30 * Math.tan(a)) / L).toBeLessThanOrEqual(6 + 1e-6);
  });
});

describe('npcDriveForces', () => {
  it('positive accel → engine force m*a, no brake', () => {
    const f = npcDriveForces(1.5, 25, 9000, 1 / 120);
    expect(f.engineForce).toBeCloseTo(13500);
    expect(f.brakeImpulse).toBe(0);
  });
  it('negative accel → brake impulse split over wheels', () => {
    const f = npcDriveForces(-4, 25, 1300, 1 / 120, 4);
    expect(f.engineForce).toBe(0);
    expect(f.brakeImpulse).toBeCloseTo((4 * 1300) / 120 / 4);
  });
  it('stopped and asked to brake → hold', () => {
    expect(npcDriveForces(-1, 0, 1300, 1 / 120).brakeImpulse).toBeGreaterThan(0);
  });
});

describe('wheelLoads', () => {
  it('two axles, centred mass → equal loads summing to weight', () => {
    const loads = wheelLoads(1000, [-1.3, 1.3]);
    expect(loads[0]).toBeCloseTo(1000 * 9.81 / 4);
    expect(loads[1]).toBeCloseTo(1000 * 9.81 / 4);
  });
  it('centre of mass ahead of the middle (comZ) → the front axle carries its share', () => {
    // 0.1 x the 2.6 m wheelbase toward the nose: 60 % on the front tyres.
    const loads = wheelLoads(1000, [-1.3, 1.3], undefined, undefined, -0.26);
    expect(loads[0] * 2).toBeCloseTo(1000 * 9.81 * 0.6);
    expect(loads[1] * 2).toBeCloseTo(1000 * 9.81 * 0.4);
  });
  it('extra point load on the rear axle goes to the rear', () => {
    const loads = wheelLoads(8000, [-1.9, 1.5, 2.5], { load: 60000, z: 2.0 });
    const total = (loads[0] + loads[1] + loads[2]) * 2;
    expect(total).toBeCloseTo(8000 * 9.81 + 60000);
    expect(loads[1]).toBeCloseTo(loads[2]);
    expect(loads[1]).toBeGreaterThan(loads[0]);
  });
  it('trailer: supported by kingpin in front and its own axles behind', () => {
    // kingpin at z=-5.65 carries part of the weight; wheels carry the rest
    const loads = wheelLoads(16000, [3.25, 4.25, 5.25], undefined, -5.65);
    const wheelsTotal = (loads[0] + loads[1] + loads[2]) * 2;
    const W = 16000 * 9.81;
    expect(wheelsTotal).toBeCloseTo((W * 5.65) / (5.65 + 4.25));
  });
});
