/**
 * Nitro: a tank (0 empty .. 1 full) that fills on its own and with each near miss, burnt while it is used
 * (the player's: Shift held) to double the engine's push. It doesn't fill while in use, nor while asked for on
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
  force: 2,
  /** The car's top speed (its limiter), times, while it burns (the top gear's still the end of it). */
  topSpeed: 1.08,
  /** The AI's: each burst, seconds; seconds between them; the throttle it fires on. */
  aiBurst: 0.5,
  aiGap: 2,
  aiThrottle: 0.8,
};

export class Nitro {
  level = 0;
  /** Burning (as of the last update). */
  active = false;

  /** A step of `dt` s, the driver asking for it (`want`) or not; whether it burns. */
  update(dt: number, want: boolean): boolean {
    this.active = want && this.level > 0;
    if (this.active) this.level = Math.max(0, this.level - dt / NITRO.burn);
    else if (!want) this.level = Math.min(1, this.level + dt / NITRO.refill);
    return this.active;
  }

  nearMiss(): void {
    this.level = Math.min(1, this.level + NITRO.nearMiss);
  }

  reset(): void {
    this.level = 0;
    this.active = false;
  }
}

/** The AI's use of it, by rule: on full throttle, a NITRO.aiBurst burst whenever there is one in the tank, NITRO.aiGap apart. */
export class NitroAi {
  private burst = 0;
  private wait = 0;

  /** A step of `dt` s at `throttle` (0..1): whether to ask for nitro. */
  want(dt: number, throttle: number, nitro: Nitro): boolean {
    this.wait -= dt;
    if (this.burst > dt / 2) {
      this.burst -= dt;
      return true;
    }
    if (this.wait > 0 || throttle < NITRO.aiThrottle || nitro.level < NITRO.aiBurst / NITRO.burn) return false;
    this.burst = NITRO.aiBurst - dt;
    this.wait = NITRO.aiGap;
    return true;
  }

  reset(): void {
    this.burst = 0;
    this.wait = 0;
  }
}
