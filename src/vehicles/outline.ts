/**
 * A car's outline seen from above, for how far along the road its body reaches: the race's places and its finish
 * go by the frontmost point of the body, whichever way the car faces (one going over the line backwards: its tail).
 */

/**
 * The outline's points, as pairs (x, f) in body space (m: x to its right, f toward its nose): its collision shape's
 * points (CarSpec.collider: x, y, z each, the nose toward -z), else its box's corners.
 */
export function outlineOf(collider: number[][] | undefined, width: number, length: number): number[] {
  const out: number[] = [];
  if (collider?.length) {
    for (const hull of collider) for (let i = 0; i + 2 < hull.length; i += 3) out.push(hull[i], -hull[i + 2]);
    if (out.length) return out;
  }
  for (const x of [-width / 2, width / 2]) for (const f of [-length / 2, length / 2]) out.push(x, f);
  return out;
}

/**
 * How far ahead of the car's middle along the road (m) its outline reaches: the most of its points' along the road,
 * the car at `yaw` against the road (> 0 turned toward +d, its right).
 */
export function reachAhead(outline: number[], yaw: number): number {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  let most = -Infinity;
  for (let i = 0; i + 1 < outline.length; i += 2) most = Math.max(most, outline[i + 1] * c - outline[i] * sn);
  return most;
}

/**
 * Where in a step something going from `prev` to `now` (m along the road) reached `line`: 0 at the step's start ..
 * 1 at its end (there already, or nothing known before it: 0, 1).
 */
export function crossFraction(prev: number, now: number, line: number): number {
  if (!Number.isFinite(prev)) return 1;
  if (prev >= line) return 0;
  if (!(now > prev)) return 1;
  return Math.min(1, Math.max(0, (line - prev) / (now - prev)));
}
