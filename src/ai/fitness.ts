import { MEDIAN_NEAR_X, RAIL_D, ROAD_LENGTH } from '../config';
import { lanesOccupied } from '../road/coords';
// (LEFT_LIMIT / RIGHT_LIMIT below are also what the sensors measure the edges against.)
import type { TrafficBox } from './sensors';

/** Scoring and elimination settings (mutable: tuned while training). */
export const FITNESS = {
  // s per generation. Too short to finish the road by following traffic (80-125 km/h,
  // ~180 s for 5 km): only a car averaging 120+ km/h - one that passes - gets the finish.
  // Until then the score is the distance covered in this time, i.e. the average speed.
  // (With time to spare, following finished too and the networks never learned to pass.)
  timeLimit: 150,
  finishBonus: 4000, // shared out by how early a car finishes
  crashPenalty: 1000, // a crash costs this many metres
  stallWindow: 10, // s: a car that moves less than stallMinProgress in this long is out
  stallMinProgress: 5, // m
  // Light contact is allowed (street racing): touching at under this closing speed (m/s,
  // along the way the two meet: end-on or side-on, see `endOn`) is not a crash, but each
  // contact costs contactPenalty metres so rubbing does not pay. As CONTACT_TUNING.npcWreckSpeed in the game.
  lightContactSpeed: 15 / 3.6,
  contactPenalty: 50,
  // Overlapping the same vehicle longer than this (s) is driving through it: a crash.
  maxContactTime: 0.5,
};

export interface RunResult {
  distance: number;
  crashed: boolean;
  finishTime: number | null;
  /** Light contacts (each counted once, when it starts). */
  contacts?: number;
  /** Times put back on the road after a crash (TrainingSimOptions.resetOnCrash). */
  resets?: number;
}

/**
 * Further and earlier is better; finishing always beats not finishing. A crash
 * costs up to a kilometre, but never more than half the distance driven: a flat
 * penalty made standing still the best thing a beginner network could do.
 */
export function fitness(r: RunResult): number {
  const contacts = (r.contacts ?? 0) * FITNESS.contactPenalty;
  if (r.finishTime !== null) return ROAD_LENGTH + (FITNESS.finishBonus * Math.max(0, FITNESS.timeLimit - r.finishTime)) / FITNESS.timeLimit - contacts;
  return (r.crashed ? r.distance - Math.min(FITNESS.crashPenalty, r.distance / 2) : r.distance) - contacts;
}

/** Furthest left the car may go: two wheels on the median grass (2 m past our inner shoulder) is allowed. */
export const LEFT_LIMIT = MEDIAN_NEAR_X - 2;
/** Furthest right: the outer edge of the right shoulder (the guardrail). */
export const RIGHT_LIMIT = RAIL_D;

// The street racer's body (the default; a car's own: CarParams.width, length).
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

/**
 * Whether the car (bounding box) meets `t` end-on - its nose or tail into the
 * other's, overlapping less along the road than across - rather than side-on.
 * Taken as the contact starts, that is the way the two push on each other.
 */
export function endOn(s: number, d: number, yaw: number, t: TrafficBox, w = CAR_W, l = CAR_L): boolean {
  const cs = carCorners(s, d, yaw, w, l);
  const sMin = Math.min(...cs.map((c) => c.s));
  const sMax = Math.max(...cs.map((c) => c.s));
  const dMin = Math.min(...cs.map((c) => c.d));
  const dMax = Math.max(...cs.map((c) => c.d));
  const along = Math.min(sMax, t.s + t.length / 2) - Math.max(sMin, t.s - t.length / 2);
  const across = Math.min(dMax, t.dMax) - Math.max(dMin, t.dMin);
  return along < across;
}

/** Any corner past the right shoulder, or more than 2 m onto the median grass. */
export function isOffRoad(s: number, d: number, yaw: number, w = CAR_W, l = CAR_L): boolean {
  return carCorners(s, d, yaw, w, l).some((c) => c.d > RIGHT_LIMIT || c.d < LEFT_LIMIT);
}

/**
 * The car's bounding box overlaps a vehicle or wreck. Traffic from behind in
 * `ownLane` (the lane the car holds, or is leaving) does not count: the traffic
 * does not see the AI cars in training, but in the game it brakes for the
 * player, so a car running into the AI's back there is not the AI's crash
 * (otherwise slowing down behind a blocked lane is never safe to learn).
 * For the same reason a vehicle changing lanes into the car while it holds its
 * lane does not count (in the game it would have waited for the player).
 * Cutting into another lane in front of traffic still is.
 */
export function hitsTraffic(s: number, d: number, yaw: number, traffic: TrafficBox[], ownLane: number | null = null): boolean {
  return touching(s, d, yaw, traffic, ownLane).length > 0;
}

/** What `hitsTraffic` would count as hit, one entry per vehicle or wreck touched. */
export function touching(
  s: number,
  d: number,
  yaw: number,
  traffic: TrafficBox[],
  ownLane: number | null = null,
  out: TrafficBox[] = [],
  w = CAR_W,
  l = CAR_L,
): TrafficBox[] {
  out.length = 0;
  const cs = carCorners(s, d, yaw, w, l);
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
    if (ownLane !== null && t.s < s && lanesOccupied(t.dMin, t.dMax).includes(ownLane)) continue;
    if (ownLane !== null && t.id !== undefined && traffic.some((x) => x.phantom && x.id === t.id)) continue; // merging into us
    if (t.s + t.length / 2 < sMin || t.s - t.length / 2 > sMax) continue;
    if (t.dMax < dMin || t.dMin > dMax) continue;
    out.push(t);
  }
  return out;
}
