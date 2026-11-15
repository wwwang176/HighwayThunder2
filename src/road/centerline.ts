/**
 * The road's centre line: where s (along it) and d (to its right) are in the world. The old straight road is the
 * curvature-free case (x = d, z = -s); a curved one bends that line, its lanes, rails and verges parallel to it.
 *
 * Heading θ: 0 along -z (the old road), growing toward +x (a right turn; forward (sin θ, -cos θ), right
 * (cos θ, sin θ)), the same convention as coords.headingVector's road-relative yaw. Curvature κ = dθ/ds, > 0 a
 * right bend.
 *
 * The line is a run of pieces whose curvature changes linearly along each (a clothoid; constant: an arc or a
 * straight), as real highways are laid out: a straight eases into an arc through a clothoid, so the steering
 * comes on gradually. Before s = 0 and past its end it runs straight on.
 */

/** A piece of the centre line: `len` m over which the curvature goes linearly from the last piece's end to `k` (1/m). */
export interface Piece {
  len: number;
  k: number;
}

/**
 * A piece of the height profile: `len` m over which the grade (rise over run) goes linearly from the last piece's end
 * to `g` - a parabolic vertical curve; constant: an even slope. Starts level (grade 0) at s = 0.
 */
export interface GradePiece {
  len: number;
  g: number;
}

/** A straight `len` m long. */
export const straight = (len: number): Piece[] => [{ len, k: 0 }];

/**
 * A bend from straight to straight: in through a clothoid `ease` m long, an arc of radius `radius`, out through
 * another clothoid; turning by `angleDeg` in all (> 0 right, < 0 left). `len`: radius x angle + ease.
 */
export function bend(radius: number, angleDeg: number, ease: number): Piece[] {
  const a = (Math.abs(angleDeg) * Math.PI) / 180;
  const arc = radius * a - ease; // (each clothoid turns ease / 2R)
  if (arc < 0) throw new Error(`bend: ${angleDeg}° at R ${radius} is too short for ${ease} m clothoids`);
  const k = Math.sign(angleDeg) / radius;
  return [
    { len: ease, k },
    { len: arc, k },
    { len: ease, k: 0 },
  ];
}

/** Sample spacing of the precomputed positions (m). */
const STEP = 1;
/** Sample spacing of the bank's slope (m), and how far its easing reaches before and after a bend (m) unless given. */
const BANK_STEP = 1;
const BANK_EASE = 20;

/**
 * A road's slope across (see Centerline.crossSlope) every BANK_STEP m from s = -from to its end + from: each point's
 * by its curvature (the inside lower: `slope` from `full` curvature on, in proportion below), then averaged twice over
 * `ease` m (a box of ease / 2 either side, twice): eased in and out over `ease` m before and after, its change at
 * most its whole over `ease` m.
 */
function bankSlopes(road: Centerline, slope: number, full: number, ease: number, from: number): Float64Array {
  const n = Math.ceil((road.length + 2 * from) / BANK_STEP) + 1;
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = road.curvature(i * BANK_STEP - from);
    a[i] = k === 0 ? 0 : -Math.sign(k) * slope * Math.min(1, Math.abs(k) / full);
  }
  return easeTwice(a, Math.round(ease / 2 / BANK_STEP));
}

/** `a` averaged twice over a box of `h` samples either side (past its ends: 0): eased in and out over 2h + 1 samples, its change at most its whole over as many. */
export function easeTwice(a: Float64Array, h: number): Float64Array {
  const n = a.length;
  for (let pass = 0; pass < 2; pass++) {
    const sum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + a[i];
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - h);
      const hi = Math.min(n - 1, i + h);
      out[i] = (sum[hi + 1] - sum[lo]) / (2 * h + 1); // (past the ends: flat)
    }
    a = out;
  }
  return a;
}

export class Centerline {
  /** Its length (m); beyond it, straight on. */
  readonly length: number;
  /** Whether it is straight (and on the old line): the conversions are then the old ones exactly. */
  readonly straight: boolean;
  private readonly starts: number[] = [];
  private readonly k0: number[] = [];
  private readonly k1: number[] = [];
  private readonly theta0: number[] = [];
  private readonly xs: Float64Array;
  private readonly zs: Float64Array;
  /** Its sharpest bend's radius (m; Infinity straight). */
  readonly minRadius: number;
  /** It climbs and falls (its grades given): else flat at height 0. */
  readonly hilly: boolean;
  /** It may turn back on itself (a mountain road's hairpins): no -z check, projection seeded from the nearest point. */
  readonly turnBack: boolean;
  private readonly gStarts: number[] = [];
  private readonly g0: number[] = [];
  private readonly g1: number[] = [];
  private readonly gLen: number[] = [];
  private readonly h0: number[] = [];
  /** Where its grades end, and its height from there on (level). */
  private readonly gradesEnd: number = 0;
  private readonly hEnd: number = 0;

