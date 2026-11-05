/** The speed of sound (m/s). */
export const SOUND_SPEED = 343;
/** How far the Doppler shift may go either way (a factor's bounds). */
const DOPPLER_MIN = 0.5, DOPPLER_MAX = 2;

/**
 * The Doppler factor (the heard pitch over the emitted) of a source at `src` moving at `srcV`, heard from `ear`
 * moving at `earV` (each [x, y, z]): above 1 as they close, below as they part.
 */
export function dopplerFactor(src: readonly number[], srcV: readonly number[], ear: readonly number[], earV: readonly number[]): number {
  const dx = ear[0] - src[0], dy = ear[1] - src[1], dz = ear[2] - src[2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return 1;
  // Each one's speed along the line from the source to the ear (toward the ear: positive).
  const vs = (srcV[0] * dx + srcV[1] * dy + srcV[2] * dz) / d;
  const ve = (earV[0] * dx + earV[1] * dy + earV[2] * dz) / d;
  const f = (SOUND_SPEED - ve) / Math.max(1, SOUND_SPEED - vs);
  return Math.min(DOPPLER_MAX, Math.max(DOPPLER_MIN, f));
}

/** A traffic vehicle's gearing, for its engine's sound: its gears, and the speed (m/s) its top gear tops out at. */
export interface TrafficGearing {
  gears: number;
  top: number;
}

/** Each gear pulls from this share of the engine's range (idle 0 .. redline 1) to the next; first gear from idle. */
const SHIFT_FROM = 0.3, SHIFT_TO = 0.8;

/**
 * A traffic vehicle's engine (it has no gearbox of its own): its rpm, as a share of its idle..redline, from its
 * speed - each gear an equal span of speed, pulling from SHIFT_FROM to SHIFT_TO, first gear from the idle, top
 * gear on up to the redline at `top` - and its throttle (0..1) from its acceleration (m/s²).
 */
export function trafficEngine(v: number, accel: number, g: TrafficGearing): { rpm: number; throttle: number } {
  const span = g.top / g.gears;
  const k = Math.max(0, v) / span; // gears' worth of speed
  let rpm: number;
  if (k < 1) rpm = k * SHIFT_TO;
  else if (k < g.gears - 1) rpm = SHIFT_FROM + (k - Math.floor(k)) * (SHIFT_TO - SHIFT_FROM);
  else rpm = Math.min(1, SHIFT_FROM + (k - (g.gears - 1)) * (1 - SHIFT_FROM));
  return { rpm, throttle: Math.min(1, Math.max(0, 0.4 + accel / 2)) };
}
