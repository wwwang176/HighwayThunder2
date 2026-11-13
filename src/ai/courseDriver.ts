import { PHYSICS_DT } from '../config';
import { CarParams, DEFAULT_CAR, HandlingInput, steerRange } from '../vehicles/handling';
import type { Driver } from './driver';
import { coursePlan } from './coursePlanner';
import { emergencyBrake, planPedals, REPLAN_EVERY, type PlanSource } from './plannerDriver';
import { planAt, type AccelTable, type Plan, type PlanEgo, type PreviousPlan } from './planner';
import { STREET_RACER } from '../vehicles/cars/streetRacer';
import type { SelfState, TrafficBox } from './sensors';

/** s ahead on the plan it steers for, and the least distance (m) it looks. */
const LEAD = 0.4;
const LEAD_MIN = 3;
/** m/s of rear wheelspin the throttle starts coming off at, and all off this much past it. */
const SPIN_FROM = 3;
const SPIN_SPAN = 6;
/** m/s: slower than this it counts as standing (the brake pedal would select reverse). */
const STANDING = 0.5;

/**
 * Steering (-1..1) toward where the plan is LEAD s on (pure pursuit: the arc from the nose's direction through that
 * point), whatever the car's angle to the road - across it, standing, after a crash.
 */
export function followSteer(plan: Plan, age: number, self: SelfState, p: CarParams): number {
  const aim = planAt(plan, age + LEAD);
  const ds = aim.s - self.s, dd = aim.d - self.d;
  const fwd = ds * Math.cos(self.yaw) + dd * Math.sin(self.yaw);
  const right = -ds * Math.sin(self.yaw) + dd * Math.cos(self.yaw);
  const look = Math.max(LEAD_MIN, Math.hypot(fwd, right));
  const alpha = Math.atan2(right, Math.max(fwd, 0.1));
  const wheel = Math.atan((2 * p.wheelbase * Math.sin(alpha)) / look);
  return Math.max(-1, Math.min(1, wheel / steerRange(self.vLong, p)));
}

/** The state the planners plan from, the car's as it is. */
export function egoOf(self: SelfState, p: CarParams, accel: AccelTable, latAccel: AccelTable, brake: AccelTable | null): PlanEgo {
  return {
    s: self.s,
    d: self.d,
    v: self.vLong,
    speedCap: self.speedCap,
    vD: self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw),
    accel,
    latAccel,
    ...(brake ? { brake } : {}),
    halfWidth: self.halfWidth,
    halfLength: self.halfLength,
    yaw: self.yaw,
    vLat: self.vLat,
    turnMax: Math.tan(p.maxSteer) / p.wheelbase,
  };
}

/** Plans by direction of travel for PlannerDriver (its network steering, its emergency brake): made at once, here. */
export function courseSource(): PlanSource {
  let out: { stamp: number; plan: Plan } | null = null;
  return {
    busy: false,
    request(stamp: number, ego: PlanEgo, traffic: TrafficBox[], previous: PreviousPlan | null) {
      out = { stamp, plan: coursePlan(ego, traffic, previous) };
    },
    take() {
      const o = out;
      out = null;
      return o;
    },
  };
}

/**
 * Drives by the plans by direction of travel with a plain follower (followSteer, the plan's pedals) and the
 * emergency brake - no networks: what the plans alone do, at any angle to the road.
 */
export class CourseDriver implements Driver {
  plan: Plan | null = null;
  private madeAt = 0;
  private clock = 0;
  private earlier: { plan: Plan; t: number }[] = [];
  accel: AccelTable = STREET_RACER.ai.accel;
  latAccel: AccelTable = STREET_RACER.ai.latAccel;
  brake: AccelTable | null = null;
  /** Steps the emergency brake stepped in. */
  overrides = 0;

  get planAge(): number {
    return this.clock - this.madeAt;
  }

  reset(): void {
    this.plan = null;
    this.earlier = [];
  }

  drive(self: SelfState, traffic: TrafficBox[], p: CarParams = DEFAULT_CAR): HandlingInput {
    this.clock += PHYSICS_DT;
    if (!this.plan || this.planAge >= REPLAN_EVERY) {
      const previous = this.plan && { plan: this.plan, age: this.planAge };
      const next = coursePlan(egoOf(self, p, this.accel, this.latAccel, this.brake), traffic, previous);
      if (this.plan) this.earlier = [{ plan: this.plan, t: this.madeAt }];
      this.plan = next;
      this.madeAt = this.clock;
    }
    const age = this.planAge;
    const steer = followSteer(this.plan, age, self, p);
    const pedals = planPedals(this.plan, age, self.vLong, this.accel, this.brake);
    // Traction control: off the throttle as the rear tyres spin past their grip (flat out turning, they spun 25 m/s
    // and the tail slid out).
    const spin = self.rearSpin ?? 0;
    if (spin > SPIN_FROM) pedals.throttle *= Math.max(0, 1 - (spin - SPIN_FROM) / SPIN_SPAN);
    // Standing, the brake pedal would put it in reverse: held where it stands instead.
    if (pedals.brake > 0 && Math.abs(self.vLong) < STANDING) return { steer, throttle: 0, brake: 0, hold: true };
    const paths = [{ plan: this.plan, age }, ...this.earlier.map((e) => ({ plan: e.plan, age: this.clock - e.t }))];
    const brake = emergencyBrake(self, traffic, planAt(this.plan, age).dRate, paths, undefined, this.brake);
    if (brake > pedals.brake) {
      this.overrides++;
      return { steer, throttle: 0, brake };
    }
    return { steer, ...pedals };
  }
}
