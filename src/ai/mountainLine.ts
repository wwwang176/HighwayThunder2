import type { Centerline } from '../road/centerline';
import { type AccelTable, maxAccel } from './planner';

/** Past the finish, the line runs on this far (m: the finish's show drives on). */
const PAST_END = 100;
const G = 9.81;
/** The line's smoothness against its offsets: a tiny pull to the middle, so a straight's offset is settled. */
const EPS = 1e-6;
/** How hard a point held at the road's edge is held there (the active set's penalty). */
const HELD = 1e8;
/** The least share of its grip left for speeding up or braking at the cornering limit (the friction circle's floor). */
const CIRCLE_FLOOR = 0.15;
/** The least of its tyres' load over a crest the line plans with (share of its weight: past it airborne, all but). */
const LOAD_LEAST = 0.3;

/** The racing line round the road, sampled every `step` m along it from s = 0: its offset, speed and curvature there. */
export interface RaceLine {
  step: number;
  /** Offset from the centre line (m, + right). */
  d: Float64Array;
  /** The speed it can be taken at (m/s): the grip's in the bends, the brakes' before them, the engine's after. */
  v: Float64Array;
  /** The line's own curvature (1/m, + bending right). */
  kappa: Float64Array;
}

/** The car's limits the profile uses (CarSpec.ai's tables). */
export interface LineCar {
  accel: AccelTable;
  brake: AccelTable;
  latAccel: AccelTable;
}

/**
 * The line of least curvature within `room` m either side of the centre line (the road's width less the car's and a
 * margin): the curvature of a line offset by d(s) taken as κ(s) + d''(s), its sum of squares made least (a banded
 * least squares) with the points that reach the edge held there - adding the worst over each stretch past it, letting
 * go of those pulling inward - till none is past and none pulls in. Wide into a bend, the inside at its apex, wide out.
 */
export function racingLine(road: Centerline, room: number, step = 2, widen?: (s: number) => number): Float64Array {
  // (every racer on a road the same line: worked out once a road - `widen` the road's own, roadEdges' widen)
  const key = `${room}|${step}|${widen ? 1 : 0}`;
  let lines = LINES.get(road);
  if (!lines) LINES.set(road, (lines = new Map()));
  const known = lines.get(key);
  if (known) return known;
  const d = leastCurvedLine(road, room, step, widen);
  lines.set(key, d);
  return d;
}

const LINES = new WeakMap<Centerline, Map<string, Float64Array>>();

function leastCurvedLine(road: Centerline, room: number, step: number, widen?: (s: number) => number): Float64Array {
  const n = Math.floor((road.length + PAST_END) / step) + 1;
  const kc = new Float64Array(n);
  const rooms = new Float64Array(n); // (each point's: wider in a bend)
  for (let i = 0; i < n; i++) {
    kc[i] = road.curvature(i * step);
    rooms[i] = room + (widen ? widen(i * step) : 0);
  }
  let d: Float64Array = new Float64Array(n);
  // Gauss-Newton: the offset line's curvature κ / (1 - κ d) + d'' linearised about the last line (the inside of a
  // tight bend tighter than the road by its offset), a few times over.
  for (let outer = 0; outer < GN_ROUNDS; outer++) d = leastCurved(kc, d, rooms, step);
  for (let i = 0; i < n; i++) d[i] = Math.max(-rooms[i], Math.min(rooms[i], d[i]));
  return d;
}

const GN_ROUNDS = 5;

