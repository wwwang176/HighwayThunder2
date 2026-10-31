import { describe, it, expect } from 'vitest';
import { computeResetSpot } from '../src/game/reset';
import { laneCenter } from '../src/road/coords';

const car = (s: number, lane: number) => ({ s, dMin: laneCenter(lane) - 0.9, dMax: laneCenter(lane) + 0.9, length: 4.5 });

describe('computeResetSpot', () => {
  it('uses nearest lane and current s when clear', () => {
    expect(computeResetSpot(500, 1.5, [])).toEqual({ s: 500, lane: 2 });
  });
  it('backs off when blocked and never moves forward', () => {
    const spot = computeResetSpot(500, laneCenter(1), [car(503, 1)]);
    expect(spot.lane).toBe(1);
    expect(spot.s).toBeLessThanOrEqual(495);
    expect(Math.abs(spot.s - 503)).toBeGreaterThanOrEqual(12 + 2.25);
  });
  it('blocker in another lane does not matter', () => {
    expect(computeResetSpot(500, laneCenter(1), [car(500, 3)]).s).toBe(500);
  });
  it('wide wreck across lanes blocks', () => {
    const wreck = { s: 498, dMin: -3, dMax: 3, length: 18 };
    const spot = computeResetSpot(500, laneCenter(2), [wreck]);
    expect(spot.s).toBeLessThan(500 - 12);
  });
  it('never returns negative s', () => {
    const spot = computeResetSpot(2, laneCenter(1), [car(0, 1)]);
    expect(spot.s).toBeGreaterThanOrEqual(0);
    expect(spot.s).toBeLessThanOrEqual(2);
  });
});
