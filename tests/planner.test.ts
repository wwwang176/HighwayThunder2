import { beforeAll, describe, it, expect } from 'vitest';
import { ACROSS_CREEP, crossing, plan, PLANNER, Plan } from '../src/ai/planner';
import type { TrafficBox } from '../src/ai/sensors';
import { KMH } from '../src/config';
import { laneAt, laneCenter } from '../src/road/coords';

// The rules, on the 0.5 s grid they were written for (the panel can switch the game to 0.25 s).
beforeAll(() => Object.assign(PLANNER, { step: 0.5, cellsPerLane: 4, latGrip: 0, maxLateral: 3, maxLateralChange: 2, sideMargin: 0.05, swingMargin: 0.1 }));

const car = (s: number, lane: number, kmh: number, length = 4.5, width = 1.85): TrafficBox => ({
  s,
  dMin: laneCenter(lane) - width / 2,
  dMax: laneCenter(lane) + width / 2,
  v: kmh * KMH,
  length,
});
const ego = (kmh: number, lane = 1) => ({ s: 0, d: laneCenter(lane), v: kmh * KMH, speedCap: 300 * KMH });
const last = (p: Plan) => p.points[p.points.length - 1];

/**
 * Every step of the plan (and between steps, straight from point to point) stays clear of every box -
 * the car's body pointing along that straight line (a diagonal turns it), boxes lined up with the road.
 */
function clearOfAll(p: Plan, boxes: TrafficBox[]): boolean {
  for (let k = 0; k + 1 < p.points.length; k++) {
    const a = p.points[k];
    const b = p.points[k + 1];
    const yaw = Math.atan2(b.d - a.d, Math.max(0.1, b.s - a.s));
    for (let i = 0; i <= 20; i++) {
      const u = i / 20;
      const t = a.t + (b.t - a.t) * u;
      const s = a.s + (b.s - a.s) * u;
      const d = a.d + (b.d - a.d) * u;
      for (const x of boxes) if (bodyTouchesBox(s, d, yaw, x.s + x.v * t, x.length, x.dMin, x.dMax)) return false;
    }
  }
  return true;
}

