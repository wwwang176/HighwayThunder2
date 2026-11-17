import type { Centerline } from './centerline';
import { insideReach, MOUNTAIN, roadEdges, type RoadEdges } from './mountain';

/**
 * The mountain road's ground: one height field over the whole course, as a road is built into a hillside - the natural
 * ground first (smooth through the road's own heights: no pit nor lone rock where nothing calls for one), then the road
 * cut into it or built up on it (earthwork), its slopes no steeper than a cut's or a fill's.
 *
 * - natural ground: a membrane (Laplace's equation, solved on a grid coarse to fine) held at the road's height along
 *   it and at the mountain's tilt (its road's heights' plane) round the grid's border - between two legs of the road it
 *   lies between their heights, never below both or above both; past them it goes on with the mountain's lie
 * - its roughness: rolling ground (value noise), none near the road, all of it `grow` metres off it; and past it the
 *   mountains round about (`relief`: ridges and valleys tens of metres high, the further off the road the more)
 * - the earthwork: past the road's edge the ground no higher than its edge plus `cut` a metre out (a rock cut: 1:0.75,
 *   ~53°) after a `ditch`, no lower than its edge less `fill` a metre out (an embankment: 1:1.5, ~34°) after a `verge`
 *   - by the nearest leg of the road: where two legs, one above another, are too close for both slopes, the step
 *   between them is where the nearest changes (a retaining wall's)
 */
export const TERRAIN = {
  /** Grid spacing (m), and how far past the road it goes (m). */
  step: 3,
  margin: 150,
  /** Cut and fill slopes: rise (fall) a metre out. */
  cut: 1 / 0.75,
  fill: 1 / 1.2,
  /** The ditch on a cut's foot (m wide, m deep) and the flat verge before a fill falls away (m). */
  ditch: 0.9,
  ditchDeep: 0.35,
  verge: 0.6,
  /** The strip drawn along each edge (m wide: the scene's, meeting the road exactly - the grid under it hidden). */
  seam: 13,
  /** How far from the road the earthwork reaches (m): past it the ground is the natural ground's. */
  reach: 70,
  /** The ground no steeper than this from the road anywhere (rise a metre: ~35°). */
  steepest: 0.7,
  /**
   * The mountainside across the road (the road a shelf cut into it): `rise` a metre out from its centre line uphill
   * (~31°), full where the membrane rises `full` a metre or more, growing no more past `out` m (half as fast), gone by
   * `reach` m (from `fadeFrom`: past the grid's sides only); legs of the road at least `leg` m apart along it; worked
   * out on a grid `coarse` times the ground's spacing, smoothed `smooth` times.
   */
  slope: { rise: 0.6, full: 0.08, out: 50, reach: 220, fadeFrom: 190, leg: 40, coarse: 4, smooth: 3 },
  /** Rolling ground: its height (m), its size (m), from how far off the road (m) to full. */
  roll: { amp: 10, size: 80, from: 6, grow: 45 },
  /** The mountains round about: ridges and valleys `amp` m high, `size` m across, from `from` m off the road, all of them `grow` m further. */
  relief: { amp: 40, size: 300, from: 25, grow: 140 },
  /** Laplace's sweeps on each level (coarsest first), and the over-relaxation. */
  sweeps: [400, 200, 120, 80],
  omega: 1.85,
};

export interface Terrain {
  x0: number;
  z0: number;
  step: number;
  nx: number;
  nz: number;
  /** The ground's height at each node (row-major: x fastest). */
  h: Float32Array;
  /** Past the road's edge (m) at each node, by its nearest leg (< 0: on the road; Infinity: farther than `reach`). */
  past: Float32Array;
  /** How far past the edge the edge's strip reaches at each node's nearest row (m: `seam`, less on a tight bend's inside). */
  cover: Float32Array;
  /** The ground's normal at (x, z) (from its heights, bilinear: the grid's and the strip's alike). */
  normal(x: number, z: number): [number, number, number];
  /** How far (x, z) is from the road's centre line (m: to slope.coarse's grid; Infinity past slope.reach). */
  away(x: number, z: number): number;
  /** The ground's height at (x, z) (bilinear). */
  height(x: number, z: number): number;
  /** The natural ground (rolling, before the earthwork) at (x, z). */
  natural(x: number, z: number): number;
  /** The ground at road position (s, d) past an edge: the earthwork against that row's edge height `base`. */
  earthwork(natural: number, base: number, past: number): number;
}

