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

  constructor(readonly pieces: Piece[]) {
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
    // Monotonic along -z (projection's first guess relies on it).
    for (let i = 1; i < n; i++) if (!(this.zs[i] < this.zs[i - 1])) throw new Error('Centerline: the road must keep heading along -z (|heading| < 90°)');
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
    let s = hint ?? this.guess(z);
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
  /** Straight off the grid, and into the finish. */
  startStraight: 500,
  endStraight: 500,
  /** Each bend's radius (at 300 km/h R 2000 wants about 0.35 g), turn, and clothoids in and out. */
  radius: [2000, 2500] as const,
  angle: [10, 35] as const,
  ease: [150, 250] as const,
  /** Straight between bends (0: one bend straight into the next, an S). */
  gap: [0, 400] as const,
  /** The road's heading kept within this of the start's (it never doubles back). */
  maxHeading: 45,
};

/**
 * A road `length` m long laid out at random (`rand`: uniform in [0, 1)): straight off the grid, bends of radius
 * 2000-2500 m either way each eased in and out by clothoids, straights between some, and straight into the
 * finish (RANDOM_ROAD).
 */
export function randomRoad(rand: () => number, length: number): Centerline {
  const R = RANDOM_ROAD;
  const within = ([lo, hi]: readonly [number, number]) => lo + rand() * (hi - lo);
  const bends: { gap: number; pieces: Piece[] }[] = [];
  let s = R.startStraight;
  let heading = 0;
  const last = length - R.endStraight;
  for (;;) {
    const radius = within(R.radius);
    const ease = within(R.ease);
    const least = Math.max(R.angle[0], ((ease / radius) * 180) / Math.PI + 1); // (an arc left between the clothoids)
    // The longest turn that still fits before the finish's straight (no straight before it, if that is what fits).
    const fitting = (gap: number) => ((last - s - gap - ease) / radius) * (180 / Math.PI);
    let gap = within(R.gap);
    if (fitting(gap) < least) gap = 0;
    const angle = Math.min(within(R.angle), fitting(gap));
    if (angle < least) break;
    let dir = rand() < 0.5 ? -1 : 1;
    if (Math.abs(heading + dir * angle) > R.maxHeading) dir = -dir;
    bends.push({ gap, pieces: bend(radius, dir * angle, ease) });
    s += gap + (radius * angle * Math.PI) / 180 + ease;
    heading += dir * angle;
  }
  // What is left before the finish's straight shared out between the bends (the start's straight as it is).
  const between = bends.length > 1 ? bends.length - 1 : bends.length;
  const extra = between ? (last - s) / between : 0;
  const pieces: Piece[] = [...straight(R.startStraight)];
  bends.forEach((b, i) => {
    const gap = b.gap + (bends.length > 1 ? (i > 0 ? extra : 0) : extra);
    if (gap > 0) pieces.push(...straight(gap));
    pieces.push(...b.pieces);
  });
  return new Centerline(pieces);
}
