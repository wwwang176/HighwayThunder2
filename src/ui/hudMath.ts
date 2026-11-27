import { LANE_WIDTH, ROAD_LENGTH } from '../config';

/** Car length (m, bumper to bumper gaps): the racers are all this long. */
const CAR_L = 4.4;
/** How far along the race `s` (m) is: 0 at the start, 1 at the finish. */
export function progress(s: number, length = ROAD_LENGTH): number {
  return Math.min(1, Math.max(0, s / length));
}

/**
 * The rival closest behind the player within `range` m (bumper to bumper):
 * the gap, and how far to the side of the player it is (m, + its right). Null when none is that close. Not one
 * within BEHIND_FROM m: alongside, on the screen already (it showed 0 m) - the next one back if any.
 */
export const BEHIND_FROM = 2;
export function closestBehind(me: { s: number; d: number }, rivals: { s: number; d: number }[], range: number): { gap: number; off: number } | null {
  let best: { gap: number; off: number } | null = null;
  for (const r of rivals) {
    const gap = Math.round((me.s - r.s - CAR_L) * 10) / 10;
    if (r.s >= me.s || gap <= BEHIND_FROM || gap > range || (best && gap >= best.gap)) continue;
    best = { gap, off: Math.round((r.d - me.d) * 100) / 100 };
  }
  return best;
}

/**
 * Where across the screen's bottom edge (% from its left) the arrow for a rival `off` m to the side shows: where it
 * is, a lane over 12 % off the middle, kept `edge` % in from the sides. (It was in one of three places: left, right
 * behind, right.)
 */
export const BEHIND_X = { perLane: 12, edge: 8 };
export function behindX(off: number): number {
  return Math.min(100 - BEHIND_X.edge, Math.max(BEHIND_X.edge, 50 + (off / LANE_WIDTH) * BEHIND_X.perLane));
}

/** The place got better since the last frame (null: no last frame yet). */
export function overtook(before: number | null, now: number): boolean {
  return before !== null && now < before;
}

/** When the R (put back on the road) hint shows: the car all but stopped, or on its side or roof, for a while. */
export const RESET_HINT = {
  /** Slower than this (km/h)... */
  stoppedKmh: 5,
  /** ...for this long (s). */
  stoppedSeconds: 3,
  /** The car's up axis pointing less up than this (its y: 1 upright, 0 on its side, -1 on its roof)... */
  flippedUpY: 0.5,
  /** ...for this long (s). */
  flippedSeconds: 1,
};

/** The R hint's timers: update() each race frame, true while the hint should show. */
export class ResetHint {
  private stopped = 0;
  private flipped = 0;

  update(dt: number, speedKmh: number, upY: number): boolean {
    this.stopped = speedKmh < RESET_HINT.stoppedKmh ? this.stopped + dt : 0;
    this.flipped = upY < RESET_HINT.flippedUpY ? this.flipped + dt : 0;
    return this.stopped >= RESET_HINT.stoppedSeconds || this.flipped >= RESET_HINT.flippedSeconds;
  }

  clear(): void {
    this.stopped = 0;
    this.flipped = 0;
  }
}

/** How the HUD shakes with the camera (its share of the camera's shake, held to a readable most): the tuning panel's. */
export const HUD_SHAKE = {
  /** vw per m of the camera's shake (across, up and down). */
  move: 12,
  /** Of the camera's tilt. */
  tilt: 0.5,
  /** At most, vw and degrees. */
  maxMove: 1.2,
  maxTilt: 1.5,
};

const clampTo = (v: number, most: number) => Math.max(-most, Math.min(most, v)) + 0; // (+0: no -0)

/**
 * The HUD's shake for the camera's: `right` and `up` its offset (m, across the view and up), `roll` its tilt
 * (rad). The HUD goes with the picture (which moves against the camera), a share of it: x and y in vw (y down the
 * screen), the tilt in degrees.
 */
export function hudShake(right: number, up: number, roll: number): { x: number; y: number; deg: number } {
  const s = HUD_SHAKE;
  return {
    x: clampTo(-right * s.move, s.maxMove),
    y: clampTo(up * s.move, s.maxMove),
    deg: clampTo(((-roll * 180) / Math.PI) * s.tilt, s.maxTilt),
  };
}
