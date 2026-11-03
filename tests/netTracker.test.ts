import { describe, it, expect } from 'vitest';
import { baseSteer, netDrive, netSteer, quietTracker, trackerFrom, trackerInputs, TRACKER_INPUTS } from '../src/ai/netTracker';
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
    expect(x[TRACKER_INPUTS - 3]).toBeCloseTo(0.1); // the plain tracker's steering
    expect(x[TRACKER_INPUTS - 2]).toBeCloseTo(0.5); // wheelspin, 2.5 m/s
    expect(x[TRACKER_INPUTS - 1]).toBeCloseTo(0.7); // the plan's throttle
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
