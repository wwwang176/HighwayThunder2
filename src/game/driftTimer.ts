/**
 * The player's drift on the HUD (the player's: as the near miss has its message): it starts past `on` of slide (rad)
 * at `minSpeed` (m/s) or faster, and goes on down to `keep` (less: no flicker on and off at the edge); let go, it is held
 * `grace` s - drifting again within it, it goes on, its seconds on from where they were (the player's: 0.5 s) - its
 * seconds counted only while it slides.
 */
export const DRIFT_TIMER = {
  on: (15 * Math.PI) / 180,
  keep: (10 * Math.PI) / 180,
  minSpeed: 30 / 3.6,
  grace: 0.5,
};

/** What the HUD shows: nothing, a drift on (its seconds), one let go but still held, one just over (its seconds, once). */
export interface DriftReport {
  state: 'off' | 'on' | 'grace' | 'done';
  seconds: number;
}

export class DriftTimer {
  private state: 'off' | 'on' | 'grace' = 'off';
  private seconds = 0;
  private graceLeft = 0;

  /** A step of `dt` s at `slide` (rad, either way) and `speed` (m/s). */
  update(dt: number, slide: number, speed: number, T = DRIFT_TIMER): DriftReport {
    const sliding = speed >= T.minSpeed && slide >= (this.state === 'off' ? T.on : T.keep);
    if (sliding) {
      if (this.state === 'off') this.seconds = 0;
      this.state = 'on';
      this.seconds += dt;
      return { state: 'on', seconds: this.seconds };
    }
    if (this.state === 'on') {
      this.state = 'grace';
      this.graceLeft = T.grace;
    }
    if (this.state === 'grace') {
      this.graceLeft -= dt;
      if (this.graceLeft > 1e-9) return { state: 'grace', seconds: this.seconds };
      this.state = 'off';
      return { state: 'done', seconds: this.seconds };
    }
    return { state: 'off', seconds: this.seconds };
  }

  reset(): void {
    this.state = 'off';
    this.seconds = 0;
    this.graceLeft = 0;
  }
}