/** The earthwork at `past` metres past an edge `base` high: the natural ground `n` cut down or built up to it. */
export function earthwork(n: number, base: number, past: number, T = TERRAIN): number {
  if (past <= 0) return base;
  // (a cut: its ditch at the foot; a fill: its verge level, no ditch - a ditch on a fill's verge was a dip at the rail)
  if (n > base) {
    const ditch = past < T.ditch ? -T.ditchDeep * Math.sin((Math.PI * past) / T.ditch) : 0;
    return Math.min(base + ditch + T.cut * Math.max(0, past - T.ditch), n);
  }
  return Math.max(base - T.fill * Math.max(0, past - T.verge), n);
}

/**
 * The ground as drawn at (x, z) (`hint`: an s near it - the car's; none: the nearest anywhere): on the road its surface; past its edge, within the
 * edge's strip (`seam` m, short of a tight bend's inside: mountainScene's), the earthwork against the edge as the strip
 * is drawn; past that, the grid's. (The grid's alone, 3 m between its nodes, cut the cut's face - 1.33 up a metre -
 * a metre or more off.)
 */
export function groundAt(road: Centerline, t: Terrain, x: number, z: number, hint?: number, T = TERRAIN): number {
  const at = road.project(x, z, hint);
  const side: 1 | -1 = at.d >= 0 ? 1 : -1;
  const E = roadEdges(road).at(at.s, side);
  const off = Math.abs(at.d);
  if (off <= E) return road.surfaceHeight(at.s, at.d);
  const past = off - E;
  if (past > T.seam || off > insideReach(road)(at.s, side)) return t.height(x, z);
  return earthwork(t.natural(x, z), road.surfaceHeight(at.s, side * E), past, T);
}

/** A smooth hash noise in [-1, 1] (value noise, smoothstepped), two octaves. */
export function rolling(x: number, z: number, size: number, seed: number): number {
  const v = (ix: number, iz: number) => {
    let n = (ix * 374761393 + iz * 668265263 + seed * 2246822519) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295 * 2 - 1;
  };
  const one = (x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = v(ix, iz) + (v(ix + 1, iz) - v(ix, iz)) * sx;
    const b = v(ix, iz + 1) + (v(ix + 1, iz + 1) - v(ix, iz + 1)) * sx;
    return a + (b - a) * sz;
  };
  return 0.7 * one(x / size, z / size) + 0.3 * one((2.3 * x) / size + 17, (2.3 * z) / size - 9);
}

/** Over-relaxed Gauss-Seidel sweeps of Laplace's equation on a grid, `fixed` nodes held. */
function relax(h: Float64Array, fixed: Uint8Array, nx: number, nz: number, sweeps: number, omega: number): void {
  for (let it = 0; it < sweeps; it++) {
    for (let j = 1; j < nz - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (fixed[k]) continue;
        const avg = 0.25 * (h[k - 1] + h[k + 1] + h[k - nx] + h[k + nx]);
        h[k] += omega * (avg - h[k]);
      }
    }
  }
}

const BUILT = new WeakMap<Centerline, Terrain>();

