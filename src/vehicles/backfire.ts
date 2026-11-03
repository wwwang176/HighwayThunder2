/** Exhaust backfire (tunable). */
export const BACKFIRE = {
  /** Lifting off from at least this much throttle ... */
  from: 0.6,
  /** ... to under this ... */
  to: 0.1,
  /** ... with the engine at least this share of its redline, pops. */
  rpm: 0.55,
  /** How many pops (at most). */
  most: 3,
  /** Seconds from the lift to the first pop, from the end of one to the next (each between these). */
  delay: [0.08, 0.25] as const,
  gap: [0.08, 0.22] as const,
  /** Each pop's flame, seconds. */
  pop: 0.07,
};

/**
 * When the exhaust pops: lifting off the throttle at high revs, 1 to BACKFIRE.most pops a moment later (unburnt
 * fuel going off in the hot exhaust). Back on the throttle, the rest are off.
 */
export class Backfire {
  private armed = false;
  private wait = 0;
  private left = 0;
  private flame = 0;

  constructor(private readonly rng: () => number = Math.random) {}

  /** A step of `dt` s: the throttle (0..1) and the engine's share of its redline; whether a flame shows. */
  update(dt: number, throttle: number, rpmShare: number): boolean {
    if (throttle >= BACKFIRE.from) {
      this.armed = true;
      this.left = 0;
      this.flame = 0;
    } else if (this.armed && throttle < BACKFIRE.to) {
      this.armed = false;
      if (rpmShare >= BACKFIRE.rpm) {
        this.left = 1 + Math.floor(this.rng() * BACKFIRE.most);
        this.wait = this.between(BACKFIRE.delay);
      }
    }
    if (this.flame > 0) {
      this.flame -= dt;
      if (this.flame <= 0 && this.left > 0) this.wait = this.between(BACKFIRE.gap);
      return this.flame > 0;
    }
    if (this.left > 0) {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.left--;
        this.flame = BACKFIRE.pop;
        return true;
      }
    }
    return false;
  }

  reset(): void {
    this.armed = false;
    this.left = 0;
    this.flame = 0;
  }

  private between([lo, hi]: readonly [number, number]): number {
    return lo + this.rng() * (hi - lo);
  }
}
