import type { TrafficBox } from './sensors';

/**
 * Two cars' bodies as they lie (rectangles, any angle to the road), in road coordinates (s along, d across): how far
 * one is into the other, and how far one goes down the road before it touches the other. A box's body is its
 * TrafficBox.body where it has one, else the box itself (square to the road).
 */

/**
 * The quick checks before the bodies (the planner's hot loop: most of the traffic is nowhere near), by the boxes round
 * them - a box is the road-square box round its body (TrafficBox.body) - never wrong where they answer:
 * - roadReach: the road-square box round a body pointing `heading` off the road's, half along (s) and across (d);
 * - boxesApart: box `b` at time t clear of that box round a body at (s, d) - the bodies clear too (depthInto <= 0);
 * - whollyBehind: box `b` at time t all behind that box - going on down the road it never touches it (reachAlong:
 *   Infinity).
 */
export function roadReach(heading: number, hl: number, hw: number): { s: number; d: number } {
  const c = Math.abs(Math.cos(heading)), sn = Math.abs(Math.sin(heading));
  return { s: hl * c + hw * sn, d: hl * sn + hw * c };
}

export function boxesApart(s: number, d: number, reachS: number, reachD: number, b: TrafficBox, t: number): boolean {
  return Math.abs(b.s + b.v * t - s) >= b.length / 2 + reachS || Math.abs((b.dMin + b.dMax) / 2 - d) >= (b.dMax - b.dMin) / 2 + reachD;
}

export function whollyBehind(s: number, reachS: number, b: TrafficBox, t: number): boolean {
  return b.s + b.v * t + b.length / 2 < s - reachS;
}

/**
 * The other's body at time t (moving on at its speed down the road), into `O` (no object made: the planner asks this
 * hundreds of thousands of times a plan): centre, half length / width, its yaw's cosine and sine (none: square to the
 * road).
 */
const O = { s: 0, d: 0, hl: 0, hw: 0, c: 1, sn: 0 };
function bodyOf(b: TrafficBox, t: number): typeof O {
  const body = b.body;
  O.s = b.s + b.v * t;
  O.d = (b.dMin + b.dMax) / 2;
  O.hl = body ? body.halfLength : b.length / 2;
  O.hw = body ? body.halfWidth : (b.dMax - b.dMin) / 2;
  O.c = body ? Math.cos(body.yaw) : 1;
  O.sn = body ? Math.sin(body.yaw) : 0;
  return O;
}

/**
 * How far (m) the body (centre s, d; pointing `heading` off the road's; half length / width) is into box `b` at time
 * t: the least overlap over the separating axes (the body's two, the box's two); <= 0 clear of it (by as much).
 */
export function depthInto(s: number, d: number, heading: number, hl: number, hw: number, b: TrafficBox, t: number): number {
  return depthIntoCS(s, d, Math.cos(heading), Math.sin(heading), hl, hw, b, t);
}

/** depthInto with its heading's cosine `ac` and sine `as` given (worked out once for a body against many boxes). */
export function depthIntoCS(s: number, d: number, ac: number, as: number, hl: number, hw: number, b: TrafficBox, t: number): number {
  const o = bodyOf(b, t);
  const dx = o.s - s, dy = o.d - d;
  const bc = o.c, bsn = o.sn;
  // (the two bodies' axes' angles' cosine and sine: |c|, |s| - each body's reach along the other's axes)
  const c = Math.abs(ac * bc + as * bsn), sn = Math.abs(as * bc - ac * bsn);
  // (each axis: the two bodies' reach along it, less how far apart their centres are along it)
  const o1 = hl + o.hl * c + o.hw * sn - Math.abs(dx * ac + dy * as);
  if (o1 <= 0) return o1;
  const o2 = hw + o.hl * sn + o.hw * c - Math.abs(-dx * as + dy * ac);
  if (o2 <= 0) return o2;
  const o3 = o.hl + hl * c + hw * sn - Math.abs(dx * bc + dy * bsn);
  if (o3 <= 0) return o3;
  const o4 = o.hw + hl * sn + hw * c - Math.abs(-dx * bsn + dy * bc);
  return Math.min(o1, o2, o3, o4);
}

/** reachAlong's sweep so far: entering and leaving (m down the road) the overlap on every axis looked at. */
let enter = -Infinity, leave = Infinity;
/** One axis (ax, ay) of the sweep: the other's centre `gap` from ours along it, within `reach` of each other. */
function sweep(ax: number, ay: number, reach: number, dx: number, dy: number): void {
  const gap = dx * ax + dy * ay; // (the other's centre from ours, along it)
  if (Math.abs(ax) < 1e-9) {
    if (Math.abs(gap) >= reach) leave = -Infinity; // (apart on it, however far it goes)
    return;
  }
  const a = (gap - reach) / ax, z = (gap + reach) / ax;
  enter = Math.max(enter, Math.min(a, z));
  leave = Math.min(leave, Math.max(a, z));
}

/**
 * How far (m) the body (as depthInto) goes straight down the road (+s, turned as it is) before it touches box `b` -
 * standing where it is at time t: by the two bodies, the corner that gets there first. <= 0: into it already;
 * Infinity: it never does (beside it, or past it).
 */
export function reachAlong(s: number, d: number, heading: number, hl: number, hw: number, b: TrafficBox, t: number): number {
  const o = bodyOf(b, t);
  const dx = o.s - s, dy = o.d - d;
  const ac = Math.cos(heading), as = Math.sin(heading), bc = o.c, bsn = o.sn;
  const c = Math.abs(ac * bc + as * bsn), sn = Math.abs(as * bc - ac * bsn);
  // Per axis (the bodies' four): moved x down the road, the body's centre goes x * (the axis' s part) along it; they
  // overlap on it while its centre is within `reach` of the other's. Touching: overlapping on all four at once.
  enter = -Infinity;
  leave = Infinity;
  sweep(ac, as, hl + o.hl * c + o.hw * sn, dx, dy);
  sweep(-as, ac, hw + o.hl * sn + o.hw * c, dx, dy);
  sweep(bc, bsn, o.hl + hl * c + hw * sn, dx, dy);
  sweep(-bsn, bc, o.hw + hl * sn + hw * c, dx, dy);
  if (enter >= leave || leave <= 0) return Infinity;
  return enter;
}
