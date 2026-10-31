import { GRASS_GRIP, LANE_COUNT, LANE_WIDTH, MEDIAN_FAR_X, MEDIAN_NEAR_X } from '../config';

/** Tyre grip multiplier at world x: the median is grass. */
export function surfaceGrip(x: number): number {
  return x < MEDIAN_NEAR_X && x > MEDIAN_FAR_X ? GRASS_GRIP : 1;
}

/** Lateral center of a lane. Lane 0 = leftmost, lane 3 = rightmost; d grows to the right. */
export function laneCenter(lane: number): number {
  return (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
}

/** Nearest lane index for lateral offset d (clamped to valid lanes). */
export function laneAt(d: number): number {
  const i = Math.round(d / LANE_WIDTH + (LANE_COUNT - 1) / 2);
  return Math.min(LANE_COUNT - 1, Math.max(0, i));
}

/** Lanes whose (margin-shrunk) extent overlaps [dMin, dMax]. */
export function lanesOccupied(dMin: number, dMax: number, margin = 0.3): number[] {
  const out: number[] = [];
  const half = LANE_WIDTH / 2 - margin;
  for (let i = 0; i < LANE_COUNT; i++) {
    const c = laneCenter(i);
    if (dMax > c - half && dMin < c + half) out.push(i);
  }
  return out;
}

export function roadToWorld(s: number, d: number): { x: number; z: number } {
  return { x: d, z: s === 0 ? 0 : -s };
}

export function worldToRoad(x: number, z: number): { s: number; d: number } {
  return { s: z === 0 ? 0 : -z, d: x };
}

/** World-space unit forward vector for a road-relative yaw (yaw > 0 turns toward +d). */
export function headingVector(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Road-relative yaw from a Three.js Y rotation (mesh.rotation.y = -yaw). */
export function yawFromRotationY(rotY: number): number {
  return -rotY;
}
