import type { TrafficBox } from './sensors';

/**
 * Two cars' bodies as they lie (rectangles, any angle to the road), in road coordinates (s along, d across): how far
 * one is into the other, and how far one goes down the road before it touches the other. A box's body is its
 * TrafficBox.body where it has one, else the box itself (square to the road).
 */

/** The other's body at time t (moving on at its speed down the road): centre, half length / width, yaw. */
function bodyOf(b: TrafficBox, t: number) {
  return {
    s: b.s + b.v * t,
    d: (b.dMin + b.dMax) / 2,
    yaw: b.body?.yaw ?? 0,
    hl: b.body?.halfLength ?? b.length / 2,
    hw: b.body?.halfWidth ?? (b.dMax - b.dMin) / 2,
  };
}

/**
 * How far (m) the body (centre s, d; pointing `heading` off the road's; half length / width) is into box `b` at time
 * t: the least overlap over the separating axes (the body's two, the box's two); <= 0 clear of it (by as much).
 */
export function depthInto(s: number, d: number, heading: number, hl: number, hw: number, b: TrafficBox, t: number): number {
  const o = bodyOf(b, t);
  const dx = o.s - s, dy = o.d - d;
  const ac = Math.cos(heading), as = Math.sin(heading), bc = Math.cos(o.yaw), bsn = Math.sin(o.yaw);
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

/**
 * How far (m) the body (as depthInto) goes straight down the road (+s, turned as it is) before it touches box `b` -
 * standing where it is at time t: by the two bodies, the corner that gets there first. <= 0: into it already;
 * Infinity: it never does (beside it, or past it).
 */
export function reachAlong(s: number, d: number, heading: number, hl: number, hw: number, b: TrafficBox, t: number): number {
  const o = bodyOf(b, t);
  const dx = o.s - s, dy = o.d - d;
  const ac = Math.cos(heading), as = Math.sin(heading), bc = Math.cos(o.yaw), bsn = Math.sin(o.yaw);
  const c = Math.abs(ac * bc + as * bsn), sn = Math.abs(as * bc - ac * bsn);
  // Per axis (the bodies' four): moved x down the road, the body's centre goes x * (the axis' s part) along it; they
  // overlap on it while its centre is within `reach` of the other's. Touching: overlapping on all four at once.
  let enter = -Infinity, leave = Infinity;
  const axis = (ax: number, ay: number, reach: number) => {
    const gap = dx * ax + dy * ay; // (the other's centre from ours, along it)
    if (Math.abs(ax) < 1e-9) {
      if (Math.abs(gap) >= reach) leave = -Infinity; // (apart on it, however far it goes)
      return;
    }
    const a = (gap - reach) / ax, z = (gap + reach) / ax;
    enter = Math.max(enter, Math.min(a, z));
    leave = Math.min(leave, Math.max(a, z));
  };
  axis(ac, as, hl + o.hl * c + o.hw * sn);
  axis(-as, ac, hw + o.hl * sn + o.hw * c);
  axis(bc, bsn, o.hl + hl * c + hw * sn);
  axis(-bsn, bc, o.hw + hl * sn + hw * c);
  if (enter >= leave || leave <= 0) return Infinity;
  return enter;
}
