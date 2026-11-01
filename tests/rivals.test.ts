import { describe, it, expect } from 'vitest';
import { needsReset, rubberBand, RIVAL_TUNING } from '../src/game/rivals';
import { KMH } from '../src/config';
import { laneCenter } from '../src/road/coords';

const T = RIVAL_TUNING;
const cap = 300 * KMH;

describe('rubberBand', () => {
  it('level with the player or a little behind: as built', () => {
    expect(rubberBand(0, 40, cap)).toEqual({ boost: 0, speedCap: cap });
    expect(rubberBand(-T.boostFrom + 1, 40, cap)).toEqual({ boost: 0, speedCap: cap });
  });

  it('further behind: grip and engine boosted, up to the most at boostFull', () => {
    const mid = rubberBand(-(T.boostFrom + T.boostFull) / 2, 40, cap);
    expect(mid.boost).toBeCloseTo(T.maxBoost / 2, 5);
    expect(rubberBand(-T.boostFull, 40, cap).boost).toBeCloseTo(T.maxBoost, 5);
    expect(rubberBand(-T.boostFull * 3, 40, cap).boost).toBeCloseTo(T.maxBoost, 5);
  });

  it('far ahead: slowed down toward a little under the player speed, to wait', () => {
    expect(rubberBand(T.waitFrom - 1, 40, cap).speedCap).toBe(cap);
    const full = rubberBand(T.waitFull, 40, cap);
    expect(full.speedCap).toBeCloseTo(40 * T.waitSpeed, 5);
    expect(full.boost).toBe(0);
    expect(rubberBand(T.waitFull * 2, 40, cap).speedCap).toBeCloseTo(40 * T.waitSpeed, 5);
    expect(rubberBand(T.waitFull, 2, cap).speedCap).toBeGreaterThanOrEqual(T.waitMinSpeed); // never parks on the road
  });
});

describe('needsReset', () => {
  const ok = { s: 500, d: laneCenter(1), yaw: 0, speed: 40, stuckFor: 0, playerS: 500 };

  it('a car racing along is left alone', () => {
    expect(needsReset(ok)).toBe(null);
  });

  it('stopped too long, spun round, off the road, or hopelessly far behind: back into the race', () => {
    expect(needsReset({ ...ok, speed: 0.5, stuckFor: T.stuckTime + 0.1 })).toBe('stuck');
    expect(needsReset({ ...ok, speed: 0.5, stuckFor: T.stuckTime - 0.1 })).toBe(null);
    expect(needsReset({ ...ok, yaw: 1.2 })).toBe('spun');
    expect(needsReset({ ...ok, d: 12 })).toBe('off-road');
    expect(needsReset({ ...ok, playerS: ok.s + T.teleportBehind + 1 })).toBe('far-behind');
  });
});