/** One round of racingLine: about the line `d0`, the least squares with the edge's active set. */
function leastCurved(kc: Float64Array, d0: Float64Array, rooms: Float64Array, step: number): Float64Array {
  const n = kc.length;
  // Rows r_i = (d_{i-1} - 2 d_i + d_{i+1}) / h² + f'_i d_i + (f_i - f'_i d0_i), f = κ / (1 - κ d) at d0.
  // A d = b: A = Σ rowᵀ row + ε, b = -Σ rowᵀ const.
  const h2 = step * step;
  const A = [new Float64Array(n), new Float64Array(n), new Float64Array(n)]; // (diagonal, +1, +2: symmetric)
  const b = new Float64Array(n);
  const c = [1 / h2, -2 / h2, 1 / h2];
  for (let i = 1; i + 1 < n; i++) {
    const q = 1 - kc[i] * d0[i];
    const f = kc[i] / q;
    const fp = (kc[i] * kc[i]) / (q * q);
    const row = [c[0], c[1] + fp, c[2]];
    const k0 = f - fp * d0[i];
    for (let a = 0; a < 3; a++) {
      b[i - 1 + a] -= row[a] * k0;
      for (let z = a; z < 3; z++) A[z - a][i - 1 + a] += row[a] * row[z];
    }
  }
  for (let i = 0; i < n; i++) A[0][i] += EPS;
  const held = new Map<number, number>();
  let d: Float64Array = new Float64Array(n);
  for (let iter = 0; iter < 400; iter++) {
    d = solveBand(A, b, held);
    let changed = false;
    // Past the edge: the worst point of each stretch past it held at the edge.
    for (let i = 0; i < n; ) {
      if (Math.abs(d[i]) <= rooms[i] + 1e-9 || held.has(i)) {
        i++;
        continue;
      }
      let worst = i;
      let j = i;
      for (; j < n && Math.abs(d[j]) > rooms[j] + 1e-9 && !held.has(j); j++) if (Math.abs(d[j]) > Math.abs(d[worst])) worst = j;
      held.set(worst, Math.sign(d[worst]) * rooms[worst]);
      changed = true;
      i = j;
    }
    // Held ones pulling inward (the line better off without them): let go.
    for (const [i, bound] of held) {
      let g = A[0][i] * d[i] - b[i];
      for (let k = 1; k <= 2; k++) {
        if (i + k < n) g += A[k][i] * d[i + k];
        if (i - k >= 0) g += A[k][i - k] * d[i - k];
      }
      if ((bound > 0 && g > 1e-12) || (bound < 0 && g < -1e-12)) {
        held.delete(i);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return d;
}

/** A symmetric five-band system solved (Gaussian elimination, no pivoting: it is positive definite), `held` points pinned. */
function solveBand(A: Float64Array[], rhs: Float64Array, held: Map<number, number>): Float64Array {
  const n = rhs.length;
  // Full band rows: M[i][k] for columns i-2..i+2 (k = 0..4).
  const M = Array.from({ length: 5 }, () => new Float64Array(n));
  const r = Float64Array.from(rhs);
  for (let i = 0; i < n; i++) {
    M[2][i] = A[0][i];
    if (i + 1 < n) M[3][i] = A[1][i];
    if (i + 2 < n) M[4][i] = A[2][i];
    if (i - 1 >= 0) M[1][i] = A[1][i - 1];
    if (i - 2 >= 0) M[0][i] = A[2][i - 2];
  }
  for (const [i, bound] of held) {
    M[2][i] += HELD;
    r[i] += HELD * bound;
  }
  // Forward elimination: row i clears column i below it (rows i+1, i+2).
  for (let i = 0; i < n; i++) {
    const p = M[2][i];
    for (let k = 1; k <= 2 && i + k < n; k++) {
      const row = i + k;
      const f = M[2 - k][row] / p; // (row's entry in column i)
      if (f === 0) continue;
      // row -= f * row i, over columns i..i+2
      for (let col = i; col <= i + 2 && col < n; col++) M[col - row + 2][row] -= f * M[col - i + 2][i];
      r[row] -= f * r[i];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let v = r[i];
    if (i + 1 < n) v -= M[3][i] * x[i + 1];
    if (i + 2 < n) v -= M[4][i] * x[i + 2];
    x[i] = v / M[2][i];
  }
  return x;
}

/**
 * The speeds along the line `d` (racingLine's, every `step` m): each point's cornering limit (`budget` of the car's
 * sideways grip at that speed, never over `vMax`), then from a standstill at the start as fast as the engine allows
 * (less the climb), and back from every limit as the brakes allow (`budget` of them, helped by a climb, less on a
 * descent) - both cut by what the cornering leaves of the grip. `opts.crest`: over a crest its grip and brakes by
 * its tyres' load (1 + v² x the road's rise's curvature / g: lighter as it goes over; a dip no more than on the flat).
 * `opts.jerk` (m/s³, 0: none): its sideways acceleration changing no faster than this (v³ x the line's curvature's
 * change - a bend turning the other way soon after, at speed: the car turns over to it only so fast).
 * `opts.tyreDrive`: speeding up as its tyres allow (its brake table's grip, by the crest's load, less what the
 * cornering takes), not as its engine does - a speed it may go, not one it will have: its engine limits itself, and a
 * driver aiming at its engine's speeds lifts off whenever the car pulls better than the table (the muscle car out of
 * every hairpin); what the cornering leaves still holds its throttle in coming out of a bend.
 */
export function speedProfile(
  road: Centerline,
  d: Float64Array,
  car: LineCar,
  budget: number,
  vMax: number,
  step = 2,
  opts: { crest?: boolean; jerk?: number; tyreDrive?: boolean } = {},
): RaceLine {
  const n = d.length;
  const px = new Float64Array(n);
  const pz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = road.toWorld(i * step, d[i]);
    px[i] = p.x;
    pz[i] = p.z;
  }
  const kappa = new Float64Array(n);
  for (let i = 1; i + 1 < n; i++) {
    const ax = px[i] - px[i - 1], az = pz[i] - pz[i - 1];
    const bx = px[i + 1] - px[i], bz = pz[i + 1] - pz[i];
    const cx = px[i + 1] - px[i - 1], cz = pz[i + 1] - pz[i - 1];
    const den = Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(cx, cz);
    kappa[i] = den > 1e-12 ? (2 * (ax * bz - az * bx)) / den : 0;
  }
  kappa[0] = kappa[1];
  kappa[n - 1] = kappa[n - 2];
  // (the road's rise's curvature, 1/m: < 0 over a crest)
  const rise = new Float64Array(n);
  if (opts.crest) for (let i = 0; i < n; i++) rise[i] = (road.grade(i * step + 1) - road.grade(i * step - 1)) / 2;
  /** Its tyres' load at speed u at point i over its weight (a crest's; never over 1). */
  const load = (u: number, i: number) => Math.max(LOAD_LEAST, Math.min(1, 1 + (u * u * rise[i]) / G));
  const lat = (v: number, i = -1) => budget * maxAccel(v, car.latAccel) * (i >= 0 ? load(v, i) : 1);
  // The bank's share of the turn (m/s²): g x its slope down toward the inside of the line's turn there (a bend banked
  // against the line's own turn: less).
  const bank = new Float64Array(n);
  for (let i = 0; i < n; i++) bank[i] = -G * road.crossSlope(i * step) * Math.sign(kappa[i]);
  const v = new Float64Array(n);
  const cap = new Float64Array(n);
  const jerk = opts.jerk ?? 0;
  for (let i = 0; i < n; i++) {
    const k = Math.abs(kappa[i]);
    let u = vMax;
    if (k > 1e-9) for (let it = 0; it < 8; it++) u = Math.min(vMax, Math.sqrt(Math.max(0, lat(u, i) + bank[i]) / k));
    if (jerk > 0 && i >= 2 && i + 2 < n) {
      const dk = Math.abs(kappa[i + 2] - kappa[i - 2]) / (4 * step);
      if (dk > 1e-9) u = Math.min(u, Math.cbrt(jerk / dk));
    }
    cap[i] = u;
  }
  /** What the cornering at speed u leaves of the tyres' grip for speeding up or braking (share; the bank's part of the turn not theirs). */
  const circle = (u: number, i: number) => {
    const used = Math.max(0, u * u * Math.abs(kappa[i]) - bank[i]) / Math.max(1e-6, lat(u, i));
    return Math.max(CIRCLE_FLOOR, Math.sqrt(Math.max(0, 1 - used * used)));
  };
  const ds = (i: number) => Math.hypot(px[i + 1] - px[i], pz[i + 1] - pz[i]);
  v[0] = 0;
  for (let i = 0; i + 1 < n; i++) {
    const drive = opts.tyreDrive ? maxAccel(v[i], car.brake) * load(v[i], i) : maxAccel(v[i], car.accel);
    const a = Math.max(0.3, drive * circle(v[i], i) - G * road.grade(i * step));
    v[i + 1] = Math.min(cap[i + 1], Math.sqrt(v[i] * v[i] + 2 * ds(i) * a));
  }
  for (let i = n - 2; i >= 0; i--) {
    const a = Math.max(0.5, budget * maxAccel(v[i + 1], car.brake) * load(v[i + 1], i + 1) * circle(v[i + 1], i + 1) + G * road.grade(i * step));
    v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * ds(i) * a));
  }
  return { step, d, v, kappa };
}

/** The line at s (between its samples, linearly). */
export function lineAt(line: RaceLine, s: number): { d: number; v: number; kappa: number } {
  const n = line.d.length;
  const x = Math.max(0, Math.min(n - 1, s / line.step));
  const i = Math.min(n - 2, Math.floor(x));
  const t = x - i;
  return {
    d: line.d[i] + (line.d[i + 1] - line.d[i]) * t,
    v: line.v[i] + (line.v[i + 1] - line.v[i]) * t,
    kappa: line.kappa[i] + (line.kappa[i + 1] - line.kappa[i]) * t,
  };
}
