import { KMH, LANE_WIDTH, RAIL_D, ROAD_HALF_WIDTH } from '../config';
import type { Plan } from '../ai/planner';
import type { SelfState, TrafficBox } from '../ai/sensors';
import { type CarParams, DEFAULT_CAR, type DriveInput, steerRange } from '../vehicles/handling';

/**
 * The police cars' numbers (docs/superpowers/specs/2026-11-24-police-chase-design.md): `count` at once; a parked one
 * pulls out for a racer coming within `wake` m; one further than `lost` m from every racer has lost them, and is parked
 * again `parkAhead` m ahead of the leader (in the fog); a hit closing at `bustKmh` or more busts the player (a scrape
 * or a knock does not: at 15 km/h a light touch did, the user found), not within `grace` s of being put back, and it is put back `bustSeconds` s (real) later. Ramming: the line
 * to the target clear within `laneWidth` m each side (about one SUV wide: narrower than the spec's "two cars"),
 * aimed `aimAhead` s on. Seen by the player up to `viewAhead` m ahead (the highway's fog ends at 650 m): one is lost,
 * and parked again, only out of its sight (outOfSight) - at 300 m ahead in the fog, it was seen to vanish.
 */
export const POLICE_TUNING = { count: 3, wake: 250, lost: 300, playerFirst: 100, notice: 100, parkAhead: 700, viewAhead: 700, bustKmh: 45, grace: 2, bustSeconds: 3, laneWidth: 1.1, aimAhead: 0.3 };

/** A guard prediction's horizon (s): at least, at most (the planner's own), and past getting to the police car. */
const GUARD_HORIZON = { least: 2, most: 8, more: 1 };

/**
 * A racer as the police see it: where (along, across the road), how fast (m/s), the player or not, past the line
 * (`done`), who (`id`: the same each step), and - driven by the AI - the plan it is following (`plan`: no guessing);
 * `yaw` its nose off the road's heading (rad, + toward +d), `vLat` its sideways speed off its nose (m/s, + to its
 * right) - none: straight down the road.
 */
export type Racer = { s: number; d: number; v: number; isPlayer: boolean; done?: boolean; id?: number; plan?: Plan | null; yaw?: number; vLat?: number };

/** How fast (m/s, + toward +d) a racer moves across the road (as PlannerDriver's egoOf). */
export function racerVD(r: Racer): number {
  return r.v * Math.sin(r.yaw ?? 0) + (r.vLat ?? 0) * Math.cos(r.yaw ?? 0);
}

/**
 * Blocking (the user's call, 2026-11-26): a guarding police car its target will be at the tail of within `within` s
 * steers straight across to where they will be then (not by its plans: their line predicted every 0.3 s, in a worker,
 * its own plans every 0.25 s and soft on it - it moved over 0.6-1 s after a racer pulled out to pass it, too late;
 * within 2 s, pulled out further back it still took 0.95 s), training/policeBlock.train.ts,
 * by what it saw of them `react` s before (the user's: a driver's reaction, passable pulled out late enough), their
 * sideways speed on - a lane change: `reach` m over at most. Only with no traffic in its way (blockClear: beside it,
 * or ahead or behind closing in within `after` s past its target's coming, nearer than `gap` m; `margin` m to the
 * side) - else by its plans, round the traffic. Steered at a point `look` s on (`lookLeast` m at least).
 */
export const BLOCK = { within: 4, react: 0.3, reach: LANE_WIDTH, after: 1, gap: 5, margin: 0.5, look: 0.5, lookLeast: 8, noseAhead: 1 };

/**
 * Every police car after the front of its racer (the user's call, 2026-11-26): alongside it, its nose `BLOCK.noseAhead`
 * m ahead of theirs or more, it squeezes into their lane (blockAt: no traffic in the way) - their way across shut, or
 * their nose shoved round; behind them, it passes them in the lane beside them (passD) to get there, ramming only a
 * racer slowed under RAM_BELOW (stuck in traffic: the line to them clear). In front of them with them right behind it
 * in its lane, at its tail within `within` s: a brake check - full brakes, no warning (the user's), for `hold` s at
 * most (till they are out of its lane, by it, or into it), not again for `cooldown` s; `overlap` m of the two cars'
 * widths in line at least.
 */
