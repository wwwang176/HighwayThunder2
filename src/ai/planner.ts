import { KMH, LANE_COUNT, LANE_WIDTH } from '../config';
import { laneCenter } from '../road/coords';
import type { TrafficBox } from './sensors';

/**
 * Planner settings (mutable: tuned while testing).
 * The plan is a lattice in time × lateral position × speed: every `step` seconds
 * the car may move half a lane sideways (so one lane a second, three lanes in
 * three seconds on a diagonal) and change speed within what the car can do.
 */
export const PLANNER = {
  step: 0.5, // s between plan points
  horizon: 8, // s looked ahead (~650 m at 300 km/h)
  speedCell: 2, // m/s: speeds closer than this count as the same state
  /** Value of speed at the end of the plan: metres per m/s (s it would keep going). */
  endSpeedValue: 2,
  /** Cost of a sideways move (m of progress), so it does not weave for nothing. */
  lateralCost: 0.5,
  /** Cost of ending the plan straddling two lanes. */
  lineCost: 3,
  /**
   * Bonus per plan point (m) for being where the last plan was at that moment:
   * a new plan has to be clearly better to change course (no flip-flopping
   * between two equally good lanes, which left the car straddling the line).
   */
  keepCourseBonus: 1.5,
  /** Room kept to what is ahead: this much plus `headway` seconds of the own speed (right on the bumper). */
  gapAhead: 1,
  headway: 0.1,
  /** Room kept to what is behind when moving in front of it: this much plus its closing speed × `cutInTime`. */
  gapBehind: 2,
  cutInTime: 0.6,
  /** Sideways room kept to other vehicles (each side). */
  sideMargin: 0.25,
  hardBrake: 8, // m/s²
  softBrake: 3,
};

const HALF_LENGTH = 2.2;
const HALF_WIDTH = 0.93;
const CELLS = 2 * LANE_COUNT - 1; // lane centres and the lines between them
const cellD = (c: number) => laneCenter(0) + (c * LANE_WIDTH) / 2;
const nearestCell = (d: number) => Math.max(0, Math.min(CELLS - 1, Math.round((d - laneCenter(0)) / (LANE_WIDTH / 2))));

/** Full-throttle acceleration of the player car (m/s²) at a speed (km/h), measured. */
const ACCEL_KMH: [number, number][] = [
  [0, 7],
  [80, 7],
  [100, 4.9],
  [140, 3.4],
  [180, 2.3],
  [220, 1.4],
  [260, 0.9],
  [300, 0.5],
];
export function maxAccel(v: number): number {
  const kmh = v / KMH;
  for (let i = 1; i < ACCEL_KMH.length; i++) {
    const [k1, a1] = ACCEL_KMH[i];
    if (kmh <= k1) {
      const [k0, a0] = ACCEL_KMH[i - 1];
      return a0 + ((a1 - a0) * (kmh - k0)) / (k1 - k0);
    }
  }
  return ACCEL_KMH[ACCEL_KMH.length - 1][1];
}

export interface PlanPoint {
  t: number;
  s: number;
  d: number;
  v: number;
}

export interface Plan {
  points: PlanPoint[];
}

/** The plan being followed, and how long ago it was made: the next plan sticks to it unless clearly better. */
export interface PreviousPlan {
  plan: Plan;
  age: number;
}

export interface PlanEgo {
  s: number;
  d: number;
  v: number;
  speedCap: number;
}

interface Node {
  s: number;
  v: number;
  cell: number;
  d: number;
  score: number; // progress so far minus costs
  parent: Node | null;
}

/**
 * The fastest way through the traffic for the next `horizon` seconds, assuming
 * every vehicle keeps its speed and lane (an NPC about to change lanes holds its
 * target lane too). When nothing gets through, the furthest reachable spot is
 * right behind the fastest car ahead - so it tailgates the one most likely to
 * open a gap, and the next plan (a fraction of a second later) takes the gap.
 *
 * Traffic behind the car in the lane it holds is ignored while it holds it: in
 * the game that traffic brakes for the player (and in training it does not
 * count as a crash). Moving sideways in front of traffic is never ignored.
 */
