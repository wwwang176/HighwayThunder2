import { MEDIAN_NEAR_X, RAIL_D, ROAD_LENGTH } from '../config';
// (LEFT_LIMIT / RIGHT_LIMIT below are also what the sensors measure the edges against.)
import type { TrafficBox } from './sensors';

/** Scoring and elimination settings (mutable: tuned while training). */
export const FITNESS = {
  // s per generation. Too short to finish by following traffic (80-125 km/h, ~360 s for
  // 10 km): only a car averaging 120+ km/h - one that passes - gets the finish. Until
  // then the score is the distance covered in this time, i.e. the average speed.
  // (At 420 s, following finished too and the networks never learned to pass.)
  timeLimit: 300,
  finishBonus: 4000, // shared out by how early a car finishes
  crashPenalty: 1000, // a crash costs this many metres
  stallWindow: 10, // s: a car that moves less than stallMinProgress in this long is out
  stallMinProgress: 5, // m
};

export interface RunResult {
  distance: number;
  crashed: boolean;
  finishTime: number | null;
}

/**
 * Further and earlier is better; finishing always beats not finishing. A crash
 * costs up to a kilometre, but never more than half the distance driven: a flat
 * penalty made standing still the best thing a beginner network could do.
 */
export function fitness(r: RunResult): number {
  if (r.finishTime !== null) return ROAD_LENGTH + (FITNESS.finishBonus * Math.max(0, FITNESS.timeLimit - r.finishTime)) / FITNESS.timeLimit;
  return r.crashed ? r.distance - Math.min(FITNESS.crashPenalty, r.distance / 2) : r.distance;
}

/** Furthest left the car may go: two wheels on the median grass (2 m past our inner shoulder) is allowed. */
export const LEFT_LIMIT = MEDIAN_NEAR_X - 2;
/** Furthest right: the outer edge of the right shoulder (the guardrail). */
export const RIGHT_LIMIT = RAIL_D;

const CAR_W = 1.86;
const CAR_L = 4.4;

/** Corners of the car body in road coordinates (yaw > 0 turns toward +d). */
export function carCorners(s: number, d: number, yaw: number, w = CAR_W, l = CAR_L): { s: number; d: number }[] {
  const fs = Math.cos(yaw);
  const fd = Math.sin(yaw);
  const out: { s: number; d: number }[] = [];
  for (const a of [-1, 1])
    for (const b of [-1, 1]) {
      const along = (a * l) / 2;
      const side = (b * w) / 2;
      out.push({ s: s + fs * along - fd * side, d: d + fd * along + fs * side });
    }
  return out;
}

/** Any corner past the right shoulder, or more than 2 m onto the median grass. */
export function isOffRoad(s: number, d: number, yaw: number): boolean {
  return carCorners(s, d, yaw).some((c) => c.d > RIGHT_LIMIT || c.d < LEFT_LIMIT);
}

/** The car's bounding box overlaps a vehicle or wreck. */
export function hitsTraffic(s: number, d: number, yaw: number, traffic: TrafficBox[]): boolean {
  const cs = carCorners(s, d, yaw);
  let sMin = Infinity;
  let sMax = -Infinity;
  let dMin = Infinity;
  let dMax = -Infinity;
  for (const c of cs) {
    sMin = Math.min(sMin, c.s);
    sMax = Math.max(sMax, c.s);
    dMin = Math.min(dMin, c.d);
    dMax = Math.max(dMax, c.d);
  }
  for (const t of traffic) {
    if (t.phantom) continue;
    if (t.s + t.length / 2 < sMin || t.s - t.length / 2 > sMax) continue;
    if (t.dMax < dMin || t.dMin > dMax) continue;
    return true;
  }
  return false;
}