export const BRAKE_CHECK = { within: 1, hold: 1, cooldown: 4, overlap: 0.5 };
export const RAM_BELOW = 120 * KMH;

/** A brake check due (BRAKE_CHECK): `t` (half `tHalfW` wide) behind the police car `suv`, in line with it, at its tail in `reach` s (reachTime). */
export function brakeCheckDue(suv: { s: number; d: number; halfWidth: number; halfLength: number }, t: Racer, reach: number, tHalfW: number): boolean {
  return reach > 0 && reach <= BRAKE_CHECK.within && inLine(suv, t, tHalfW);
}

/** `t` (half `tHalfW` wide) behind the police car `suv`, BRAKE_CHECK.overlap m of their widths in line at least. */
export function inLine(suv: { s: number; d: number; halfWidth: number }, t: Racer, tHalfW: number): boolean {
  return t.s < suv.s && suv.halfWidth + tHalfW - Math.abs(t.d - suv.d) >= BRAKE_CHECK.overlap;
}

/** How far (m) the police car's nose (at `suvS`, half `suvHalfL` long) is ahead of racer's (at `tS`, half `tHalfL`). */
export function noseAhead(suvS: number, suvHalfL: number, tS: number, tHalfL: number): number {
  return suvS + suvHalfL - (tS + tHalfL);
}

/** m across from its target a police car's passing line is at least (a racer on the road's edge: the shoulder too near them). */
export const PASS_ROOM = 2.8;

/** Behind its target: rams them only slowed under RAM_BELOW (else passes them to get in front). */
export function ramAllowed(targetV: number): boolean {
  return targetV < RAM_BELOW;
}

/**
 * Behind its target: the line (d) it passes them on - a lane beside theirs, or the shoulder (its middle at most: the
 * police's own, the user's call - it kept to the paved road), PASS_ROOM m over from them at least, clear of traffic
 * (`boxes`) from it to 30 m past them; of those (else of both) the nearer its own.
 */
export function passD(suv: { s: number; d: number; halfWidth: number; halfLength: number }, t: Racer, boxes: readonly TrafficBox[]): number {
  const sides = [t.d - LANE_WIDTH, t.d + LANE_WIDTH]
    .map((d) => Math.max(-SHOULDER_D, Math.min(SHOULDER_D, d)))
    .filter((d) => Math.abs(d - t.d) >= PASS_ROOM);
  if (!sides.length) return t.d;
  const clear = sides.filter((d) => lineClear({ s: suv.s, d }, { s: t.s + 30, d }, boxes, suv.halfWidth + 0.3));
  const from = clear.length ? clear : sides;
  return from.reduce((a, b) => (Math.abs(b - suv.d) < Math.abs(a - suv.d) ? b : a));
}

/** How soon (s) racer `t` (half `tHalfL` long) is at the tail of a police car at `suvS` (half `suvHalfL`) going `suvV`: 0 alongside or past, never (Infinity) not closing in. */
export function reachTime(suvS: number, suvV: number, suvHalfL: number, t: Racer, tHalfL: number): number {
  const gap = suvS - suvHalfL - (t.s + tHalfL);
  if (gap <= 0) return 0;
  const closing = t.v - suvV;
  return closing > 0 ? gap / closing : Infinity;
}

/** What a police car has seen of its target (where across the road, how fast across), for BLOCK.react s on. */
export class Sighting {
  private readonly seen: { t: number; d: number; vD: number }[] = [];

  see(time: number, d: number, vD: number): void {
    this.seen.push({ t: time, d, vD });
    // (kept only as far back as the newest one BLOCK.react s old)
    while (this.seen.length > 1 && this.seen[1].t <= time - BLOCK.react) this.seen.shift();
  }

  /** At `time`: what it saw BLOCK.react s before (none that old yet: null). */
  at(time: number): { d: number; vD: number } | null {
    let found: { d: number; vD: number } | null = null;
    for (const x of this.seen) if (x.t <= time - BLOCK.react + 1e-9) found = x;
    return found;
  }

  clear(): void {
    this.seen.length = 0;
  }
}

/** Where (d) a racer seen at `seenD` moving across at `seenVD` m/s will be `ahead` s on: BLOCK.reach m over at most, on the road (a car `halfWidth` wide there). */
export function blockD(seenD: number, seenVD: number, ahead: number, halfWidth: number): number {
  const over = Math.max(-BLOCK.reach, Math.min(BLOCK.reach, seenVD * ahead));
  const edge = ROAD_HALF_WIDTH - halfWidth;
  return Math.max(-edge, Math.min(edge, seenD + over));
}

