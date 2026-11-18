import type { Centerline } from './centerline';

/** Rows across the road this far apart: within a bend of radius R, 0.06 R (a chord's sag ~ R x 0.00045), between these. */
const ROW_SAG = 0.06;
const ROW_MIN = 0.5;
const ROW_MAX = 3;
/**
 * The ground's (the physics' surfaceMesh) rows no further apart than this. (3 m as the scenery's: on the mountain
 * road's slopes and banked bends each row's kink, 18 a second at 190 km/h, set the springs bouncing - over 100 km/h a
 * wheel off the ground 11 % of the time, the least loaded under 0.3 of its share 39 %, the cars' grip spent bouncing;
 * 0.5 m: 2.4 % / 18 %, 0.25: 1.9 % / 10 %. The scenery's own rows as they were: a few mm from it.)
 */
const GROUND_ROW_MAX = 0.5;

/** The road's surface as a triangle strip: rows across it, each at its height. */
export interface SurfaceMesh {
  /** x, y, z per vertex (two a row: its left edge, then its right). */
  positions: Float32Array;
  /** Three vertices a triangle, facing up. */
  indices: Uint32Array;
  /** Each vertex's road position. */
  s: Float32Array;
  d: Float32Array;
}

/** Where the rows across the road go (s), from `from` to `to`: closer where it bends hard (ROW_SAG), `most` m apart at most. */
export function roadRows(road: Centerline, from: number, to: number, most = ROW_MAX): number[] {
  const rows: number[] = [];
  let s = from;
  const least = Math.min(ROW_MIN, most);
  for (;;) {
    rows.push(s);
    if (s >= to) break;
    const k = Math.max(Math.abs(road.curvature(s)), Math.abs(road.curvature(s + least)), Math.abs(road.curvature(s + most)));
    const step = k > 0 ? Math.min(most, Math.max(least, ROW_SAG / k)) : most;
    s = Math.min(to, s + step);
  }
  return rows;
}

/**
 * The road's surface from s = `from` to `to`, `halfWidth` m either side of its centre line - or each row from its own
 * left edge to its right (`halfWidth(s)`: their d) - each edge at its surfaceHeight (its bends banked).
 */
export function surfaceMesh(road: Centerline, from: number, to: number, halfWidth: number | ((s: number) => [number, number])): SurfaceMesh {
  const rows = roadRows(road, from, to, GROUND_ROW_MAX);
  const n = rows.length;
  const positions = new Float32Array(n * 6);
  const ss = new Float32Array(n * 2);
  const ds = new Float32Array(n * 2);
  rows.forEach((s, i) => {
    const [l, r] = typeof halfWidth === 'number' ? [-halfWidth, halfWidth] : halfWidth(s);
    for (let j = 0; j < 2; j++) {
      const d = j === 0 ? l : r;
      const w = road.toWorld(s, d);
      const v = 2 * i + j;
      positions[3 * v] = w.x;
      positions[3 * v + 1] = road.surfaceHeight(s, d); // (its bends banked)
      positions[3 * v + 2] = w.z;
      ss[v] = s;
      ds[v] = d;
    }
  });
  const indices = new Uint32Array((n - 1) * 6);
  for (let i = 0; i + 1 < n; i++) {
    const l = 2 * i;
    const r = l + 1;
    const l2 = l + 2;
    const r2 = l + 3;
    indices.set([l, r, l2, r, r2, l2], 6 * i);
  }
  return { positions, indices, s: ss, d: ds };
}
