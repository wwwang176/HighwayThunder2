/**
 * How a layered engine sound follows the rpm: which of its clips sound at an rpm, how loud, how fast.
 *
 * Its clips, each one steady rev of the engine, rise in rpm; each is played at rpm / its own rpm (times the set's
 * pitch), and between two neighbours the sound crossfades (equal power, by log rpm) across a narrow band around
 * their rpms' geometric mean (±HANDOVER, kept within the two). One car, one microphone, its clips matched: a
 * crossfade is all the handover needs (as the pack itself does it).
 *
 * The game's rpm (idle .. redline) is laid onto the sound's own range: its lowest clip at its own speed for the
 * idle, its highest at TOP times its own for the redline (as the pack itself plays it at its top rpm; a pack's
 * revs reach only so high, and this keeps every clip near its own speed rather than the real car's range). On the
 * rev limiter (atLimiter), the set's limiter clip in their place.
 */

/** Each handover: ± this factor around the two clips' geometric mean. */
export const HANDOVER = 1.04;
/** The highest clip's speed at the redline (pushed past its own it only sounded shrill). */
export const TOP = 1;
/** On the rev limiter from this share of the redline on (the pack's own threshold), the throttle past LIMITER_THROTTLE. */
export const LIMITER_FROM = 0.988;
export const LIMITER_THROTTLE = 0.5;

/** Whether the engine is on its rev limiter: at the redline, the throttle held open (the fuel cut stuttering it). */
export function atLimiter(rpm: number, redline: number, throttle: number): boolean {
  return rpm >= redline * LIMITER_FROM && throttle > LIMITER_THROTTLE;
}

/** Where each pair of neighbouring clips hands over: [from, to] rpm, by the sound's rpm. */
export function handovers(rpms: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < rpms.length - 1; i++) {
    const m = Math.sqrt(rpms[i] * rpms[i + 1]);
    out.push([Math.max(rpms[i], m / HANDOVER), Math.min(rpms[i + 1], m * HANDOVER)]);
  }
  return out;
}

/** The sound's rpm for the game's: idle -> the lowest clip's, redline -> TOP times the highest's (linear; past the
 * redline it carries on, below the idle it holds). */
export function soundRpm(rpm: number, idle: number, redline: number, rpms: readonly number[]): number {
  const lo = rpms[0], hi = rpms[rpms.length - 1] * TOP;
  return lo + (Math.max(rpm, idle) - idle) / (redline - idle) * (hi - lo);
}

/**
 * Each clip's gain (0..1) and playback rate at the sound's rpm `s`, into `gains` and `rates` (one per clip). At most
 * two clips sound at once; their gains' squares sum to 1.
 */
export function mixAt(s: number, rpms: readonly number[], pitch: number, bands: readonly [number, number][], gains: number[], rates: number[]): void {
  const n = rpms.length;
  for (let i = 0; i < n; i++) {
    gains[i] = 0;
    rates[i] = (s / rpms[i]) * pitch;
  }
  for (let i = 0; i < n - 1; i++) {
    const [a, b] = bands[i];
    if (s < a) {
      gains[i] = 1;
      return;
    }
    if (s <= b) {
      const t = b > a ? Math.log(s / a) / Math.log(b / a) : 1;
      gains[i] = Math.cos((t * Math.PI) / 2);
      gains[i + 1] = Math.sin((t * Math.PI) / 2);
      return;
    }
  }
  gains[n - 1] = 1;
}