/**
 * No traffic (`boxes`) in the way of a police car (`self`) moving across to `toD` for `horizon` s: nothing beside it
 * in the band it sweeps (BLOCK.margin m more to each side), nothing ahead of it or behind it there it would close in on
 * (or that would on it) within BLOCK.gap m in that time.
 */
export function blockClear(self: { s: number; d: number; v: number; halfWidth: number; halfLength: number }, toD: number, horizon: number, boxes: readonly TrafficBox[]): boolean {
  const lo = Math.min(self.d, toD) - self.halfWidth - BLOCK.margin, hi = Math.max(self.d, toD) + self.halfWidth + BLOCK.margin;
  const front = self.s + self.halfLength, rear = self.s - self.halfLength;
  for (const b of boxes) {
    if (b.dMax <= lo || b.dMin >= hi) continue;
    const bRear = b.s - b.length / 2, bFront = b.s + b.length / 2;
    if (bRear > front) {
      if (bRear - front < Math.max(0, self.v - b.v) * horizon + BLOCK.gap) return false;
    } else if (bFront < rear) {
      if (rear - bFront < Math.max(0, b.v - self.v) * horizon + BLOCK.gap) return false;
    } else return false;
  }
  return true;
}

/** Blocking: its steering (-1..1) toward `toD`, at a point BLOCK.look s on (BLOCK.lookLeast m at least). */
export function blockSteer(self: SelfState, toD: number, p: CarParams = DEFAULT_CAR): number {
  const look = Math.max(BLOCK.lookLeast, self.vLong * BLOCK.look);
  return ramInput(self, { s: self.s + look, d: toD }, p).steer;
}

/** The shoulder's middle (d): where a police car parks. */
export const SHOULDER_D = (ROAD_HALF_WIDTH + RAIL_D) / 2;

/** The chase starts: any racer (the player or a rival) has come within POLICE_TUNING.notice m of a police car parked at `parkedS`. */
export function chaseStarts(parkedS: number, racers: readonly Racer[]): boolean {
  return racers.some((r) => r.s > parkedS - POLICE_TUNING.notice);
}

/**
 * Who a police car at `suvS` goes for: the player within POLICE_TUNING.playerFirst m (either way), else the nearest
 * racer within `range` m; none: null.
 */
export function pickTarget(suvS: number, racers: readonly Racer[], range: number): Racer | null {
  const first = Math.min(range, POLICE_TUNING.playerFirst);
  const player = racers.find((r) => r.isPlayer && !r.done && Math.abs(r.s - suvS) <= first);
  if (player) return player;
  let best: Racer | null = null;
  for (const r of racers) if (!r.done && Math.abs(r.s - suvS) <= range && (!best || Math.abs(r.s - suvS) < Math.abs(best.s - suvS))) best = r;
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

/** Out of the player's sight: over `behind` m behind it (POLICE_TUNING.lost), or ahead past the fog (viewAhead). */
export function outOfSight(suvS: number, playerS: number, behind = POLICE_TUNING.lost, ahead = POLICE_TUNING.viewAhead): boolean {
  return suvS < playerS - behind || suvS > playerS + ahead;
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

/**
 * Guarding: where across the road (d) the target's predicted line (`predicted`: its plan, as the planner would drive it)
 * is as it gets to `suvS` - between its points by s; past its end, its end's. A target standing: where it is.
 */
export function guardD(predicted: Plan, suvS: number, target: Racer): number {
  const pts = predicted.points;
  if (target.v <= 1 || !pts.length) return target.d;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (b.s >= suvS) return b.s > a.s ? a.d + ((b.d - a.d) * Math.max(0, suvS - a.s)) / (b.s - a.s) : b.d;
  }
  return pts[pts.length - 1].d;
}

/** How far (s) a guard prediction looks: as long as the target takes to get to the police car, and 1 s more; 2 to 8 s. */
export function guardHorizon(suvS: number, target: Racer): number {
  if (target.v <= 1) return GUARD_HORIZON.most;
  return Math.max(GUARD_HORIZON.least, Math.min(GUARD_HORIZON.most, (suvS - target.s) / target.v + GUARD_HORIZON.more));
}
