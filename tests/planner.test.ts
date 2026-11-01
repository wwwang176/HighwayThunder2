import { describe, it, expect } from 'vitest';
import { OVERSHOOT_MARGIN, plan, PLANNER, Plan, TRACKER_LEAD } from '../src/ai/planner';
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

  it('boxed in halfway between lanes: heads for a lane centre, not frozen on the line', () => {
    const boxes = [car(3, 1, 0), car(3, 2, 0), car(3, 0, 0), car(3, 3, 0)];
    const p = plan({ ...ego(150), d: laneCenter(1) + 1.1 }, boxes);
    expect(Math.abs(last(p).d - laneCenter(laneAt(last(p).d)))).toBeLessThan(0.01);
  });

  it('a car merging into its lane from alongside does not stop it (in the game it would wait for us)', () => {
    const mergingId = 5;
    const boxes: TrafficBox[] = [
      { ...car(1, 2, 100), id: mergingId, dMin: laneCenter(2) - 1.5, dMax: laneCenter(2) + 0.4 }, // sliding over from lane 2
      { ...car(1, 1, 100), id: mergingId, phantom: true }, // its target: our lane
    ];
    const p = plan(ego(140), boxes);
    expect(p.points.length).toBe(Math.round(PLANNER.horizon / PLANNER.step) + 1); // a full plan, not the boxed-in fallback
    expect(last(p).v).toBeGreaterThan(130 * KMH);
  });

  it('a car merging in a little ahead while it holds its lane a few cm off the centre: still a full plan', () => {
    const boxes: TrafficBox[] = [
      { ...car(6.4, 3, 77), id: 26, dMin: 4.3, dMax: 6.2 },
      { ...car(6.4, 2, 77), id: 26, phantom: true },
    ];
    const p = plan({ ...ego(115, 2), d: laneCenter(2) - 0.025 }, boxes);
    expect(p.points.length).toBe(Math.round(PLANNER.horizon / PLANNER.step) + 1);
  });

  it('never squeezes into a long truck alongside, even when planning without margins', () => {
    // A container truck in lane 3 level with it (centre just behind), and the way ahead in lane 2 blocked right now.
    const truck = { ...car(-6.6, 3, 80, 16.9, 2.5), id: 28 };
    const boxes = [truck, { ...car(4.6, 2, 0), id: 29 }];
    const p = plan({ ...ego(150, 2), d: 2.85 }, boxes);
    for (const x of p.points.slice(0, 4)) expect(x.d + 0.93).toBeLessThan(truck.dMin + 0.01);
  });

  it('splits two slower cars side by side where they leave room for it (and its tracking error), not where they do not', () => {
    // Two cars abreast 30 m ahead in lanes 1 and 2, slower; lanes 0 and 3 blocked by slower cars still.
    const lineD = (laneCenter(1) + laneCenter(2)) / 2;
    const walls = [car(30, 0, 90), car(30, 3, 90)]; // as fast as the pair: no going round
    const nudged = (lane: number, by: number) => ({ ...car(30, lane, 90), dMin: laneCenter(lane) - 0.925 + by, dMax: laneCenter(lane) + 0.925 + by });
    const wide = [nudged(1, -0.25), nudged(2, 0.25), ...walls]; // 2.4 m between them
    const through = plan({ ...ego(120), d: lineD }, wide);
    expect(clearOfAll(through, wide)).toBe(true);
    expect(last(through).s).toBeGreaterThan(30 + 90 * KMH * PLANNER.horizon + 10); // past them, between them
    const tight = [car(30, 1, 90), car(30, 2, 90), ...walls]; // centred: 1.9 m, less than 1.86 + 2 × sideMargin
    const behind = plan({ ...ego(120), d: lineD }, tight);
    expect(last(behind).s).toBeLessThan(30 + 90 * KMH * PLANNER.horizon);
    // Passing a truck 70 km/h slower: never within a few cm of its side.
    const truck = car(10, 3, 80, 16.9, 2.5);
    const p = plan(ego(150, 2), [truck]);
    for (const x of p.points) {
      const level = Math.abs(truck.s + truck.v * x.t - x.s) < 2.2 + truck.length / 2;
      if (level) expect(truck.dMin - (x.d + 0.93)).toBeGreaterThan(0.3);
    }
  });

  it('moves in front of a truck it is passing only once clear of it by more than the tracker cuts the corner', () => {
    // 7001: passing a container truck at 150 vs 80 km/h, lane 2 blocked ahead, lane 3 free once past the truck.
    const truck = { ...car(-3.1, 3, 80, 16.9, 2.5), id: 28 };
    const blocker = { ...car(60, 2, 60), id: 30 };
    const p = plan({ ...ego(150, 2), d: 2.77 }, [truck, blocker]);
    // The car starts moving up to TRACKER_LEAD s before a plan point; where the plan moves toward the truck's lane,
    // the truck must already have been behind it that long before.
    for (let k = 0; k + 1 < p.points.length; k++) {
      const a = p.points[k];
      const b = p.points[k + 1];
      if (b.d <= a.d || b.d + 0.93 < truck.dMin) continue; // only moves that would reach the truck's side
      const tEarly = Math.max(0, a.t - TRACKER_LEAD);
      const egoEarly = a.s - a.v * (a.t - tEarly);
      const truckFront = truck.s + truck.v * tEarly + truck.length / 2;
      expect(egoEarly - 2.2 - truckFront).toBeGreaterThan(0);
    }
  });

  it('ending a fast diagonal, leaves room on that side for the swing past the end point', () => {
    // 7004: sweeping right across the lanes at full lateral speed toward a truck in lane 3.
    const truck = { ...car(23.6, 3, 79, 8.5, 2.4), id: 43 };
    const p = plan({ ...ego(170, 0), d: -0.69 }, [truck]);
    const pts = p.points;
    for (let k = 1; k < pts.length; k++) {
      const level = Math.abs(truck.s + truck.v * pts[k].t - pts[k].s) < 2.2 + truck.length / 2;
      const cameRight = pts[k].d > pts[k - 1].d + 0.01 || (k > 1 && pts[k - 1].d > pts[k - 2].d + 0.01);
      if (level && cameRight) expect(truck.dMin - (pts[k].d + 0.93)).toBeGreaterThan(OVERSHOOT_MARGIN / 2);
    }
  });

  it('every approach it plans is one it can brake out of itself (no rescue by an emergency brake)', () => {
    // Coming up fast on slower traffic in every lane.
    const boxes = [car(120, 0, 90), car(110, 1, 80), car(130, 2, 85), car(125, 3, 70)];
    const p = plan(ego(220), boxes);
    for (const x of p.points) {
      for (const t of boxes) {
        const r = t.s + t.v * x.t - x.s;
        const lateral = x.d + 0.93 > t.dMin && x.d - 0.93 < t.dMax;
        if (!lateral || r <= 0) continue;
        const closing = Math.max(0, x.v - t.v);
        const bumperGap = r - 2.2 - t.length / 2;
        expect(bumperGap).toBeGreaterThanOrEqual((closing * closing) / (2 * PLANNER.hardBrake) - 0.01);
      }
    }
  });

  it('nothing behind blocks it when it is mid lane change with traffic alongside', () => {
    // Halfway into lane 2, a car level with it in lane 2 and one in lane 1: a full plan still comes out.
    const boxes = [car(-1, 2, 120), car(-3, 1, 120)];
    const p = plan({ ...ego(120), d: (laneCenter(1) + laneCenter(2)) / 2 }, boxes);
    expect(p.points.length).toBe(Math.round(PLANNER.horizon / PLANNER.step) + 1);
  });
});
