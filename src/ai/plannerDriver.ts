import { PHYSICS_DT } from '../config';
import { CarParams, DEFAULT_CAR, HandlingInput } from '../vehicles/handling';
import type { Driver } from './driver';
import type { Brain } from './brain';
import { baseSteer, netDrive, trackerFrom } from './netTracker';
import { AccelTable, maxAccel, plan, Plan, planAt, PlanEgo, PLANNER, PreviousPlan } from './planner';
import { STREET_RACER } from '../vehicles/cars/streetRacer';
import type { SelfState, TrafficBox } from './sensors';

/** s between new plans. */
export const REPLAN_EVERY = 0.25;
/** s of plan the acceleration it wants is read over. */
const ACCEL_WINDOW = 0.3;
/** 1/s: how hard it pulls back to the plan's speed when off it. */
const SPEED_GAIN = 1.5;
/** m/s² the car loses with no pedal (drag, rolling); and what full brake gives (measured 10.8-14). */
const COAST_DECEL = 1;
const FULL_BRAKE_DECEL = 11;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Pedals for the acceleration the plan wants now (read straight off it, so a
 * plan going flat out gets the throttle all the way down - a speed-error
 * controller only gave ~70 % and the car fell behind its plans), plus a pull
 * back toward the plan's speed.
 */
export function planPedals(p: Plan, age: number, v: number, table?: AccelTable): { throttle: number; brake: number } {
  const now = planAt(p, age);
  const a = (planAt(p, age + ACCEL_WINDOW).v - now.v) / ACCEL_WINDOW + SPEED_GAIN * (now.v - v);
  if (a >= 0) return { throttle: clamp01(a / (0.95 * maxAccel(v, table))), brake: 0 }; // near flat out is flat out
  if (a > -COAST_DECEL) return { throttle: 0, brake: 0 };
  return { throttle: 0, brake: clamp01((-a - COAST_DECEL) / FULL_BRAKE_DECEL) };
}
const HALF_LENGTH = 2.2; // the car's, unless its SelfState says (the street racer's)
const HALF_WIDTH = 0.93;
/** Bumper gap (m) the emergency brake keeps when it has to step in. */
const STOP_GAP = 1.5;
/**
 * Mutable: the tuning panel and benchmarks change it. `emergencyFrom`: m/s² of
 * braking it takes before the brake steps in (tailgate, brake late and hard).
 */
export const DRIVER_TUNING = {
  emergencyFrom: 9.5,
  /** Steer with the car type's trained network (PlannerDriver.tracker) where it has one; off: the plain tracker. */
  netTracker: true,
};
/** m/s sideways that counts as getting out of the way. */
const SWERVING = 0.5;

/**
 * Brake (0..1) for what is right ahead of the car's own width: nothing until
 * matching the leader's speed in the room left would take
 * `DRIVER_TUNING.emergencyFrom` m/s², then the brake that takes - so it runs
 * flat out up to the last moment and stops hard on the leader's bumper. (Left
 * to the plans it braked early and gently: every new plan puts the hard
 * braking a moment later, and the car only ever drove their soft first part.)
 */
