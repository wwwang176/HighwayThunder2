import type { PlacedLoopSpec } from './placedLoops';

/**
 * The wind past the player's car: a wind recording (a steady loop: engineCatalog WIND_LOOP), unplaced as its engine,
 * louder and a little higher with its speed - none at a crawl, about +12 dB each doubling of the speed (1 at its
 * WIND_REF), capped - and pitched with the race's time (sound.ts setWind).
 */
export const WIND_REF = 200 / 3.6; // m/s: the loop as recorded (level 1, rate 1)
/** The level's growth with the speed: (speed / WIND_REF) to this. */
const WIND_POWER = 2;
/** Its ceiling (~+6 dB over the reference: ~280 km/h). */
const WIND_LEVEL_MAX = 2;
/** The rate: WIND_RATE_SLOPE per WIND_REF of speed away from it, within its bounds. */
const WIND_RATE_SLOPE = 0.3;
const WIND_RATE_MIN = 0.75;
const WIND_RATE_MAX = 1.3;

/** How loud the wind at `speed` (m/s): 1 at WIND_REF. */
export function windLevel(speed: number): number {
  const v = Math.max(0, speed);
  if (!Number.isFinite(v)) return 0;
  return Math.min(WIND_LEVEL_MAX, (v / WIND_REF) ** WIND_POWER);
}

/** The loop's rate at `speed` (m/s): 1 at WIND_REF, within its bounds. */
export function windRate(speed: number): number {
  const r = 1 + WIND_RATE_SLOPE * (Math.max(0, speed) / WIND_REF - 1);
  return Number.isFinite(r) ? Math.min(WIND_RATE_MAX, Math.max(WIND_RATE_MIN, r)) : 1;
}

/**
 * The rivals' wind from outside (PlacedLoops): heard only close by - the nearest 5 within 40 m, full within 5 m - a
 * rush going by (its Doppler), at the player's own law of its speed.
 */
export const WINDS: PlacedLoopSpec = { voices: 5, range: 40, refDistance: 5, level: windLevel, rate: windRate };
