import { KMH, RAIL_D, ROAD_HALF_WIDTH } from '../config';
import type { SelfState, TrafficBox } from '../ai/sensors';
import { type CarParams, DEFAULT_CAR, type DriveInput, steerRange } from '../vehicles/handling';

/**
 * The police cars' numbers (docs/superpowers/specs/2026-11-24-police-chase-design.md): `count` at once; a parked one
 * pulls out for a racer coming within `wake` m; one further than `lost` m from every racer has lost them, and is parked
 * again `parkAhead` m ahead of the leader (in the fog); a hit closing at `bustKmh` or more busts the player (a scrape
 * does not), not within `grace` s of being put back, and it is put back `bustSeconds` s (real) later. Ramming: the line
 * to the target clear within `laneWidth` m each side, aimed `aimAhead` s on.
 */
export const POLICE_TUNING = { count: 3, wake: 250, lost: 300, parkAhead: 500, bustKmh: 15, grace: 2, bustSeconds: 3, laneWidth: 1.1, aimAhead: 0.3 };

/** A racer as the police see it: where (along, across the road), how fast (m/s), the player or not. */
export type Racer = { s: number; d: number; v: number; isPlayer: boolean };

/** The shoulder's middle (d): where a police car parks. */
export const SHOULDER_D = (ROAD_HALF_WIDTH + RAIL_D) / 2;

/** Who a police car at `suvS` goes for: the player within `range` m (either way), else the nearest racer within it; none: null. */
export function pickTarget(suvS: number, racers: readonly Racer[], range: number): Racer | null {
  const player = racers.find((r) => r.isPlayer && Math.abs(r.s - suvS) <= range);
  if (player) return player;
  let best: Racer | null = null;
  for (const r of racers) if (Math.abs(r.s - suvS) <= range && (!best || Math.abs(r.s - suvS) < Math.abs(best.s - suvS))) best = r;
  return best;
}

/** Ahead of its target (guarding its line) or behind it (chasing it). */
export function phaseOf(suvS: number, target: Racer): 'front' | 'behind' {
  return suvS > target.s ? 'front' : 'behind';
}

/** Nothing (no box) in the corridor `halfWidth` m either side of the straight line from `from` to `to`, between them along the road. */
export function lineClear(from: { s: number; d: number }, to: { s: number; d: number }, boxes: readonly TrafficBox[], halfWidth: number): boolean {
  const lo = Math.min(from.s, to.s), hi = Math.max(from.s, to.s);
  for (const b of boxes) {
    if (b.s + b.length / 2 < lo || b.s - b.length / 2 > hi) continue;
    const k = hi > lo ? (b.s - from.s) / (to.s - from.s) : 0;
    const d = from.d + (to.d - from.d) * Math.max(0, Math.min(1, k)); // (the line's d there)
    if (b.dMax > d - halfWidth && b.dMin < d + halfWidth) return false;
  }
  return true;
}

/** Further than `lost` m from every racer. */
export function isLost(suvS: number, racers: readonly Racer[], lost: number): boolean {
  return racers.every((r) => Math.abs(r.s - suvS) > lost);
}

/** Where a police car parks again: on the shoulder, `ahead` m ahead of the leading racer. */
export function parkSpot(racers: readonly Racer[], ahead: number): { s: number; d: number } {
  return { s: Math.max(...racers.map((r) => r.s)) + ahead, d: SHOULDER_D };
}

/** A hit busts the player: the race on, closing at bustKmh or more (a scrape not), not just after a put-back. */
export function bustAllowed(phase: string, closingKmh: number, sinceReset: number): boolean {
  return phase === 'racing' && closingKmh >= POLICE_TUNING.bustKmh && sinceReset >= POLICE_TUNING.grace;
}

/** Ramming: flat out, steered (pure pursuit, on the way the car really goes) at `aim` (s, d). */
export function ramInput(self: SelfState, aim: { s: number; d: number }, p: CarParams = DEFAULT_CAR): DriveInput {
  const v = Math.max(self.vLong, 1);
  const course = self.yaw + Math.atan2(self.vLat ?? 0, v);
  const want = Math.atan2(aim.d - self.d, Math.max(aim.s - self.s, 1));
  const steer = Math.max(-1, Math.min(1, (want - course) / steerRange(Math.max(self.vLong, 10 * KMH), p)));
  return { steer, throttle: 1, brake: 0 };
}