  /** Its bends banked (see crossSlope): the slope across every BANK_STEP m from s = -bankFrom, eased (null: flat). */
  private readonly banks: Float64Array | null = null;
  private readonly bankFrom: number = 0;

  constructor(
    readonly pieces: Piece[],
    opts: { grades?: GradePiece[]; turnBack?: boolean; bank?: { max: number; full: number; ease?: number } } = {},
  ) {
    this.turnBack = opts.turnBack ?? false;
    let gs = 0;
    let g = 0;
    let h = 0;
    for (const p of opts.grades ?? []) {
      if (!(p.len > 0)) continue;
      this.gStarts.push(gs);
      this.g0.push(g);
      this.g1.push(p.g);
      this.gLen.push(p.len);
      this.h0.push(h);
      h += ((g + p.g) / 2) * p.len;
      gs += p.len;
      g = p.g;
    }
    this.hilly = this.gStarts.length > 0;
    this.gradesEnd = gs;
    this.hEnd = h;
    let s = 0;
    let k = 0;
    let th = 0;
    let kMax = 0;
    for (const p of pieces) {
      if (!(p.len > 0)) continue;
      this.starts.push(s);
      this.k0.push(k);
      this.k1.push(p.k);
      this.theta0.push(th);
      th += ((k + p.k) / 2) * p.len;
      s += p.len;
      k = p.k;
      kMax = Math.max(kMax, Math.abs(k));
    }
    this.length = s;
    this.minRadius = kMax > 0 ? 1 / kMax : Infinity;
    this.straight = this.k1.every((v) => v === 0);
    const n = Math.ceil(s / STEP) + 1;
    this.xs = new Float64Array(n);
    this.zs = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const a = (i - 1) * STEP;
      const b = Math.min(i * STEP, s);
      const p = this.advance(a, b - a);
      this.xs[i] = this.xs[i - 1] + p.x;
      this.zs[i] = this.zs[i - 1] + p.z;
    }
    // Monotonic along -z (projection's first guess relies on it) - unless it may turn back (then its nearest point).
    if (!this.turnBack) for (let i = 1; i < n; i++) if (!(this.zs[i] < this.zs[i - 1])) throw new Error('Centerline: the road must keep heading along -z (|heading| < 90°)');
    if (opts.bank) {
      const ease = opts.bank.ease ?? BANK_EASE;
      this.bankFrom = ease + 1;
      this.banks = bankSlopes(this, Math.tan(opts.bank.max), opts.bank.full, ease, this.bankFrom);
    }
  }

  /** The road's height at s (m; 0 flat): its grades integrated, level before 0 and past their end. */
  height(s: number): number {
    if (!this.hilly || s <= 0) return 0;
    if (s >= this.gradesEnd) return this.hEnd;
    const i = this.gradePieceAt(s);
    const t = s - this.gStarts[i];
    return this.h0[i] + this.g0[i] * t + ((this.g1[i] - this.g0[i]) * t * t) / (2 * this.gLen[i]);
  }

  /**
   * How it slopes across at s (rise per metre toward +d): its bends banked into them - the inside lower - by its
   * curvature (as steep as `bank.max` from `bank.full` on, less in proportion below), eased in and out over
   * `bank.ease` m before and after (a hairpin's own clothoids, 10 m, banked it in 4: its edges rose 0.7 m in a few
   * metres, a step in the road). Flat on a straight away from bends, and on a road built without banking.
   */
  crossSlope(s: number): number {
    const b = this.banks;
    if (!b) return 0;
    const x = (s + this.bankFrom) / BANK_STEP;
    if (x <= 0 || x >= b.length - 1) return 0;
    const i = Math.floor(x);
    return b[i] + (b[i + 1] - b[i]) * (x - i);
  }

  /** The road's surface height at (s, d): its centre line's height, and its slope across (crossSlope). */
  surfaceHeight(s: number, d: number): number {
    return this.height(s) + this.crossSlope(s) * d;
  }

  /** Its grade at s (rise over run; > 0 climbing along +s). */
  grade(s: number): number {
    if (!this.hilly || s < 0 || s > this.gradesEnd) return 0;
    const i = this.gradePieceAt(s);
    return this.g0[i] + ((this.g1[i] - this.g0[i]) * (s - this.gStarts[i])) / this.gLen[i];
  }

  private gradePieceAt(s: number): number {
    let lo = 0;
    let hi = this.gStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.gStarts[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private pieceAt(s: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Heading θ at s (rad): exact (piecewise quadratic). */
  heading(s: number): number {
    if (this.straight || s <= 0) return 0;
    const sc = Math.min(s, this.length);
    const i = this.pieceAt(sc);
    const t = sc - this.starts[i];
    const len = (i + 1 < this.starts.length ? this.starts[i + 1] : this.length) - this.starts[i];
    return this.theta0[i] + this.k0[i] * t + ((this.k1[i] - this.k0[i]) * t * t) / (2 * len);
  }

  /** Curvature κ at s (1/m, > 0 bending right). */
  curvature(s: number): number {
    if (this.straight || s < 0 || s > this.length) return 0;
    const i = this.pieceAt(s);
    const len = (i + 1 < this.starts.length ? this.starts[i + 1] : this.length) - this.starts[i];
    return this.k0[i] + ((this.k1[i] - this.k0[i]) * (s - this.starts[i])) / len;
  }

  /** The line's displacement from s = a over h m (Simpson on the exact heading). */
  private advance(a: number, h: number): { x: number; z: number } {
    const t0 = this.heading(a);
    const tm = this.heading(a + h / 2);
    const t1 = this.heading(a + h);
    return {
      x: (h / 6) * (Math.sin(t0) + 4 * Math.sin(tm) + Math.sin(t1)),
      z: (-h / 6) * (Math.cos(t0) + 4 * Math.cos(tm) + Math.cos(t1)),
    };
  }

  /** The centre line's world point at s. */
  center(s: number): { x: number; z: number } {
    if (this.straight) return { x: 0, z: s === 0 ? 0 : -s };
    if (s <= 0) return { x: 0, z: s === 0 ? 0 : -s };
    if (s >= this.length) {
      const n = this.xs.length - 1;
      const th = this.heading(this.length);
      const e = s - this.length;
      return { x: this.xs[n] + e * Math.sin(th), z: this.zs[n] - e * Math.cos(th) };
    }
    const i = Math.min(Math.floor(s / STEP), this.xs.length - 2);
    const a = i * STEP;
    const p = this.advance(a, s - a);
    return { x: this.xs[i] + p.x, z: this.zs[i] + p.z };
  }

  /** World point of road position (s, d). */
  toWorld(s: number, d: number): { x: number; z: number } {
    if (this.straight) return { x: d, z: s === 0 ? 0 : -s };
    const c = this.center(s);
    const th = this.heading(s);
    return { x: c.x + d * Math.cos(th), z: c.z + d * Math.sin(th) };
  }

  /**
   * Road position (s, d) of world point (x, z): its foot on the centre line. `hint`: an s near the answer (e.g.
   * the same thing's last step), else found from z. Exact to well under a millimetre while |d| is well inside
   * the sharpest radius.
   */
  project(x: number, z: number, hint?: number): { s: number; d: number } {
    if (this.straight) return { s: z === 0 ? 0 : -z, d: x };
    let s = hint ?? (this.turnBack ? this.nearest(x, z) : this.guess(z));
    for (let it = 0; it < 6; it++) {
      const c = this.center(s);
      const th = this.heading(s);
      const fx = Math.sin(th);
      const fz = -Math.cos(th);
      const ex = x - c.x;
      const ez = z - c.z;
      const along = ex * fx + ez * fz;
      const d = ex * Math.cos(th) + ez * Math.sin(th);
      // (moving the foot by ds moves it along the line, and turns the normal by κ ds: the offset point by (1 - κd) ds)
      const step = along / Math.max(0.2, 1 - this.curvature(s) * d);
      s += step;
      if (Math.abs(step) < 1e-7) return { s, d };
    }
    const c = this.center(s);
    const th = this.heading(s);
    return { s, d: (x - c.x) * Math.cos(th) + (z - c.z) * Math.sin(th) };
  }

  /** The s of its precomputed point nearest (x, z) (a road turning back: no z order to search by; past its ends, along them). */
  private nearest(x: number, z: number): number {
    const n = this.xs.length - 1;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i <= n; i++) {
      const dx = x - this.xs[i];
      const dz = z - this.zs[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) {
        bestD = d2;
        best = i;
      }
    }
    return Math.min(best * STEP, this.length);
  }

  /** An s whose centre point is level with z (the line keeps heading along -z). */
  private guess(z: number): number {
    const zs = this.zs;
    const n = zs.length - 1;
    if (z >= 0) return -z;
    if (z <= zs[n]) return this.length + (zs[n] - z) / Math.max(0.2, Math.cos(this.heading(this.length)));
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (zs[mid] >= z) lo = mid;
      else hi = mid;
    }
    return (lo + (zs[lo] - z) / (zs[lo] - zs[hi])) * STEP;
  }

  /** World unit forward at s for a road-relative yaw (yaw > 0 toward +d). */
  forwardWorld(yaw: number, s: number): { x: number; z: number } {
    const a = yaw + this.heading(s);
    return { x: Math.sin(a), z: -Math.cos(a) };
  }
}