/** The car's body (4.4 × 1.86, centre s, d, turned yaw toward +d) overlaps a road-aligned box (separating axes). */
function bodyTouchesBox(s: number, d: number, yaw: number, bs: number, bl: number, dMin: number, dMax: number): boolean {
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const corners = [-1, 1].flatMap((i) => [-1, 1].map((j) => ({ s: s + i * 2.2 * c - j * 0.93 * sn, d: d + i * 2.2 * sn + j * 0.93 * c })));
  // The road's axes: the body's extent against the box's.
  if (Math.max(...corners.map((q) => q.s)) <= bs - bl / 2 || Math.min(...corners.map((q) => q.s)) >= bs + bl / 2) return false;
  if (Math.max(...corners.map((q) => q.d)) <= dMin || Math.min(...corners.map((q) => q.d)) >= dMax) return false;
  // The body's axes: the box's corners against the body's half length / half width.
  const box = [bs - bl / 2, bs + bl / 2].flatMap((qs) => [dMin, dMax].map((qd) => ({ s: qs - s, d: qd - d })));
  for (const [ax, ay, half] of [[c, sn, 2.2], [-sn, c, 0.93]] as const) {
    const proj = box.map((q) => q.s * ax + q.d * ay);
    if (Math.max(...proj) <= -half || Math.min(...proj) >= half) return false;
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

  it('boxed in by slow traffic in three lanes: gets through and away, touching nothing', () => {
    // Lane 3 blocked by a slow truck, lanes 1-2 by slow cars; lane 0 open. (Its way through may be lane 0,
    // or slipping past the truck via lane 2 and back - whichever gets it furthest.)
    const boxes = [car(25, 3, 70, 8.5, 2.4), car(35, 2, 75), car(35, 1, 75)];
    const p = plan(ego(110, 3), boxes);
    expect(clearOfAll(p, boxes)).toBe(true);
    expect(last(p).s).toBeGreaterThan(Math.max(...boxes.map((b) => b.s + b.v * PLANNER.horizon)) + 10);
  });

  it('on a diagonal it crosses several lanes when only the far one is free', () => {
    // A wall of trucks in lanes 1-3 at 70 km/h, lane 0 open.
    const boxes = [1, 2, 3].map((lane) => car(30, lane, 70, 16.9, 2.5));
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

  it('a car hugging its side - inside the side room, or already rubbing it - still leaves a full plan', () => {
    for (const gap of [-0.05, 0.05, 0.12]) {
      const e = { ...ego(180), vD: 0.5 }; // drifting toward it a little
      const hug = { ...car(-3, 2, 182), dMin: e.d + 0.93 + gap, dMax: e.d + 0.93 + gap + 1.86 };
      const p = plan(e, [hug]);
      expect(p.points.length).toBe(Math.round(PLANNER.horizon / PLANNER.step) + 1);
    }
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

  it('a car cutting in just ahead while it holds its lane a few cm off the centre: brakes, stays in its lane', () => {
    const boxes: TrafficBox[] = [
      { ...car(6.4, 3, 77), id: 26, dMin: 4.3, dMax: 6.2 },
      { ...car(6.4, 2, 77), id: 26, phantom: true },
    ];
    const p = plan({ ...ego(115, 2), d: laneCenter(2) - 0.025 }, boxes);
    expect(p.points[1].v).toBeLessThan(p.points[0].v);
    expect(laneAt(p.points[1].d)).toBe(2);
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
    // The car follows the diagonal up to trackerLead s early; where the diagonal gets level with the truck's side,
    // the truck must already have been behind it that long before.
    for (let k = 0; k + 1 < p.points.length; k++) {
      const a = p.points[k];
      const b = p.points[k + 1];
      if (b.d <= a.d || b.d + 0.93 < truck.dMin) continue; // only moves that would reach the truck's side
      const u = Math.max(0, (truck.dMin - 0.93 - a.d) / (b.d - a.d));
      const tEarly = Math.max(0, a.t + u * (b.t - a.t) - PLANNER.trackerLead);
      const egoEarly = a.s + (b.s - a.s) * ((tEarly - a.t) / (b.t - a.t));
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
      if (level && cameRight) expect(truck.dMin - (pts[k].d + 0.93)).toBeGreaterThan(PLANNER.swingMargin / 4 /* half the swing room per cell (0.05 m) */);
    }
  });

  it('without steerClear, every approach it plans is one it can brake out of itself (no rescue by an emergency brake)', () => {
    // Coming up fast on slower traffic in every lane.
    const boxes = [car(120, 0, 90), car(110, 1, 80), car(130, 2, 85), car(125, 3, 70)];
    PLANNER.steerClear = false;
    let p: Plan;
    try {
      p = plan(ego(220), boxes);
    } finally {
      PLANNER.steerClear = true;
    }
    p.points.forEach((x, k) => {
      const next = p.points[k + 1];
      for (const t of boxes) {
        const r = t.s + t.v * x.t - x.s;
        const lateral = x.d + 0.93 > t.dMin && x.d - 0.93 < t.dMax;
        if (!lateral || r <= 0) continue;
        // Swerving away from it: it only has to stay ahead until the car is clear (tested separately).
        const centre = (t.dMin + t.dMax) / 2;
        if (next && Math.sign(next.d - x.d) === Math.sign(x.d - centre) && next.d !== x.d) continue;
        const closing = Math.max(0, x.v - t.v);
        const bumperGap = r - 2.2 - t.length / 2;
        expect(bumperGap).toBeGreaterThanOrEqual((closing * closing) / (2 * PLANNER.hardBrake) - 0.01);
      }
    });
  });

  it('swerves out from behind a slower car at speed, instead of braking first and then changing lanes', () => {
    // 180 km/h, a 100 km/h car 45 m ahead in its lane, the next lane free: it should be gone before it gets there.
    const p = plan(ego(180), [car(45, 1, 100)]);
    const minV = Math.min(...p.points.map((x) => x.v));
    expect(minV).toBeGreaterThan(170 * KMH);
    expect(laneAt(last(p).d)).not.toBe(1);
  });

  it('a car merging into its lane ahead of it is let in (braked for), not ignored', () => {
    // 7005: 10 m ahead, sliding over from lane 3 into lane 2, slower.
    const boxes: TrafficBox[] = [
      { ...car(9.9, 3, 77), id: 26, dMin: 4.3, dMax: 6.2 },
      { ...car(9.9, 2, 77), id: 26, phantom: true },
      car(3, 1, 90), // lane 1 taken alongside
    ];
    const p = plan(ego(90, 2), boxes);
    for (const x of p.points) {
      const ahead = 9.9 + 77 * KMH * x.t - x.s;
      if (Math.abs(x.d - laneCenter(2)) < 1) expect(ahead).toBeGreaterThan(4.45);
    }
  });

  it('on the bumper of a car ahead, cuts into the next lane as soon as the car behind there is clear of its tail', () => {
    // Lane 1: a car 9 m ahead (centre to centre), same speed. Lane 0: a car whose nose is just past our tail.
    const ahead = car(9, 1, 100);
    const leftBehind = car(-(2.2 + 2.25 + 0.4), 0, 100); // 0.4 m between its front and our rear
    const p = plan(ego(100), [ahead, leftBehind, car(9, 2, 100), car(9, 3, 100)]);
    expect(p.points[2].d).toBeLessThan(laneCenter(1) - 0.5); // on its way left within the first second
  });

  it('walled in by slower traffic far ahead: keeps its speed and brakes late and hard, not early and gently', () => {
    // 180 km/h, every lane blocked 120 m ahead by cars at 100 km/h: braking at 11 m/s² takes ~2 s and ~25 m,
    // so it can hold its speed for the first couple of seconds.
    const p = plan(ego(180), [0, 1, 2, 3].map((lane) => car(120, lane, 100)));
    const at = (t: number) => p.points.find((x) => Math.abs(x.t - t) < 1e-9)!;
    expect(at(1.5).v).toBeGreaterThan(175 * KMH);
  });

  it('does not look back: a car wholly behind in the next lane, however fast, does not stop it moving over', () => {
    // On the bumper of a car ahead; lane 2 holds a car 10 m behind its tail, 60 km/h faster - it would be
    // alongside in ~0.7 s, mid lane change. It brakes for us: we go now, not after it.
    const ahead = car(9, 1, 100);
    const fastBehind = car(-(2.2 + 2.25 + 10), 2, 160);
    const p = plan(ego(100), [ahead, fastBehind, car(9, 0, 100), car(9, 3, 100)]);
    expect(p.points[2].d).toBeGreaterThan(laneCenter(1) + 0.1); // moving over within the first second (fast sideways: it may wait a step)
  });

  it('still never moves into a car alongside (that is a crash, not something to brake for)', () => {
    const alongside = car(-1, 2, 100); // level with it in lane 2
    const p = plan(ego(100), [car(9, 1, 100), alongside, car(9, 0, 100), car(9, 3, 100)]);
    expect(clearOfAll({ points: p.points.slice(0, 3) }, [alongside])).toBe(true);
  });

  it('nothing behind blocks it when it is mid lane change with traffic alongside', () => {
    // Halfway into lane 2, a car level with it in lane 2 and one in lane 1: a full plan still comes out.
    const boxes = [car(-1, 2, 120), car(-3, 1, 120)];
    const p = plan({ ...ego(120), d: (laneCenter(1) + laneCenter(2)) / 2 }, boxes);
    expect(p.points.length).toBe(Math.round(PLANNER.horizon / PLANNER.step) + 1);
  });

  it('standing across the road, sliding off its edge too fast to take back: drives on slowly, no brake', () => {
    // On the outermost cell, 8 m/s sideways on outward: no plan stays on the road with that move.
    const off = { ...ego(11), d: laneCenter(3) + 0.9, vD: 8 };
    const braked = plan(off, []); // in a race: the fallback, a brake toward the lane centre
    expect(braked.points.length).toBe(2);
    expect(braked.points[1].v).toBeLessThan(off.v);
    const p = plan({ ...off, across: true }, []);
    expect(p.points.length).toBe(Math.round(PLANNER.horizon / PLANNER.step) + 1);
    expect(last(p).v).toBeGreaterThan(0);
    expect(Math.max(...p.points.slice(1).map((x) => x.v))).toBeLessThanOrEqual(ACROSS_CREEP);
  });
});

describe('crossing (a diagonal step level with a car)', () => {
  it('only the part of the step the car is level with it', () => {
    expect(crossing(0, 4, 1, 3)).toEqual([0.25, 0.75]); // passes over the band
    expect(crossing(4, 0, 1, 3)).toEqual([0.25, 0.75]); // the other way
    expect(crossing(0, 2, 1, 3)).toEqual([0.5, 1]); // ends inside it
    expect(crossing(2, 6, 1, 3)).toEqual([0, 0.25]); // starts inside it
  });

  it('never or all the time', () => {
    expect(crossing(0, 1, 2, 3)).toBeNull();
    expect(crossing(2, 2, 1, 3)).toEqual([0, 1]);
    expect(crossing(5, 5, 1, 3)).toBeNull();
  });
});

describe('steerClear', () => {
  // 200 km/h, a 100 km/h car 50 m ahead in its lane, the next lane's car further on (pass, then back in).
  const boxes = () => [car(50, 1, 100), car(120, 0, 100), car(20, 2, 100), car(50, 2, 100), car(80, 2, 100), car(110, 2, 100)];
  const firstSpeed = (on: boolean) => {
    PLANNER.steerClear = on;
    try {
      return plan(ego(200), boxes()).points[1].v;
    } finally {
      PLANNER.steerClear = true;
    }
  };

  it('pulls out from dead behind a car on the room to steer round it: no lift', () => {
    expect(firstSpeed(true)).toBeGreaterThanOrEqual(200 * KMH);
  });

  it('off: lifts first, to keep the room to brake down to its speed', () => {
    expect(firstSpeed(false)).toBeLessThan(200 * KMH);
  });
});
