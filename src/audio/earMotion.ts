/** Faster than this (m/s) the ear jumped (a cut, a reset): its velocity zeroed, not a Doppler lurch. */
const TELEPORT_SPEED = 400;
/** The velocity's smoothing (s, time constant): the camera's shake isn't to wobble the pitch. */
const VELOCITY_TAU = 0.05;

/**
 * The ear's velocity (for the Doppler shift), from how the camera moves (as grok-aircraft2's listenerMotion): not
 * the player's car's, since the camera isn't always on it (the intro's shots, looking back, a reset).
 */
export class EarMotion {
  readonly velocity: [number, number, number] = [0, 0, 0];
  private readonly prev: [number, number, number] = [0, 0, 0];
  private valid = false;

  /** The ear now at `pos`, `dt` s (the race's time) since the last. */
  update(pos: readonly number[], dt: number): void {
    const v = this.velocity, p = this.prev;
    if (!pos.every(Number.isFinite)) return; // (an ear blown up: not taken - its NaN would stay in the velocity for good)
    if (!v.every(Number.isFinite)) v.fill(0);
    if (!this.valid || !(dt > 0)) {
      if (!this.valid) v.fill(0);
      p[0] = pos[0]; p[1] = pos[1]; p[2] = pos[2];
      this.valid = true;
      return;
    }
    const dx = (pos[0] - p[0]) / dt, dy = (pos[1] - p[1]) / dt, dz = (pos[2] - p[2]) / dt;
    p[0] = pos[0]; p[1] = pos[1]; p[2] = pos[2];
    if (Math.hypot(dx, dy, dz) > TELEPORT_SPEED) {
      v.fill(0);
      return;
    }
    const k = 1 - Math.exp(-dt / VELOCITY_TAU);
    v[0] += (dx - v[0]) * k;
    v[1] += (dy - v[1]) * k;
    v[2] += (dz - v[2]) * k;
  }

  /** Start afresh (a new race). */
  reset(): void {
    this.valid = false;
  }
}
