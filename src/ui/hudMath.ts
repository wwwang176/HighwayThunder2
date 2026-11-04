import { LANE_WIDTH, ROAD_LENGTH } from '../config';

/** Car length (m, bumper to bumper gaps): the racers are all this long. */
const CAR_L = 4.4;
/** How far along the race `s` (m) is: 0 at the start, 1 at the finish. */
export function progress(s: number): number {
  return Math.min(1, Math.max(0, s / ROAD_LENGTH));
}

/**
 * The rival closest behind the player within `range` m (bumper to bumper):
 * the gap, its colour, and the side it is on (-1 left, 0 right behind, 1
 * right, by a third of a lane). Null when none is that close.
 */
export function closestBehind(
  me: { s: number; d: number },
  rivals: { s: number; d: number; color: string }[],
  range: number,
): { gap: number; color: string; side: -1 | 0 | 1 } | null {
  let best: { gap: number; color: string; side: -1 | 0 | 1 } | null = null;
  for (const r of rivals) {
    const gap = Math.round((me.s - r.s - CAR_L) * 10) / 10;
    if (r.s >= me.s || gap > range || (best && gap >= best.gap)) continue;
    const off = r.d - me.d;
    best = { gap: Math.max(0, gap), color: r.color, side: off < -LANE_WIDTH / 3 ? -1 : off > LANE_WIDTH / 3 ? 1 : 0 };
  }
  return best;
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