export function emergencyBrake(self: SelfState, traffic: TrafficBox[], plannedVD = 0): number {
  let need = 0;
  // Sideways speed: what the car has, or what the plan is taking it to if more (the car lags the plan).
  const actual = self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw);
  const vD = Math.abs(plannedVD) > Math.abs(actual) && Math.sign(plannedVD) !== -Math.sign(actual) ? plannedVD : actual;
  const halfW = self.halfWidth ?? HALF_WIDTH;
  for (const t of traffic) {
    if (t.phantom || t.s <= self.s || t.dMax < self.d - halfW || t.dMin > self.d + halfW) continue;
    const closing = self.vLong - t.v;
    if (closing <= 0) continue;
    const room = t.s - t.length / 2 - (self.s + (self.halfLength ?? HALF_LENGTH)) - STOP_GAP;
    // Swerving away from it: no brake if the car is clear of it sideways before it gets there. With
    // `steerClear` (as the planner): pulling out from dead behind it too.
    const side = t.dMax < self.d ? 1 : t.dMin > self.d ? -1 : PLANNER.steerClear ? 0 : NaN;
    const away = vD > SWERVING ? side === 1 || side === 0 : vD < -SWERVING ? side === -1 || side === 0 : false;
    if (away) {
      const overlap = vD > 0 ? t.dMax - (self.d - halfW) : self.d + halfW - t.dMin;
      if (closing * (overlap / Math.abs(vD)) < room) continue;
    }
    need = Math.max(need, room <= 0.1 ? Infinity : (closing * closing) / (2 * room));
  }
  return need < DRIVER_TUNING.emergencyFrom ? 0 : Math.min(1, need / FULL_BRAKE_DECEL);
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
  /** Done with it for good (a Web Worker is stopped). */
  dispose?(): void;
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
  /** The car's full-throttle acceleration (CarSpec.ai.accel). */
  accel: AccelTable = STREET_RACER.ai.accel;
  /** The car's cornering grip (CarSpec.ai.latAccel): how hard its plans may turn (PLANNER.latGrip). */
  latAccel: AccelTable = STREET_RACER.ai.latAccel;
  /** The car type's trained steering network (CarSpec.ai.tracker), used with DRIVER_TUNING.netTracker. */
  tracker: Brain | null = trackerFrom(STREET_RACER.ai.tracker);
  /** Engine boost on top (the rivals' rubber band): the plan and the pedals count on it. */
  accelScale = 1;
  /** Answers to requests made up to this clock time are thrown away (the car was moved since). */
  private staleUpTo = -1;

  constructor(private readonly source: PlanSource | null = null) {}

  /** s since the current plan was made (to draw it from where the car is now). */
  get planAge(): number {
    return this.clock - this.madeAt;
  }

  /** Record plan-vs-actual errors from now on. */
  measure(): TrackingStats {
    this.tracking = { lateralMoving: [], lateralHolding: [], along: [], speedAtOverride: [], nowMoving: [], nowHolding: [] };
    return this.tracking;
  }

  /** Done with this driver: its plan source (a Web Worker in the game) is stopped. */
  dispose(): void {
    this.source?.dispose?.();
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
      const ego: PlanEgo = {
        s: self.s,
        d: self.d,
        v: self.vLong,
        speedCap: self.speedCap,
        vD,
        accel: this.accelTable(),
        latAccel: this.latAccel,
        halfWidth: self.halfWidth,
        halfLength: self.halfLength,
      };
      if (!this.source) this.adopt(plan(ego, traffic, previous), this.clock);
      else if (!this.source.busy) this.source.request(this.clock, ego, traffic, previous);
    }
    const answer = this.source?.take();
    if (answer && answer.stamp > this.staleUpTo) this.adopt(answer.plan, answer.stamp);
    if (!this.plan) return { steer: 0, throttle: 0, brake: 0 }; // the first plan is on its way
    if (this.tracking) this.record(self);
    const age = this.planAge;
    // Aims trackerLead s ahead on the plan (shorter than the lane controller's preview: that one leads on purpose;
    // here it ran the car 0.7 m ahead of the plan's sideways moves, into what the plan was still waiting to clear).
    const aim = planAt(this.plan, age + PLANNER.trackerLead);
    const pedals = planPedals(this.plan, age, self.vLong, this.accelTable());
    // The car type's network steers, and takes back some of the throttle (wheelspin, a sliding tail).
    let steer: number;
    if (DRIVER_TUNING.netTracker && this.tracker) {
      const net = netDrive(this.tracker, this.plan, age, self, p, pedals.throttle);
      steer = net.steer;
      pedals.throttle = net.throttle;
    } else steer = baseSteer(this.plan, age, self, p);
    // Sideways rate the plan has now, or (`steerClear`) where the steering already aims, if more: it is on its way out.
    const now = planAt(this.plan, age).dRate;
    const brake = emergencyBrake(self, traffic, PLANNER.steerClear && Math.abs(aim.dRate) > Math.abs(now) ? aim.dRate : now);
    if (brake > pedals.brake) {
      this.overrides++;
      this.tracking?.speedAtOverride.push(self.vLong - planAt(this.plan, age).v);
      return { steer, throttle: 0, brake };
    }
    return { steer, ...pedals };
  }

  /** The acceleration it can count on now (the car's table times the boost). */
  private accelTable(): AccelTable {
    if (this.accelScale === 1) return this.accel;
    return this.accel.map(([kmh, a]) => [kmh, a * this.accelScale]);
  }

  private adopt(p: Plan, stamp: number): void {
    this.plan = p;
    this.madeAt = stamp;
    if (this.tracking) this.recent.push({ plan: p, t: stamp });
  }

  /** Compare where the car is with where the plan made MEASURE_AFTER s ago put it now. */
  private record(self: SelfState): void {
    const st = this.tracking!;
    if (this.plan) {
      const now = planAt(this.plan, this.planAge);
      (Math.abs(now.dRate) > 0.1 ? st.nowMoving : st.nowHolding).push(self.d - now.d);
    }
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
  /** Actual minus planned lateral position right now on the plan being followed (the tracker alone, not replans), moving / holding. */
  nowMoving: number[];
  nowHolding: number[];
  /** Speed over the plan's when the emergency brake stepped in (+: faster than planned). */
  speedAtOverride: number[];
}