/** The old straight road. */
export const STRAIGHT_ROAD = new Centerline([]);

/** How a random road is laid out (m, degrees): its bends as real highways' at their speed. */
export const RANDOM_ROAD = {
  /** Straight off the grid, and into the finish (between them, bend after bend: no straight). */
  startStraight: 100,
  endStraight: 100,
  /** Each bend's radius (at 300 km/h R 1000 wants about 0.71 g), turn, and clothoids in and out. */
  radius: [1000, 1750] as const,
  angle: [10, 35] as const,
  ease: [150, 250] as const,
  /** The last bend may turn this far (degrees) to reach the finish's straight (with room for a bend after it at any less: BEND_ROOM). */
  longest: 50,
  /** The road's heading kept within this of the start's (it never doubles back). */
  maxHeading: 50,
};

/** Room enough for any bend (m): the shortest one at the widest radius with the longest clothoids. */
const BEND_ROOM =
  RANDOM_ROAD.radius[1] * Math.max((RANDOM_ROAD.angle[0] * Math.PI) / 180, RANDOM_ROAD.ease[1] / RANDOM_ROAD.radius[1] + Math.PI / 180) +
  RANDOM_ROAD.ease[1];

/**
 * A road `length` m long laid out at random (`rand`: uniform in [0, 1)): straight off the grid, then bend after
 * bend (radius 1000-1750 m, either way, each eased in and out by clothoids: one bend's easing out runs straight
 * into the next's easing in, no straight between) to the finish's straight (RANDOM_ROAD). The last bends are sized
 * so they end just there.
 */
