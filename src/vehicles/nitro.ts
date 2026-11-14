/**
 * Nitro: a tank (0 empty .. 1 full) that fills on its own and with each near miss, burnt while it is used
 * (the player's: Shift held) to push harder (NITRO.force). It doesn't fill while in use, nor while asked for on
 * empty.
 */
export const NITRO = {
  /** Seconds of use in a full tank. */
  burn: 4,
  /** Seconds from empty to full, on its own. */
  refill: 20,
  /** What a near miss adds. */
  nearMiss: 0.25,
  /** The engine's push, times. */
  force: 1.5,
  /** The car's top speed (its limiter), times, while it burns (the top gear's still the end of it). */
  topSpeed: 1.08,
  /** The AI's: each burst, seconds, between these (by chance); seconds off after one, between these; the throttle it fires on. */
  aiBurst: [0.4, 0.9] as const,
  aiGap: [1.5, 2.5] as const,
  aiThrottle: 0.8,
  /** The same, used most eagerly (NitroAi's `eager` 1: a rival far behind, the rubber band's). */
  aiBurstEager: [1.5, 2.5] as const,
  aiGapEager: [0.3, 0.6] as const,
};

export class Nitro {
  level = 1; // full at a race's start
  /** Burning (as of the last update). */
  active = false;
  /** Its car's tank, NITRO.burn times this (as of the last update: the tuner's is bigger, the tuning's jets). */
  burnScale = 1;

  /** A step of `dt` s, the driver asking for it (`want`) or not; whether it burns. `burn`: NITRO.burn times this. */
  update(dt: number, want: boolean, burn = 1): boolean {
    this.burnScale = burn;
    this.active = want && this.level > 0;
    if (this.active) this.level = Math.max(0, this.level - dt / (NITRO.burn * burn));
    else if (!want) this.level = Math.min(1, this.level + dt / NITRO.refill);
    return this.active;
  }

  nearMiss(): void {
    this.level = Math.min(1, this.level + NITRO.nearMiss);
  }

  /** A race's start: full. */
  reset(): void {
    this.level = 1;
    this.active = false;
  }
}

/**
 * The AI's use of it, by rule: on full throttle, a burst (NITRO.aiBurst s long, by chance) whenever there is enough
 * in the tank for it, then off for a while (NITRO.aiGap s, by chance). `eager` (0..1) moves both toward
 * NITRO.aiBurstEager and aiGapEager (longer bursts, shorter gaps). `random`: its dice (0..1).
 */
export class NitroAi {
  private burst = 0;
  private wait = 0;
  /** The next burst's dice (its length: by `eager` when it fires). */
  private next: number;

  constructor(private readonly random: () => number = Math.random) {
    this.next = this.random();
  }

  /** A step of `dt` s at `throttle` (0..1), `eager` (0..1) as keen: whether to ask for nitro. */
  want(dt: number, throttle: number, nitro: Nitro, eager = 0): boolean {
    this.wait -= dt;
    if (this.burst > dt / 2) {
      this.burst -= dt;
      return true;
    }
    const length = span(NITRO.aiBurst, NITRO.aiBurstEager, eager, this.next);
    if (this.wait > dt / 2 || throttle < NITRO.aiThrottle || nitro.level < length / (NITRO.burn * nitro.burnScale)) return false;
    this.burst = length - dt;
    this.wait = length + span(NITRO.aiGap, NITRO.aiGapEager, eager, this.random());
    this.next = this.random();
    return true;
  }

  reset(): void {
    this.burst = 0;
    this.wait = 0;
    this.next = this.random();
  }
}

/** Between `calm` and `keen` (each [lo, hi] s) by `eager`, then within that by the dice `u`. */
function span(calm: readonly [number, number], keen: readonly [number, number], eager: number, u: number): number {
  const lo = calm[0] + (keen[0] - calm[0]) * eager;
  const hi = calm[1] + (keen[1] - calm[1]) * eager;
  return lo + u * (hi - lo);
}
