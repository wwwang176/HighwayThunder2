import { LANE_COUNT } from '../config';
import { laneAt, laneCenter } from '../road/coords';
import { CarParams, steerRange } from '../vehicles/handling';

/** Seconds for one lane change (smoothstep path: peak lateral accel 6·3.75/2² ≈ 5.6 m/s²). */
export const LANE_CHANGE_TIME = 2;
/**
 * Path tracker settings, tuned against the player car's handling at 40-300 km/h
 * (overshoot under 0.15 m, settled about 1.5 s after the change starts).
 * k: cross-track gain; preview: s ahead on the path the car aims for.
 */
export const LANE_TUNING = { k: 0.8, preview: 0.65 };

const smoothstep = (u: number) => u * u * (3 - 2 * u);

/**
 * Keeps the AI car on a lane centre and moves it to a neighbouring lane along a
 * smooth path when asked (the same path shape the traffic uses). The network
 * only decides *when* and *where*.
 */
export class LaneController {
  targetLane: number;
  private from: number;
  /** Time into the current lane change (≥ LANE_CHANGE_TIME: none under way). */
  private t = LANE_CHANGE_TIME;

  constructor(lane: number) {
    this.targetLane = lane;
    this.from = laneCenter(lane);
  }

  get changing(): boolean {
    return this.t < LANE_CHANGE_TIME;
  }

  /** The lane being left during a change; the held lane otherwise. */
  get fromLane(): number {
    return this.changing ? laneAt(this.from) : this.targetLane;
  }

  /** Planned lateral position now. */
  get dPlan(): number {
    return this.planAt(this.t).d;
  }

  /** Start moving to `lane` from where the car is; false if it does not exist or a change is under way. */
  start(lane: number, d: number): boolean {
    if (this.changing || lane < 0 || lane >= LANE_COUNT || lane === this.targetLane) return false;
    this.from = d;
    this.targetLane = lane;
    this.t = 0;
    return true;
  }

  /** Follow the lane the car is in now (after a reset or respawn moved it). */
  sync(d: number): void {
    this.targetLane = laneAt(d);
    this.t = LANE_CHANGE_TIME;
  }

  update(dt: number): void {
    if (this.changing) this.t = Math.min(LANE_CHANGE_TIME, this.t + dt);
  }

  /** Planned lateral position and speed `t` seconds into the change. */
  private planAt(t: number): { d: number; rate: number } {
    const to = laneCenter(this.targetLane);
    const u = Math.min(1, t / LANE_CHANGE_TIME);
    if (u >= 1) return { d: to, rate: 0 };
    return { d: this.from + (to - this.from) * smoothstep(u), rate: ((to - this.from) * 6 * u * (1 - u)) / LANE_CHANGE_TIME };
  }

  /** Steering input (-1..1) that tracks the planned path (aiming `LANE_TUNING.preview` s ahead on it). */
  steer(d: number, yaw: number, vLong: number, vLat: number, p: CarParams): number {
    const plan = this.planAt(this.t + LANE_TUNING.preview);
    return trackSteer(plan.d, plan.rate, d, yaw, vLong, vLat, p);
  }
}

/**
 * Steering input (-1..1) toward lateral position `dAim` moving sideways at
 * `rate` (both taken a preview time ahead on a path): Stanley (cross-track
 * error at the front axle, the path's lateral speed fed forward), but on the
 * direction the car actually travels (heading plus body slip) and limited only
 * by the car's own grip-derived steering range - the player car understeers far
 * more than the kinematic model the traffic's tracker caps its wheel angle by,
 * and would never finish a lane change at speed under that cap.
 */
export function trackSteer(dAim: number, rate: number, d: number, yaw: number, vLong: number, vLat: number, p: CarParams): number {
  const v = Math.max(vLong, 1);
  const course = yaw + Math.atan2(vLat, v);
  const e = dAim - (d + Math.sin(yaw) * (p.wheelbase / 2));
  const angle = Math.atan2(rate, v) - course + Math.atan2(LANE_TUNING.k * e, v + 2);
  return Math.max(-1, Math.min(1, angle / steerRange(vLong, p)));
}
