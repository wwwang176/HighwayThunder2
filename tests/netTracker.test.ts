import { describe, it, expect } from 'vitest';
import { baseSteer, netDrive, netSteer, quietTracker, trackerFrom, trackerInputs, TRACKER_INPUTS } from '../src/ai/netTracker';
import { forward, weightCount } from '../src/ai/brain';
import { mulberry32 } from '../src/ai/rng';
import { DEFAULT_CAR } from '../src/vehicles/handling';

// A plan moving one metre right over its first half second, then holding.
const plan = { points: [ { t: 0, s: 0, d: 0, v: 50 }, { t: 0.5, s: 25, d: 1, v: 50 }, { t: 1, s: 50, d: 1, v: 50 } ] };
const self = { s: 0, d: 0, yaw: 0, vLong: 50, vLat: 0, yawRate: 0, speedCap: 80, wheel: 0 };

describe('netTracker', () => {
  it('sees how far off the plan it is and how fast the plan moves, ahead', () => {
    const x = trackerInputs(plan, 0, { ...self, rearSpin: 2.5 }, 0.1, 0.7);
    expect(x.length).toBe(TRACKER_INPUTS);
    expect(x[0]).toBeCloseTo(0); // on the plan now
    expect(x[1]).toBeCloseTo(2 / 5); // the plan moves 2 m/s sideways
    expect(x[6]).toBeCloseTo(1 / 2); // 0.5 s ahead the plan is 1 m over
    expect(x[7]).toBeCloseTo(0); // ...and holds there
    expect(x[14]).toBeCloseTo(0.1); // the plain tracker's steering
    expect(x[15]).toBeCloseTo(0.5); // wheelspin, 2.5 m/s
    expect(x[16]).toBeCloseTo(0.7); // the plan's throttle
  });

  it('sees its heading off the road unclamped, the wrong way round too', () => {
    const across = trackerInputs(plan, 0, { ...self, yaw: Math.PI / 2, vLong: 0 }, 0, 0);
    const back = trackerInputs(plan, 0, { ...self, yaw: (3 * Math.PI) / 4, vLong: 0 }, 0, 0);
    expect(across[4 * 2 + 2]).toBe(3); // (the clamped heading: both the same)
    expect(back[4 * 2 + 2]).toBe(3);
    expect(across[17]).toBeCloseTo(1); // sin
    expect(across[18]).toBeCloseTo(1); // 1 - cos
    expect(back[17]).toBeCloseTo(Math.SQRT1_2);
    expect(back[18]).toBeCloseTo(1 + Math.SQRT1_2);
    const sliding = trackerInputs(plan, 0, { ...self, vLong: 10, vLat: 10 }, 0, 0);
    expect(sliding[19]).toBeCloseTo(0.5); // 45 deg of slide, of 90
  });

  it('a network from before the heading inputs drives exactly as it did', () => {
    const rng = mulberry32(3);
    const before = [TRACKER_INPUTS - 3, 12, 12, 2];
    const old = Array.from({ length: weightCount(before) }, () => rng() * 2 - 1);
    const b = trackerFrom(old)!;
    expect(b.layers).toEqual([TRACKER_INPUTS, 12, 12, 3]);
    for (let n = 0; n < 20; n++) {
      const x = Array.from({ length: TRACKER_INPUTS }, () => rng() * 4 - 2);
      const want = forward({ layers: before, weights: Float32Array.from(old) }, x.slice(0, TRACKER_INPUTS - 3));
      const got = forward(b, x);
      expect(got[0]).toBeCloseTo(want[0], 6);
      expect(got[1]).toBeCloseTo(want[1], 6);
      expect(got[2]).toBe(0); // it never backs up
    }
  });

  it('a network from before the reverse output drives exactly as it did, never backing up', () => {
    const rng = mulberry32(5);
    const before = [TRACKER_INPUTS, 12, 12, 2];
    const old = Array.from({ length: weightCount(before) }, () => rng() * 2 - 1);
    const b = trackerFrom(old)!;
    expect(b.layers).toEqual([TRACKER_INPUTS, 12, 12, 3]);
    for (let n = 0; n < 20; n++) {
      const x = Array.from({ length: TRACKER_INPUTS }, () => rng() * 4 - 2);
      const want = forward({ layers: before, weights: Float32Array.from(old) }, x);
      const got = forward(b, x);
      expect(got[0]).toBeCloseTo(want[0], 6);
      expect(got[1]).toBeCloseTo(want[1], 6);
    }
    const across = { ...self, yaw: 2, vLong: 0 };
    expect(netDrive(b, plan, 0, across, DEFAULT_CAR, 1).reverse).toBe(0);
  });

  it('backs up only standing across the road, steering the other way round', () => {
    const b = quietTracker(mulberry32(2));
    const L = b.layers;
    b.weights[b.weights.length - 1] = 5; // the reverse output's bias: all the way on
    expect(netDrive(b, plan, 0, self, DEFAULT_CAR, 1).reverse).toBe(0); // racing: never
    expect(netDrive(b, plan, 0, { ...self, vLong: 0 }, DEFAULT_CAR, 1).reverse).toBe(0); // the standing start: never
    const across = { ...self, yaw: 2, vLong: 0 };
    const r = netDrive(b, plan, 0, across, DEFAULT_CAR, 1);
    expect(r.reverse).toBeGreaterThan(0.99);
    expect(r.throttle).toBe(0);
    expect(r.steer).toBeCloseTo(-baseSteer(plan, 0, across, DEFAULT_CAR), 6);
    expect(L[L.length - 1]).toBe(3);
  });

  it('a steering-only network comes in steering the same and taking no throttle back', () => {
    const old = quietTracker(mulberry32(1)); // any weights of the old layout will do
    const steerOnly = Array.from({ length: (15 + 1) * 12 + (12 + 1) * 12 + (12 + 1) * 1 }, (_, i) => Math.sin(i));
    const b = trackerFrom(steerOnly)!;
    expect(b.layers).toEqual(old.layers);
    expect(netDrive(b, plan, 0.1, self, DEFAULT_CAR, 0.6).throttle).toBeCloseTo(0.6);
  });

  it('untrained (a quiet output layer) it steers exactly as the plain tracker', () => {
    const b = quietTracker(mulberry32(1));
    expect(netSteer(b, plan, 0.1, self, DEFAULT_CAR)).toBeCloseTo(baseSteer(plan, 0.1, self, DEFAULT_CAR), 6);
  });
});
