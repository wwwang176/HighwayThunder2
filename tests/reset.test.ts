import { describe, it, expect } from 'vitest';
import { clearResetSpot, computeResetSpot } from '../src/game/reset';
import { laneCenter } from '../src/road/coords';

const car = (s: number, lane: number) => ({ s, dMin: laneCenter(lane) - 0.9, dMax: laneCenter(lane) + 0.9, length: 4.5 });

describe('computeResetSpot', () => {
  it('uses nearest lane and current s when clear', () => {
    expect(computeResetSpot(500, 1.5, [])).toEqual({ s: 500, lane: 2 });
  });
  it('moves to a free lane at the same s when its own lane is blocked', () => {
    const spot = computeResetSpot(500, laneCenter(1), [car(503, 1)]);
    expect(spot.s).toBe(500);
    expect(spot.lane).not.toBe(1);
  });
  it('backs off when every lane is blocked, and never moves forward', () => {
    const wall = [0, 1, 2, 3].map((l) => car(503, l));
    const spot = computeResetSpot(500, laneCenter(1), wall);
    expect(spot.lane).toBe(1);
    expect(spot.s).toBeLessThanOrEqual(495);
    expect(503 - 2.25 - (spot.s + 2.2)).toBeGreaterThanOrEqual(12);
  });
  it('blocker in another lane does not matter', () => {
    expect(computeResetSpot(500, laneCenter(1), [car(500, 3)]).s).toBe(500);
  });
  it('wide wreck blocks every lane it touches', () => {
    const wreck = { s: 498, dMin: -3, dMax: 3, length: 18 };
    const spot = computeResetSpot(500, laneCenter(2), [wreck]);
    expect([0, 3]).toContain(spot.lane);
    expect(spot.s).toBe(500);
  });
  it('does not drop the player at reset speed just behind a stopped queue', () => {
    const q = [car(175, 1), car(168, 1), car(161, 1)].map((b) => ({ ...b, v: 0 }));
    const spot = computeResetSpot(200, laneCenter(1), q, 16.67);
    if (spot.lane === 1 && spot.s < 175) {
      // Needs room to brake from reset speed to 0 at ~6 m/s^2.
      expect(175 - 2.25 - (spot.s + 2.2)).toBeGreaterThanOrEqual((16.67 * 16.67) / 12);
    }
  });
  it('does not drop the player in front of fast traffic; prefers another lane at the same s', () => {
    const fast = { ...car(185, 0), v: 35 };
    const spot = computeResetSpot(200, -9, [fast], 16.67);
    expect(spot.s).toBe(200);
    expect(spot.lane).not.toBe(0);
  });
  it('fast car far enough behind is fine', () => {
    const fast = { ...car(100, 0), v: 35 };
    expect(computeResetSpot(200, laneCenter(0), [fast], 16.67)).toEqual({ s: 200, lane: 0 });
  });
  it('never returns negative s', () => {
    const spot = computeResetSpot(2, laneCenter(1), [car(0, 1)]);
    expect(spot.s).toBeGreaterThanOrEqual(0);
    expect(spot.s).toBeLessThanOrEqual(2);
  });
});

describe('clearResetSpot (a rival put back)', () => {
  // A wall of cars across every lane at s 500 (none clear within 20 m of it).
  const wall = [0, 1, 2, 3].map((l) => car(500, l));
  it('ahead of the player: looks on down the road, never back', () => {
    const spot = clearResetSpot(500, laneCenter(1), wall, 0, 1)!;
    expect(spot.s).toBeGreaterThan(500);
    expect(spot.s - 2.2 - (500 + 2.25)).toBeGreaterThanOrEqual(12);
  });
  it('behind the player: looks back, never on (no rival put back past the player into the lead)', () => {
    const spot = clearResetSpot(500, laneCenter(1), wall, 0, -1)!;
    expect(spot.s).toBeLessThan(500);
    expect(500 - 2.25 - (spot.s + 2.2)).toBeGreaterThanOrEqual(12);
  });
  it('behind, the start just behind and its spot taken: none (not put back yet), not forward', () => {
    expect(clearResetSpot(0, laneCenter(1), [0, 1, 2, 3].map((l) => car(2, l)), 0, -1)).toBeNull();
  });
  it('no room that way: none', () => {
    const packed = [];
    for (let s = 0; s <= 400; s += 10) for (const l of [0, 1, 2, 3]) packed.push(car(500 + s, l));
    expect(clearResetSpot(500, laneCenter(1), packed, 0, 1)).toBeNull();
  });
  it('looking back, where computeResetSpot finds room: the same spot', () => {
    expect(clearResetSpot(500, laneCenter(1), [car(503, 1)], 0, -1)).toEqual(computeResetSpot(500, laneCenter(1), [car(503, 1)]));
  });
});
