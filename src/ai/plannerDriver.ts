import { PHYSICS_DT } from '../config';
import { CarParams, DEFAULT_CAR, HandlingInput } from '../vehicles/handling';
import { Driver, speedPedals } from './driver';
import { LANE_TUNING, trackSteer } from './laneController';
import { plan, Plan, planAt } from './planner';
import type { SelfState, TrafficBox } from './sensors';

/** s between new plans. */
export const REPLAN_EVERY = 0.25;
/** s ahead on the plan the speed is taken from (the car needs a moment to get there). */
const SPEED_PREVIEW = 0.3;
const HALF_LENGTH = 2.2;
const HALF_WIDTH = 0.93;
/** Bumper gap (m) the emergency brake keeps when it has to step in. */
const STOP_GAP = 1.5;
/** m/s² of braking it takes before the emergency brake steps in, and how much more is full brake. */
const EMERGENCY_FROM = 4;
const EMERGENCY_RANGE = 6;

/**
 * Brake needed (0..1) not to run into what is right ahead of the car's own
 * width: nothing until matching the leader's speed in the room left would take
 * more than `EMERGENCY_FROM` m/s². A last resort when the plan cut it too fine
 * (or something changed since it was made), not a cruise control: the planner
 * decides how close to follow.
 */
export function emergencyBrake(self: SelfState, traffic: TrafficBox[]): number {
  let need = 0;
  for (const t of traffic) {
    if (t.phantom || t.s <= self.s || t.dMax < self.d - HALF_WIDTH || t.dMin > self.d + HALF_WIDTH) continue;
    const closing = self.vLong - t.v;
    if (closing <= 0) continue;
    const room = t.s - t.length / 2 - (self.s + HALF_LENGTH) - STOP_GAP;
    need = Math.max(need, room <= 0.1 ? Infinity : (closing * closing) / (2 * room));
  }
  return Math.min(1, Math.max(0, (need - EMERGENCY_FROM) / EMERGENCY_RANGE));
}

/**
 * Drives by the planner with plain controllers: a new plan every
 * `REPLAN_EVERY` s, steering along it (the lane controller's tracker) and at
 * its speed, with an emergency brake for what is right ahead. The reference
 * for the network that is to learn the driving part.
 */
export class PlannerDriver implements Driver {
  plan: Plan | null = null;
  /** s since the current plan was made. */
  private age = 0;
  /** Steps the emergency brake had to step in (the plan cut it too fine). */
  overrides = 0;

  reset(): void {
    this.plan = null;
  }

  drive(self: SelfState, traffic: TrafficBox[], p: CarParams = DEFAULT_CAR): HandlingInput {
    if (!this.plan || this.age >= REPLAN_EVERY) {
      const previous = this.plan && { plan: this.plan, age: this.age };
      this.plan = plan({ s: self.s, d: self.d, v: self.vLong, speedCap: self.speedCap }, traffic, previous);
      this.age = 0;
    }
    this.age += PHYSICS_DT;
    const aim = planAt(this.plan, this.age + LANE_TUNING.preview);
    const steer = trackSteer(aim.d, aim.dRate, self.d, self.yaw, self.vLong, self.vLat, p);
    const pedals = speedPedals(planAt(this.plan, this.age + SPEED_PREVIEW).v, self.vLong);
    const brake = emergencyBrake(self, traffic);
    if (brake > pedals.brake) {
      this.overrides++;
      return { steer, throttle: 0, brake };
    }
    return { steer, ...pedals };
  }
}