export function randomRoad(rand: () => number, length: number): Centerline {
  const R = RANDOM_ROAD;
  const within = ([lo, hi]: readonly [number, number]) => lo + rand() * (hi - lo);
  const deg = (rad: number) => (rad * 180) / Math.PI;
  const pieces: Piece[] = [...straight(R.startStraight)];
  let s = R.startStraight;
  let heading = 0;
  const last = length - R.endStraight;
  while (last - s > 1e-6) {
    const room = last - s;
    const radius = within(R.radius);
    const ease = within(R.ease);
    const least = Math.max(R.angle[0], deg(ease / radius) + 1); // (an arc left between the clothoids)
    const all = deg((room - ease) / radius); // (the turn that ends just at the finish's straight)
    if (all < least) {
      // (only when the road is too short for one bend)
      pieces.push(...straight(room));
      break;
    }
    let angle = Math.min(Math.max(within(R.angle), least), all);
    // Too little left after it for another bend: this one to the finish's straight, or leaving room for one more.
    const after = room - (radius * angle * Math.PI) / 180 - ease;
    if (after > 1e-6 && after < BEND_ROOM) angle = all <= R.longest ? all : deg((room - BEND_ROOM - ease) / radius);
    // Either way, kept within the heading's bounds (turning back toward the start's heading if need be).
    let dir = rand() < 0.5 ? -1 : 1;
    if (Math.abs(heading + dir * angle) > R.maxHeading) dir = -dir;
    pieces.push(...bend(radius, dir * angle, ease));
    s += (radius * angle * Math.PI) / 180 + ease;
    heading += dir * angle;
  }
  return new Centerline(pieces);
}
