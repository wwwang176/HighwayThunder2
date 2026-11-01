import { PHYSICS_DT } from '../config';
import { CarParams, DEFAULT_CAR, HandlingInput } from '../vehicles/handling';
import { Driver, speedPedals } from './driver';
import { trackSteer } from './laneController';
import { plan, Plan, planAt, PlanEgo, PreviousPlan, TRACKER_LEAD } from './planner';
import type { SelfState, TrafficBox } from './sensors';

/** s between new plans. */
export const REPLAN_EVERY = 0.25;
/** s ahead on the plan the speed is taken from (the car needs a moment to get there). */
const SPEED_PREVIEW = 0.3;
/**
 * s ahead on the plan the steering aims. Shorter than the lane controller's
 * preview: that one leads on purpose (smooth lane changes) and here made the car
 * run 0.7 m (p50) ahead of the plan's sideways moves, into what the plan was
 * still waiting to clear.
 */
export const PLAN_PREVIEW = TRACKER_LEAD;
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
 * Where plans come from when they are worked out elsewhere (a Web Worker, so
 * the game never waits on one): asked with the car's state at clock time
 * `stamp`, answered some time later with that stamp.
 */
export interface PlanSource {
  /** A request is out and not answered yet. */
  readonly busy: boolean;
  request(stamp: number, ego: PlanEgo, traffic: TrafficBox[], previous: PreviousPlan | null): void;
  /** The answer that came in since last asked, if any. */
  take(): { stamp: number; plan: Plan } | null;
}

/**
 * Drives by the planner with plain controllers: a new plan every
 * `REPLAN_EVERY` s, steering along it (the lane controller's tracker) and at
 * its speed, with an emergency brake for what is right ahead. The reference
 * for the network that is to learn the driving part.
 *
 * Plans are made right here (training, benchmarks: repeatable), or by a
 * `PlanSource` (the game): then a plan is followed from the moment it was
 * asked for, so it does not matter that it arrives a frame or two later.
 */
export class PlannerDriver implements Driver {
  plan: Plan | null = null;
  /** Clock time of the car state the current plan was made from. */
  private madeAt = 0;
  /** Steps the emergency brake had to step in (the plan cut it too fine). */
  overrides = 0;
  /** How far the car ends up from where plans said it would be (benchmarks only: `measure()`). */
  tracking: TrackingStats | null = null;
  private recent: { plan: Plan; t: number }[] = [];
  private clock = 0;
  /** Answers to requests made up to this clock time are thrown away (the car was moved since). */
  private staleUpTo = -1;

  constructor(private readonly source: PlanSource | null = null) {}

  /** s since the current plan was made (to draw it from where the car is now). */
  get planAge(): number {
    return this.clock - this.madeAt;
  }

  /** Record plan-vs-actual errors from now on. */
  measure(): TrackingStats {
    this.tracking = { lateralMoving: [], lateralHolding: [], along: [], speedAtOverride: [] };
    return this.tracking;
  }

  reset(): void {
    this.plan = null;
    this.recent = [];
    this.staleUpTo = this.clock; // answers for the car before it was moved are no use
  }

  drive(self: SelfState, traffic: TrafficBox[], p: CarParams = DEFAULT_CAR): HandlingInput {
    this.clock += PHYSICS_DT;
    if (!this.plan || this.planAge >= REPLAN_EVERY) {
      const previous = this.plan && { plan: this.plan, age: this.planAge };
      const vD = self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw);
      const ego = { s: self.s, d: self.d, v: self.vLong, speedCap: self.speedCap, vD };
      if (!this.source) this.adopt(plan(ego, traffic, previous), this.clock);
      else if (!this.source.busy) this.source.request(this.clock, ego, traffic, previous);
    }
    const answer = this.source?.take();
    if (answer && answer.stamp > this.staleUpTo) this.adopt(answer.plan, answer.stamp);
    if (!this.plan) return { steer: 0, throttle: 0, brake: 0 }; // the first plan is on its way
    if (this.tracking) this.record(self);
    const age = this.planAge;
    const aim = planAt(this.plan, age + PLAN_PREVIEW);
    const steer = trackSteer(aim.d, aim.dRate, self.d, self.yaw, self.vLong, self.vLat, p);
    const pedals = speedPedals(planAt(this.plan, age + SPEED_PREVIEW).v, self.vLong);
    const brake = emergencyBrake(self, traffic);
    if (brake > pedals.brake) {
      this.overrides++;
      this.tracking?.speedAtOverride.push(self.vLong - planAt(this.plan, age).v);
      return { steer, throttle: 0, brake };
    }
    return { steer, ...pedals };
  }

  private adopt(p: Plan, stamp: number): void {
    this.plan = p;
    this.madeAt = stamp;
    if (this.tracking) this.recent.push({ plan: p, t: stamp });
  }

  /** Compare where the car is with where the plan made MEASURE_AFTER s ago put it now. */
  private record(self: SelfState): void {
    const st = this.tracking!;
    while (this.recent.length && this.clock - this.recent[0].t > MEASURE_AFTER + 1e-9) {
      const r = this.recent.shift()!;
      if (this.clock - r.t > MEASURE_AFTER + PHYSICS_DT) continue;
      const at = planAt(r.plan, MEASURE_AFTER);
      const moving = Math.abs(planAt(r.plan, MEASURE_AFTER - 0.25).d - at.d) > 0.05;
      (moving ? st.lateralMoving : st.lateralHolding).push(self.d - at.d);
      st.along.push(self.s - at.s);
    }
  }
}

/** s after a plan is made its prediction is checked (about where the next steps' collision checks look). */
const MEASURE_AFTER = 0.75;

export interface TrackingStats {
  /** Actual minus planned lateral position MEASURE_AFTER s after the plan, while the plan moved sideways / held. */
  lateralMoving: number[];
  lateralHolding: number[];
  /** Actual minus planned distance along the road (+: ahead of the plan). */
  along: number[];
  /** Speed over the plan's when the emergency brake stepped in (+: faster than planned). */
  speedAtOverride: number[];
}
