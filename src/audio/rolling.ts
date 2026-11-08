import type { LoopSource, PlacedLoopSpec } from './placedLoops';

/**
 * The tyres rolling on the road: one recording (a car's road noise at ROLL_RECORDED m/s: effects.bin's `roll`, a
 * seamless loop), played for each traffic vehicle (the player's and the rivals' not: their engines are heard) - faster
 * with its speed (its rate the speed over the recording's, as a recording at that speed would be) and louder
 * (ROLL_POWER: about +9 dB each doubling of the speed), none at a standstill; each from where it is (ROLLS).
 */
export const ROLL_RECORDED = 97 / 3.6; // m/s (60 mph)
/** The loudness's growth with the speed: the level as (speed / ROLL_RECORDED) to this. */
const ROLL_POWER = 1.5;
/** Under this speed (m/s) faded down to none (linearly): a car pulling away comes in, not on. */
const ROLL_FADE_IN = 3;
/** The level's ceiling (a car flat out: about 3x the recording's, +10 dB). */
const ROLL_LEVEL_MAX = 3;
/** The rate's bounds: slower the recording turns to a rumble, faster to a whine. */
const ROLL_RATE_MIN = 0.35;
const ROLL_RATE_MAX = 2.2;

/** How loud a vehicle's tyres roll at `speed` (m/s): 1 at the recording's speed. */
export function rollLevel(speed: number): number {
  const v = Math.max(0, speed);
  if (!Number.isFinite(v) || v === 0) return 0;
  const level = Math.min(ROLL_LEVEL_MAX, (v / ROLL_RECORDED) ** ROLL_POWER);
  return v < ROLL_FADE_IN ? level * (v / ROLL_FADE_IN) : level;
}

/** The recording's rate for a vehicle at `speed` (m/s): 1 at the recording's speed, within its bounds. */
export function rollRate(speed: number): number {
  const r = Math.max(0, speed) / ROLL_RECORDED;
  return Number.isFinite(r) ? Math.min(ROLL_RATE_MAX, Math.max(ROLL_RATE_MIN, r)) : 1;
}

/** A vehicle's tyres heard from outside (its gain and pitch against a car's: bigger, slower-turning tyres lower). */
export type RollSource = LoopSource;

/**
 * The traffic's tyres from outside (PlacedLoops): the nearest 8 within 150 m (road noise doesn't carry as an engine
 * does), full within 8 m.
 */
export const ROLLS: PlacedLoopSpec = { voices: 8, range: 150, refDistance: 8, level: rollLevel, rate: rollRate };
