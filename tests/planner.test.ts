import { describe, it, expect } from 'vitest';
import { plan, PLANNER, Plan } from '../src/ai/planner';
import type { TrafficBox } from '../src/ai/sensors';
import { KMH } from '../src/config';
import { laneAt, laneCenter } from '../src/road/coords';

const car = (s: number, lane: number, kmh: number, length = 4.5, width = 1.85): TrafficBox => ({
  s,
  dMin: laneCenter(lane) - width / 2,
  dMax: laneCenter(lane) + width / 2,
  v: kmh * KMH,
  length,
});
const ego = (kmh: number, lane = 1) => ({ s: 0, d: laneCenter(lane), v: kmh * KMH, speedCap: 300 * KMH });
const last = (p: Plan) => p.points[p.points.length - 1];

/** Every step of the plan (and between steps) stays clear of every box, moving at constant speed. */
function clearOfAll(p: Plan, boxes: TrafficBox[]): boolean {
  for (let k = 0; k + 1 < p.points.length; k++) {
    const a = p.points[k];
    const b = p.points[k + 1];
    for (const t of boxes) {
      const ra = t.s + t.v * a.t - a.s;
      const rb = t.s + t.v * b.t - b.s;
      const reach = (4.4 + t.length) / 2;
      const latA = a.d + 0.93 > t.dMin && a.d - 0.93 < t.dMax;
      const latB = b.d + 0.93 > t.dMin && b.d - 0.93 < t.dMax;
      if (!(latA || latB)) continue;
      if (Math.sign(ra) !== Math.sign(rb) || Math.min(Math.abs(ra), Math.abs(rb)) < reach) return false;
    }
  }
  return true;
}

describe('plan', () => {
  it('empty road: flat out in its own lane', () => {
    const p = plan(ego(100), []);
    expect(p.points[0].t).toBe(0);
    expect(last(p).t).toBeCloseTo(PLANNER.horizon, 5);
    expect(last(p).v).toBeGreaterThan(p.points[0].v);
    expect(p.points.every((x) => x.d === laneCenter(1))).toBe(true);
  });

  it('a slow car ahead and the next lane free: goes round it', () => {
    const boxes = [car(40, 1, 80)];
    const p = plan(ego(150), boxes);
    expect(clearOfAll(p, boxes)).toBe(true);
    expect(last(p).s).toBeGreaterThan(boxes[0].s + boxes[0].v * PLANNER.horizon + 5); // past it
  });

  it('four abreast: on the bumper of the fastest, then through the first gap it opens', () => {
    const boxes = [car(30, 0, 95), car(30, 1, 120), car(30, 2, 85), car(30, 3, 90)];
    const p = plan(ego(130), boxes);
    expect(clearOfAll(p, boxes)).toBe(true);
    // Tailgates the 120 km/h car in lane 1 while it pulls away from the rest...
    expect(p.points.slice(1, 5).every((x) => laneAt(x.d) === 1)).toBe(true);
    // ...and gets at least as far as staying on its bumper would (here: past the 85 km/h car into lane 2).
    const leaderEnd = boxes[1].s + boxes[1].v * PLANNER.horizon;
    expect(last(p).s).toBeGreaterThan(leaderEnd - 20);
  });

  it('a wall that stays a wall: on the bumper of the fastest car', () => {
    const boxes = [car(30, 0, 100), car(30, 1, 100), car(30, 2, 110), car(30, 3, 100)];
    for (const t of [...boxes]) boxes.push({ ...t, s: t.s + 12 }); // two rows, no gap between them
    const p = plan(ego(130), boxes);
    expect(clearOfAll(p, boxes)).toBe(true);
    expect(laneAt(last(p).d)).toBe(2);
    expect(last(p).s).toBeGreaterThan(30 + 110 * KMH * PLANNER.horizon - 20);
  });

  it('at 300 km/h behind a truck at 80 it does not jump through it between steps', () => {
    // Every lane blocked well ahead, so going round is not an option within the horizon.
    const boxes = [car(60, 1, 80, 16.9, 2.5), car(60, 0, 80), car(60, 2, 80), car(60, 3, 80)];
    const p = plan(ego(300), boxes);
    expect(clearOfAll(p, boxes)).toBe(true);
  });

  it('does not cut in front of a faster car coming up the next lane', () => {
    const boxes = [car(40, 1, 80), car(-15, 2, 200), car(25, 0, 80), car(-200, 3, 80)];
    const p = plan(ego(110), boxes);
    expect(clearOfAll(p, boxes)).toBe(true);
  });

  it('ignores a faster car behind in its own lane (in the game it brakes for us)', () => {
    const boxes = [car(-10, 1, 200)];
    const p = plan(ego(100), boxes);
    expect(p.points.every((x) => x.d === laneCenter(1))).toBe(true);
  });

  it('can cross several lanes on a diagonal', () => {
    // Lane 3 blocked by a slow truck, lanes 1-2 by slow cars; lane 0 open.
    const boxes = [car(25, 3, 70, 8.5, 2.4), car(35, 2, 75), car(35, 1, 75)];
    const p = plan(ego(110, 3), boxes);
    expect(clearOfAll(p, boxes)).toBe(true);
    expect(laneAt(last(p).d)).toBe(0);
  });

  it('when even braking cannot avoid it, still returns a plan (hold the lane, slow down)', () => {
    const boxes = [car(3, 1, 0), car(3, 0, 0), car(3, 2, 0)]; // a wall right in front
    const p = plan(ego(150), boxes);
    expect(p.points.length).toBeGreaterThan(1);
    expect(p.points[1].v).toBeLessThan(p.points[0].v);
  });
});