export function plan(ego: PlanEgo, traffic: TrafficBox[], previous: PreviousPlan | null = null): Plan {
  const P = PLANNER;
  const steps = Math.round(P.horizon / P.step);
  const dt = P.step;
  // Only what can matter within the horizon.
  const reachAhead = ego.s + Math.max(ego.v, ego.speedCap) * P.horizon + 50;
  const boxes = traffic.filter((t) => t.s < reachAhead && t.s > ego.s - 150);

  let layer = new Map<number, Node>();
  const start: Node = { s: ego.s, v: ego.v, cell: nearestCell(ego.d), d: ego.d, score: 0, parent: null };
  layer.set(key(start.cell, start.v), start);
  let deepest: Node[] = [start];

  for (let k = 0; k < steps; k++) {
    const t0 = k * dt;
    const next = new Map<number, Node>();
    const wasD = previous ? planAt(previous.plan, previous.age + t0 + dt).d : null;
    for (const n of layer.values()) {
      const top = maxAccel(n.v);
      const accels = [top, top / 2, top / 4, 0, -P.softBrake / 2, -P.softBrake, -P.hardBrake];
      for (const move of [0, -1, 1]) {
        const cell = n.cell + move;
        if (cell < 0 || cell >= CELLS) continue;
        const d = cellD(cell);
        for (const a of accels) {
          const v = Math.max(0, Math.min(ego.speedCap, n.v + a * dt));
          const s = n.s + ((n.v + v) / 2) * dt;
          if (collides(n, s, d, v, t0, dt, boxes, move !== 0 || n.d !== d)) continue;
          let score = n.score + (s - n.s) - (move !== 0 ? P.lateralCost : 0);
          if (wasD !== null && Math.abs(d - wasD) < LANE_WIDTH / 4) score += P.keepCourseBonus;
          const kk = key(cell, v);
          const old = next.get(kk);
          if (!old || score > old.score) next.set(kk, { s, v, cell, d, score, parent: n });
        }
      }
    }
    if (next.size === 0) break;
    layer = next;
    deepest = [...next.values()];
  }

  let best: Node | null = null;
  let bestValue = -Infinity;
  for (const n of deepest) {
    const value = n.score + P.endSpeedValue * n.v - (n.cell % 2 === 1 ? P.lineCost : 0);
    if (value > bestValue) {
      bestValue = value;
      best = n;
    }
  }
  const chain: Node[] = [];
  for (let n = best; n; n = n.parent) chain.push(n);
  chain.reverse();
  if (chain.length === 1) {
    // Boxed in even braking hard: hold the lane and brake (a contact may follow).
    const v = Math.max(0, ego.v - P.hardBrake * dt);
    chain.push({ ...start, s: ego.s + ((ego.v + v) / 2) * dt, v, parent: start });
  }
  const points = chain.map((n, i) => ({ t: i * dt, s: n.s, d: n.d, v: n.v }));
  return { points };
}

/** Where the plan is `t` seconds after it was made (between points: linear), and how fast it moves sideways there. */
export function planAt(p: Plan, t: number): PlanPoint & { dRate: number } {
  const pts = p.points;
  const k = Math.min(pts.length - 2, Math.max(0, Math.floor(t / PLANNER.step)));
  const a = pts[k];
  const b = pts[k + 1] ?? a;
  const span = b.t - a.t;
  const u = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
  const dRate = span > 0 && t < b.t ? (b.d - a.d) / span : 0;
  return { t, s: a.s + (b.s - a.s) * u, d: a.d + (b.d - a.d) * u, v: a.v + (b.v - a.v) * u, dRate };
}

const key = (cell: number, v: number) => cell * 1000 + Math.round(v / PLANNER.speedCell);

/**
 * Whether moving from node `n` to (s1, d1, v1) over [t0, t0 + dt] touches any
 * box, kept apart by the planner's margins. Checked over the whole interval: a
 * box passed between two plan points (relative position changed sign) is hit.
 */
function collides(n: Node, s1: number, d1: number, v1: number, t0: number, dt: number, boxes: TrafficBox[], sideways: boolean): boolean {
  const P = PLANNER;
  const lo = Math.min(n.d, d1) - HALF_WIDTH - P.sideMargin;
  const hi = Math.max(n.d, d1) + HALF_WIDTH + P.sideMargin;
  const inLane = !sideways && n.cell % 2 === 0;
  for (const t of boxes) {
    if (t.dMax < lo || t.dMin > hi) continue;
    const r0 = t.s + t.v * t0 - n.s; // box centre relative to ours
    const r1 = t.s + t.v * (t0 + dt) - s1;
    if (inLane && r0 < 0 && r1 < 0 && t.dMin < n.d && t.dMax > n.d) continue; // behind us in our lane: it brakes for us
    const ahead = HALF_LENGTH + t.length / 2 + P.gapAhead + P.headway * Math.max(n.v, v1);
    const behind = HALF_LENGTH + t.length / 2 + P.gapBehind + P.cutInTime * Math.max(0, t.v - Math.min(n.v, v1));
    if (Math.sign(r0) !== Math.sign(r1)) return true; // passed through it
    const r = Math.abs(r0) < Math.abs(r1) ? r0 : r1;
    if (r >= 0 ? r < ahead : -r < behind) return true;
  }
  return false;
}
