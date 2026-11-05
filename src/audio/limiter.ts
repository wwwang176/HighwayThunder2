/**
 * The master limiter's math (after grok-aircraft2's). It runs in limiter.worklet.js (an AudioWorkletProcessor, on
 * the audio thread, which can't import modules): this is the same formula, line for line, where it can be tested -
 * change one, change both.
 *
 * Why not a DynamicsCompressorNode: it has no lookahead. Even at its fastest attack a transient's first peak gets
 * through whole - and a crash is all transient.
 */

/** Lookahead, s: enough to cover a transient's rise, too short to hear as a delay. */
export const LIMITER_LOOKAHEAD = 0.005;
/** Ceiling, dBFS (sample peak; -1.5 leaves about 0.5 dB for the true peak between samples, ITU-R BS.1770). */
export const LIMITER_CEILING_DB = -1.5;
/** Release, s: shorter wobbles (distortion), longer leaves everything dull a while after a loud moment. */
export const LIMITER_RELEASE = 0.12;
/**
 * Attack time constant, s - not 0: dropping a dB or two between two samples is a kink in the waveform, heard as a
 * crack in the bass. A sixth of the lookahead: six time constants (0.25 % left) still before the peak arrives.
 */
export const LIMITER_ATTACK = LIMITER_LOOKAHEAD / 6;
export const LIMITER_CEILING = 10 ** (LIMITER_CEILING_DB / 20);

/** The gain that keeps `peak` (the lookahead window's largest magnitude) at the ceiling. */
export function limiterTarget(peak: number, ceiling = LIMITER_CEILING): number {
  return peak > ceiling ? ceiling / peak : 1;
}

/** The gain a sample on toward `target`: down at the attack's rate, back up at the release's. */
export function limiterStep(gain: number, target: number, releaseCoeff: number, attackCoeff: number): number {
  return target + (gain - target) * (target < gain ? attackCoeff : releaseCoeff);
}

/** A time constant (s) as its per-sample coefficient at `sampleRate`. */
export function timeCoeff(seconds: number, sampleRate: number): number {
  return seconds > 0 && sampleRate > 0 ? Math.exp(-1 / (seconds * sampleRate)) : 0;
}

/**
 * The largest of the last `size` values pushed: a monotonic queue, amortised O(1) a sample (scanning a 240-sample
 * window every sample cost the audio thread 1.5-8 %).
 */
export class WindowPeak {
  private readonly vals: Float32Array;
  private readonly ats: Float64Array;
  private head = 0;
  private count = 0;
  private n = 0;

  constructor(private readonly size: number) {
    this.vals = new Float32Array(size);
    this.ats = new Float64Array(size);
  }

  /** Push a sample's magnitude; the window's largest after it. */
  push(mag: number): number {
    const size = this.size;
    while (this.count > 0 && this.ats[this.head] <= this.n - size) {
      this.head = this.head + 1 === size ? 0 : this.head + 1;
      this.count--;
    }
    while (this.count > 0) {
      const back = (this.head + this.count - 1) % size;
      if (this.vals[back] > mag) break;
      this.count--;
    }
    const at = (this.head + this.count) % size;
    this.vals[at] = mag;
    this.ats[at] = this.n;
    this.count++;
    this.n++;
    return this.vals[this.head];
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.n = 0;
  }
}
