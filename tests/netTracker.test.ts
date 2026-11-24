import { describe, it, expect } from 'vitest';
import { baseSteer, netDrive, netSteer, quietTracker, trackerFrom, trackerInputs, TRACKER_INPUTS, TRACKER_LAYERS } from '../src/ai/netTracker';
import { weightCount } from '../src/ai/brain';
import { mulberry32 } from '../src/ai/rng';
import { DEFAULT_CAR } from '../src/vehicles/handling';
import { MEDIAN_NEAR_X, RAIL_D } from '../src/config';

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

  it('sees how far the road goes either side and what the seat feels', () => {
    const x = trackerInputs(plan, 0, { ...self, d: 5, aLong: -5, aLat: 2, rollRate: 0.25, pitchRate: -0.1 }, 0, 0);
    expect(x.length).toBe(TRACKER_INPUTS);
    expect(x[20]).toBeCloseTo((RAIL_D - 5) / 5); // 5 m to the rail on its right
    expect(x[21]).toBeCloseTo((5 - MEDIAN_NEAR_X) / 5); // 15 m to the grass on its left
    expect(x[22]).toBeCloseTo(-0.5); // braking at 5 m/s²
    expect(x[23]).toBeCloseTo(0.2);
    expect(x[24]).toBeCloseTo(0.5);
    expect(x[25]).toBeCloseTo(-0.2);
    const onGrass = trackerInputs(plan, 0, { ...self, d: MEDIAN_NEAR_X - 3 }, 0, 0);
    expect(onGrass[21]).toBeCloseTo(-3 / 5); // 3 m onto it
  });

  it('untrained (a quiet output layer) it steers exactly as the plain tracker, the plan\'s throttle all kept', () => {
    const b = quietTracker(mulberry32(1));
    expect(netSteer(b, plan, 0.1, self, DEFAULT_CAR)).toBeCloseTo(baseSteer(plan, 0.1, self, DEFAULT_CAR), 6);
    expect(netDrive(b, plan, 0, self, DEFAULT_CAR, 0.3).throttle).toBeCloseTo(0.3);
  });

  it('takes back at most the throttle the plan asks for', () => {
    const b = quietTracker(mulberry32(2));
    const n = b.weights.length;
    b.weights[n - 1] = -5; // the throttle output's bias: take it all back
    expect(netDrive(b, plan, 0, self, DEFAULT_CAR, 0.8).throttle).toBeCloseTo(0, 3);
    b.weights[n - 1] = 5; // ...or none (never more than asked for)
    expect(netDrive(b, plan, 0, self, DEFAULT_CAR, 0.8).throttle).toBeCloseTo(0.8, 6);
  });

  it('a network of another layout is none (the plain tracker steers)', () => {
    expect(trackerFrom(new Array(weightCount(TRACKER_LAYERS)).fill(0))?.layers).toEqual(TRACKER_LAYERS);
    expect(trackerFrom(new Array(weightCount(TRACKER_LAYERS) + 13).fill(0))).toBeNull();
    expect(trackerFrom(undefined)).toBeNull();
  });
});
