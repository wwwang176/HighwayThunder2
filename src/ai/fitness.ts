import { MEDIAN_NEAR_X, RAIL_D, ROAD_LENGTH } from '../config';
import type { TrafficBox } from './sensors';

/** Scoring and elimination settings (mutable: tuned while training). */
export const FITNESS = {
  timeLimit: 240, // s per generation
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

/** Further and earlier is better; crashing costs a kilometre; finishing always beats not finishing. */
export function fitness(r: RunResult): number {
  if (r.finishTime !== null) return ROAD_LENGTH + (FITNESS.finishBonus * Math.max(0, FITNESS.timeLimit - r.finishTime)) / FITNESS.timeLimit;
  return r.crashed ? r.distance - FITNESS.crashPenalty : r.distance;
}

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

/** Any corner off our pavement (past the right shoulder or into the median). */
export function isOffRoad(s: number, d: number, yaw: number): boolean {
  return carCorners(s, d, yaw).some((c) => c.d > RAIL_D || c.d < MEDIAN_NEAR_X);
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
    if (t.s + t.length / 2 < sMin || t.s - t.length / 2 > sMax) continue;
    if (t.dMax < dMin || t.dMin > dMax) continue;
    return true;
  }
  return false;
}
