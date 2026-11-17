/**
 * The camera kept clear of the ground (the mountain road's: its rock, its cut faces, the hillside) - not of the road's
 * edges: as a spring arm, from a pivot over the car out to where the camera would be. Clear all the way: there, off the
 * road too. Else in along the arm to short of where it would go into the ground, `clear` m over it; no nearer the pivot
 * than `least` m (lifted clear there instead). In at once, back out over `ease` s. (Kept within the road's edges
 * instead, the side looks (Q/E) were pulled in to the edge on the narrow road - where no rock was too.)
 */
export const CAMERA_ARM = {
  clear: 0.4,
  least: 1.5,
  ease: 0.3,
  /** Samples along the arm, then halvings between the last clear one and the first not. */
  samples: 24,
  refine: 6,
  /** The pivot this far over the car's centre (m). */
  pivot: 1,
};

/**
 * The set shots' (the intro's, the finish's): only out of the ground - some low on purpose (0.3 m by a wheel), on the
 * chase camera's clearance pulled in toward the car.
 */
export const CAMERA_SHOT = { ...CAMERA_ARM, clear: 0.1 };

export interface P3 {
  x: number;
  y: number;
  z: number;
}

// (all the way out: exactly where it would be)
const along = (a: P3, b: P3, f: number): P3 => (f >= 1 ? { x: b.x, y: b.y, z: b.z } : { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });
const clearAt = (p: P3, ground: (x: number, z: number) => number, A: typeof CAMERA_ARM) => p.y >= ground(p.x, p.z) + A.clear;

/** How far out along the arm (0..1 of pivot to `want`) the camera stays clear of the ground - no nearer than A.least m. */
export function armReach(pivot: P3, want: P3, ground: (x: number, z: number) => number, A = CAMERA_ARM): number {
  const len = Math.hypot(want.x - pivot.x, want.y - pivot.y, want.z - pivot.z);
  const least = len > 1e-6 ? Math.min(1, A.least / len) : 1;
  let lo = 0;
  let hi = 1;
  let blocked = false;
  for (let i = 1; i <= A.samples; i++) {
    const f = i / A.samples;
    if (!clearAt(along(pivot, want, f), ground, A)) {
      hi = f;
      blocked = true;
      break;
    }
    lo = f;
  }
  if (!blocked) return 1;
  for (let k = 0; k < A.refine; k++) {
    const mid = (lo + hi) / 2;
    if (clearAt(along(pivot, want, mid), ground, A)) lo = mid;
    else hi = mid;
  }
  return Math.max(lo, least);
}

/** The camera `f` of the way out along the arm - lifted clear of the ground there if it is not (in at its least). */
export function armPlace(pivot: P3, want: P3, f: number, ground: (x: number, z: number) => number, A = CAMERA_ARM): P3 {
  const p = along(pivot, want, f);
  p.y = Math.max(p.y, ground(p.x, p.z) + A.clear);
  return p;
}

/** The arm's share now: in at once to `allowed` (never through the ground), back out toward it over A.ease s (`dt` 0: held). */
export function armFollow(current: number, allowed: number, dt: number, A = CAMERA_ARM): number {
  if (allowed <= current) return allowed;
  return current + (allowed - current) * Math.min(1, dt / A.ease);
}