/** The ground for a road (built once a road). */
export function terrainOf(road: Centerline, edges: RoadEdges = roadEdges(road), T = TERRAIN): Terrain {
  const known = BUILT.get(road);
  if (known) return known;
  // The road, every 2 m: where, which way, how high.
  const S: { s: number; x: number; z: number; c: number; sn: number; y: number }[] = [];
  for (let s = -MOUNTAIN.before; s <= road.length + MOUNTAIN.after; s += 2) {
    const c = road.toWorld(s, 0);
    const th = road.heading(s);
    S.push({ s, x: c.x, z: c.z, c: Math.cos(th), sn: Math.sin(th), y: road.height(s) });
  }
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const p of S) {
    bx0 = Math.min(bx0, p.x); bx1 = Math.max(bx1, p.x); bz0 = Math.min(bz0, p.z); bz1 = Math.max(bz1, p.z);
  }
  const step = T.step;
  const x0 = Math.floor((bx0 - T.margin) / step) * step;
  const z0 = Math.floor((bz0 - T.margin) / step) * step;
  const nx = Math.ceil((bx1 + T.margin - x0) / step) + 1;
  const nz = Math.ceil((bz1 + T.margin - z0) / step) + 1;
  const n = nx * nz;

  // The mountain's tilt: the plane through the road's heights (least squares).
  let sx = 0, sz = 0, sy = 0, sxx = 0, sxz = 0, szz = 0, sxy = 0, szy = 0;
  for (const p of S) {
    sx += p.x; sz += p.z; sy += p.y; sxx += p.x * p.x; sxz += p.x * p.z; szz += p.z * p.z; sxy += p.x * p.y; szy += p.z * p.y;
  }
  const m = S.length;
  const mx = sx / m, mz = sz / m, my = sy / m;
  const cxx = sxx / m - mx * mx, cxz = sxz / m - mx * mz, czz = szz / m - mz * mz, cxy = sxy / m - mx * my, czy = szy / m - mz * my;
  const det = cxx * czz - cxz * cxz || 1;
  const ax = (cxy * czz - czy * cxz) / det;
  const az = (czy * cxx - cxy * cxz) / det;
  const plane = (x: number, z: number) => my + ax * (x - mx) + az * (z - mz);

  // Each node's nearest leg of the road (within `reach`): how far past its edge, that edge's height, the road's own
  // height under it where it is on the road.
  const past = new Float32Array(n).fill(Infinity);
  const cover = new Float32Array(n);
  const reachIn = insideReach(road);
  const base = new Float32Array(n);
  // (each road sample stamped on the nodes within `reach` of it: the nearest kept - and on a coarse grid, `slope.reach`
  // round, with the nearest of another leg of the road too: `slope.leg` m along it from the nearest)
  const stamp = (gs: number, gx: number, gz: number, reach: number, legs: boolean) => {
    const best = new Float32Array(gx * gz).fill(Infinity);
    const best2 = new Float32Array(legs ? gx * gz : 0).fill(Infinity);
    const near = new Int32Array(gx * gz).fill(-1);
    const r = Math.ceil(reach / gs);
    const reach2 = reach * reach;
    S.forEach((p, k) => {
      const ci = Math.round((p.x - x0) / gs), cj = Math.round((p.z - z0) / gs);
      for (let j = Math.max(0, cj - r); j <= Math.min(gz - 1, cj + r); j++) {
        const dz2 = (z0 + j * gs - p.z) ** 2;
        if (dz2 > reach2) continue;
        for (let i = Math.max(0, ci - r); i <= Math.min(gx - 1, ci + r); i++) {
          const d2 = dz2 + (x0 + i * gs - p.x) ** 2;
          if (d2 > reach2) continue;
          const q = j * gx + i;
          const other = legs && (near[q] < 0 || Math.abs(S[near[q]].s - p.s) > T.slope.leg);
          if (d2 < best[q]) {
            if (other) best2[q] = best[q];
            best[q] = d2;
            near[q] = k;
          } else if (other && d2 < best2[q]) best2[q] = d2;
        }
      }
    });
    return { best, best2, near };
  };
  const fine = stamp(step, nx, nz, T.reach, false);
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const k = j * nx + i;
      const bk = fine.near[k];
      if (bk < 0) continue;
      const p = S[bk];
      // (its foot on the road near that sample: across it, d; along it, a little)
      const dx = x - p.x, dz = z - p.z;
      const d = dx * p.c + dz * p.sn;
      const side = d >= 0 ? 1 : -1;
      const along = dx * p.sn - dz * p.c; // (forward: (sin th, -cos th))
      const s = p.s + along;
      const E = edges.at(s, side);
      past[k] = Math.abs(d) - E;
      cover[k] = Math.max(0, Math.min(T.seam, reachIn(s, side) - E));
      base[k] = road.surfaceHeight(s, side * Math.min(Math.abs(d), E));
    }
  }

  // The natural ground: held at the road along it, at the mountain's tilt round the border; between, Laplace's -
  // coarse to fine (a coarse grid's answer the next one's start).
  const levels = T.sweeps.length;
  let prev: { h: Float64Array; nx: number; nz: number; f: number } | null = null;
  let nat = new Float64Array(0);
  for (let L = levels - 1; L >= 0; L--) {
    const f = 1 << L; // (this level's spacing: f nodes of the finest)
    const lx = Math.floor((nx - 1) / f) + 1, lz = Math.floor((nz - 1) / f) + 1;
    const h = new Float64Array(lx * lz);
    const fixed = new Uint8Array(lx * lz);
    for (let j = 0; j < lz; j++)
      for (let i = 0; i < lx; i++) {
        const k = j * lx + i;
        const fi = Math.min(nx - 1, i * f), fj = Math.min(nz - 1, j * f);
        const x = x0 + fi * step, z = z0 + fj * step;
        // (on the road: within half this level's spacing of it)
        let held = NaN;
        for (let b = -(f >> 1); b <= f >> 1 && Number.isNaN(held); b++)
          for (let a = -(f >> 1); a <= f >> 1; a++) {
            const ii = fi + a, jj = fj + b;
            if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
            const q = jj * nx + ii;
            if (past[q] <= 0) {
              held = base[q];
              break;
            }
          }
        if (!Number.isNaN(held)) {
          h[k] = held;
          fixed[k] = 1;
        } else if (i === 0 || j === 0 || i === lx - 1 || j === lz - 1) {
          h[k] = plane(x, z);
          fixed[k] = 1;
        } else if (prev) {
          // (the coarser level's, bilinear)
          const u = (i * f) / prev.f, w = (j * f) / prev.f;
          const iu = Math.min(prev.nx - 2, Math.floor(u)), iw = Math.min(prev.nz - 2, Math.floor(w));
          const fu = u - iu, fw = w - iw;
          const P = prev.h, pn = prev.nx;
          h[k] = (P[iw * pn + iu] * (1 - fu) + P[iw * pn + iu + 1] * fu) * (1 - fw) + (P[(iw + 1) * pn + iu] * (1 - fu) + P[(iw + 1) * pn + iu + 1] * fu) * fw;
        } else h[k] = plane(x, z);
      }
    relax(h, fixed, lx, lz, T.sweeps[levels - 1 - L], T.omega);
    prev = { h, nx: lx, nz: lz, f };
    if (L === 0) nat = h;
  }

  // The mountainside across the road: the road a shelf on a slope - from its centre line the ground rising `slope.rise`
  // a metre out on its uphill side (the membrane's own lie there: its gradient), falling on its downhill side; the
  // steeper the membrane the fuller (flat: none). Between two legs it dies away to nothing midway (where the nearest
  // leg changes: no step), and grows no more past `slope.out` m (halved past it).
  // (smooth: worked out on a coarse grid, `slope.coarse` nodes of the fine one apart, and drawn out bilinear)
  const S2 = T.slope;
  const F = S2.coarse;
  const cnx = Math.floor((nx - 1) / F) + 1, cnz = Math.floor((nz - 1) / F) + 1;
  const coarse = stamp(step * F, cnx, cnz, S2.reach, true);
  const crossC = new Float32Array(cnx * cnz);
  const seed = Math.round(road.length * 7) % 10007;
  const RL = T.relief;
  for (let j = 0; j < cnz; j++)
    for (let i = 0; i < cnx; i++) {
      const q = j * cnx + i;
      const bk = coarse.near[q];
      const x = x0 + i * F * step, z = z0 + j * F * step;
      // (the mountains round about: none near the road, nor between two legs of it - where it is, the road says how high)
      const off = bk < 0 ? Infinity : Math.sqrt(coarse.best[q]);
      const big = Math.max(0, Math.min(1, (off - RL.from) / RL.grow));
      crossC[q] = RL.amp * big * big * (3 - 2 * big) * rolling(x, z, RL.size, seed + 1);
      if (bk < 0 || i === 0 || j === 0 || i === cnx - 1 || j === cnz - 1) continue;
      const p = S[bk];
      const d = (x - p.x) * p.c + (z - p.z) * p.sn;
      const side = d >= 0 ? 1 : -1;
      const fk = j * F * nx + i * F;
      const gx = (nat[fk + F] - nat[fk - F]) / (2 * F * step), gz = (nat[fk + F * nx] - nat[fk - F * nx]) / (2 * F * step);
      const g = Math.hypot(gx, gz);
      if (g < 1e-6) continue;
      const uphill = ((gx * side * p.c + gz * side * p.sn) / g) * Math.min(1, g / S2.full);
      const d1 = Math.sqrt(coarse.best[q]), d2 = Math.sqrt(coarse.best2[q]);
      const apart = Number.isFinite(d2) ? Math.max(0, (d2 - d1) / (d2 + d1)) : 1;
      const lat = Math.abs(d);
      const fade = 1 - Math.max(0, Math.min(1, (lat - S2.fadeFrom) / (S2.reach - S2.fadeFrom))); // (none by slope.reach: no step there)
      const outBy = lat < S2.out ? lat : S2.out + 0.5 * (lat - S2.out);
      crossC[q] += S2.rise * uphill * outBy * Math.min(apart * 2, 1) * fade;
    }
  // (smoothed - a 3x3 mean `slope.smooth` times: a plane stays as it is; the cone a hairpin's inside rose to, from its
  // distance to the road all round, rounded off, and the coarse grid's creases with it)
  for (let pass = 0; pass < S2.smooth; pass++) {
    const src = crossC.slice();
    for (let j = 1; j < cnz - 1; j++)
      for (let i = 1; i < cnx - 1; i++) {
        const q = j * cnx + i;
        crossC[q] = (src[q - cnx - 1] + src[q - cnx] + src[q - cnx + 1] + src[q - 1] + src[q] + src[q + 1] + src[q + cnx - 1] + src[q + cnx] + src[q + cnx + 1]) / 9;
      }
  }
  // (drawn out Catmull-Rom - its slope smooth across the coarse cells too: bilinear, the light showed their creases)
  const cr = (a: number, b: number, c: number, d: number, t: number) =>
    b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
  const at = (i: number, j: number) => crossC[Math.max(0, Math.min(cnz - 1, j)) * cnx + Math.max(0, Math.min(cnx - 1, i))];
  const crossAt = (i: number, j: number) => {
    const u = Math.min(cnx - 1.001, i / F), w = Math.min(cnz - 1.001, j / F);
    const iu = Math.floor(u), iw = Math.floor(w);
    const fu = u - iu, fw = w - iw;
    const row = (jj: number) => cr(at(iu - 1, jj), at(iu, jj), at(iu + 1, jj), at(iu + 2, jj), fu);
    return cr(row(iw - 1), row(iw), row(iw + 1), row(iw + 2), fw);
  };
  const natural = new Float32Array(n);
  const out = new Float32Array(n);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + i * step, z = z0 + j * step;
      const cross = crossAt(i, j);
      const off = Number.isFinite(past[k]) ? past[k] : T.reach;
      const share = Math.max(0, Math.min(1, (off - T.roll.from) / T.roll.grow));
      natural[k] = nat[k] + cross + T.roll.amp * share * share * (3 - 2 * share) * rolling(x, z, T.roll.size, seed);
    }

  // No steeper than `steepest` from the road anywhere (the player's: a wall of ground behind a hairpin, too steep): the
  // ground kept between the road's heights less and plus `steepest` a metre off it - the lowest of the cones up from it,
  // the highest of those down (two chamfer sweeps each way, the road's nodes their tips). Where two legs' cones cross
  // (closer than that allows: few - MOUNTAIN.climb.legSlope), midway.
  const up = new Float32Array(n).fill(Infinity), down = new Float32Array(n).fill(-Infinity);
  for (let k = 0; k < n; k++)
    if (past[k] <= 0) {
      up[k] = base[k];
      down[k] = base[k];
    }
  const a1 = T.steepest * step, a2 = T.steepest * step * Math.SQRT2;
  const sweep = (j: number, i: number, dj: number) => {
    const k = j * nx + i;
    for (const [di, cost] of [[-1, a2], [0, a1], [1, a2]] as const) {
      const ii = i + di, jj = j - dj;
      if (ii < 0 || ii >= nx || jj < 0 || jj >= nz) continue;
      const q = jj * nx + ii;
      if (up[q] + cost < up[k]) up[k] = up[q] + cost;
      if (down[q] - cost > down[k]) down[k] = down[q] - cost;
    }
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) sweep(j, i, 1);
      for (let i = 1; i < nx; i++) {
        const k = j * nx + i;
        if (up[k - 1] + a1 < up[k]) up[k] = up[k - 1] + a1;
        if (down[k - 1] - a1 > down[k]) down[k] = down[k - 1] - a1;
      }
    }
    for (let j = nz - 1; j >= 0; j--) {
      for (let i = nx - 1; i >= 0; i--) sweep(j, i, -1);
      for (let i = nx - 2; i >= 0; i--) {
        const k = j * nx + i;
        if (up[k + 1] + a1 < up[k]) up[k] = up[k + 1] + a1;
        if (down[k + 1] - a1 > down[k]) down[k] = down[k + 1] - a1;
      }
    }
  }
  for (let k = 0; k < n; k++) {
    let nv = natural[k];
    if (down[k] > up[k]) nv = (down[k] + up[k]) / 2;
    else nv = Math.max(down[k], Math.min(up[k], nv));
    natural[k] = nv;
    out[k] = Number.isFinite(past[k]) ? earthwork(nv, base[k], past[k], T) : nv;
  }

  // (its slope at each node, from its neighbours: the normals the grid and the strip are lit by)
  const gradX = new Float32Array(n), gradZ = new Float32Array(n);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const a = i > 0 ? k - 1 : k, b = i < nx - 1 ? k + 1 : k;
      const c = j > 0 ? k - nx : k, d = j < nz - 1 ? k + nx : k;
      gradX[k] = (out[b] - out[a]) / (((b - a) || 1) * step);
      gradZ[k] = (out[d] - out[c]) / ((((d - c) / nx) || 1) * step);
    }
  const bilinear = (A: Float32Array) => (x: number, z: number) => {
    const u = Math.max(0, Math.min(nx - 1.001, (x - x0) / step));
    const w = Math.max(0, Math.min(nz - 1.001, (z - z0) / step));
    const iu = Math.floor(u), iw = Math.floor(w);
    const fu = u - iu, fw = w - iw;
    const k = iw * nx + iu;
    return (A[k] * (1 - fu) + A[k + 1] * fu) * (1 - fw) + (A[k + nx] * (1 - fu) + A[k + nx + 1] * fu) * fw;
  };
  const t: Terrain = {
    x0, z0, step, nx, nz, h: out, past, cover,
    normal: (x, z) => {
      const gx = bilinear(gradX)(x, z), gz = bilinear(gradZ)(x, z);
      const l = Math.hypot(gx, 1, gz);
      return [-gx / l, 1 / l, -gz / l];
    },
    away: (x, z) => {
      const i = Math.round((x - x0) / (step * F)), j = Math.round((z - z0) / (step * F));
      if (i < 0 || j < 0 || i >= cnx || j >= cnz) return Infinity;
      return Math.sqrt(coarse.best[j * cnx + i]);
    },
    height: bilinear(out),
    natural: bilinear(natural),
    earthwork: (nv, b, p) => earthwork(nv, b, p, T),
  };
  BUILT.set(road, t);
  return t;
}
