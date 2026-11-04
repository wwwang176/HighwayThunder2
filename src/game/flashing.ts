/**
 * A rival flashing its high beam at a car in its way: closing fast on a racer ahead in its lane (the player or
 * another rival), it flashes - on, off, on - to tell it to move over; then waits a while before it would again.
 * Rules, not the driver network. On race time (paused: held).
 */
export const FLASH = {
  /** A car ahead within this (m, along the road)... */
  ahead: 100,
  /** ...this near its lane's middle to its own (m, across)... */
  lane: 1.8,
  /** ...this much slower (m/s: 40 km/h)... */
  closing: 40 / 3.6,
  /** ...and reached within this (s) at that. */
  within: 5,
  /** How many flashes, each this long on (s), with this much off between. */
  flashes: 2,
  on: 0.12,
  off: 0.12,
  /** After a flashing, this long (s, from its start) before another. */
  cooldown: 3,
};

/** A racer on the road: along it (m), across it (m), its speed (m/s). */
export interface RoadCar {
  s: number;
  d: number;
  v: number;
}

/** Whether `me` is closing fast on one of `others` ahead in its lane. */
export function wantsToFlash(me: RoadCar, others: RoadCar[]): boolean {
  for (const o of others) {
    const gap = o.s - me.s;
    const closing = me.v - o.v;
    if (gap <= 0 || gap > FLASH.ahead || Math.abs(o.d - me.d) > FLASH.lane) continue;
    if (closing >= FLASH.closing && gap / closing <= FLASH.within) return true;
  }
  return false;
}

/** One rival's flashing: update() each frame (race time), whether its high beam is on now. */
export class BeamFlasher {
  /** Since the flashing started (s); null: none going and none waited out. */
  private t: number | null = null;

  update(dt: number, wants: boolean): boolean {
    if (this.t !== null) {
      this.t += dt;
      if (this.t >= FLASH.cooldown) this.t = null;
    }
    if (this.t === null && wants) this.t = 0;
    if (this.t === null) return false;
    const period = FLASH.on + FLASH.off;
    const i = Math.floor(this.t / period);
    return i < FLASH.flashes && this.t - i * period < FLASH.on;
  }
}
