import { PHYSICS_DT } from '../config';
import type { Centerline } from '../road/centerline';
import type { CarSpec } from '../vehicles/cars/types';
import type { CarParams, HandlingInput } from '../vehicles/handling';
import type { Brain } from './brain';
import type { RivalDriver } from './driver';
import { MountainDriver } from './mountainDriver';
import { applyMountainNet, MOUNTAIN_NET_INPUTS, mountainNetFrom, mountainNetInputs } from './mountainNet';
import { applyDriftNet, DRIFT_NET_INPUTS, driftNetFrom, driftNetInputs } from './mountainDriftNet';
import { MOUNTAIN_PLAN, type MountainPlan, type PlanOther, planMountain } from './mountainPlanner';
import type { Plan, PlanPoint } from './planner';
import type { SelfState, TrafficBox } from './sensors';

/** How often it plans anew (s). */
export const MOUNTAIN_REPLAN = 0.25;
/**
 * At the start (its own launch's first second) a standing car ahead is taken to set off as it does - for its first
 * LAUNCH_TRUST s whatever it does, after that only if it is seen speeding up (over LAUNCH_ACCEL m/s²).
 */
const LAUNCH_TIME = 1;
const LAUNCH_TRUST = 0.3;
const LAUNCH_ACCEL = 0.5;
/** Fresh (the start, put back), its plan starts on its path with the car this near it (m); further, from the car. */
const KEEP_START = 1;
/** Others' speeding up, smoothed over this long (s). */
const ACCEL_LAG = 0.2;

/** Its plan drawn (MountainPlannerDriver.plan): a point every this many s, at least this fast (m/s: from a standstill). */
const PLAN_DRAW_STEP = 0.1;
const PLAN_DRAW_CREEP = 3;
const PLAN_DRAW_MAX = 128;

/** Its reference with no offset and no cap (before its first plan: its own passing left out from the start). */
const NO_OFFSET = { offsetAt: () => 0, vAt: () => Infinity };

/**
 * The mountain road's driver with a planner (docs/superpowers/specs/2026-11-16-mountain-planner-net-design.md): the
 * mountain driver's line, drift and all (MountainDriver), its passing replaced by planMountain every MOUNTAIN_REPLAN s
 * - every car seen, round them on either side or following - and on its line its residual network (mountainNet.ts)
 * on top. Drifting (from a hairpin's kick point to the drift's settling out) it plans nothing: the drift is the
 * mountain driver's own; out of it, it plans anew from where the car is.
 */
export class MountainPlannerDriver implements RivalDriver {
  readonly inner = new MountainDriver();
  /** Its driving network (none: the mountain driver's own control on the plan). */
  net: Brain | null = null;
  /** Its drift network (none: the mountain driver's own drift). */
  driftNet: Brain | null = null;
  private readonly driftInputs = new Float32Array(DRIFT_NET_INPUTS);
  /** Its plan now (null: none yet, or put back). */
  mplan: MountainPlan | null = null;
  private road: Centerline | null = null;
  private since = Infinity;
  private wasDrift = false;
  /** Since it last stood still (s; Infinity: not since it was put here). */
  private moving = Infinity;
  /** Others' speed last step and how they speed up (m/s, m/s²), by id. */
  private readonly seen = new Map<number, { v: number; a: number }>();
  private readonly inputs = new Float32Array(MOUNTAIN_NET_INPUTS);

  get accelScale(): number {
    return this.inner.accelScale;
  }
  set accelScale(x: number) {
    this.inner.accelScale = x;
  }
  get push(): number {
    return this.inner.push;
  }
  set push(x: number) {
    this.inner.push = x;
  }
  get budget(): number {
    return this.inner.budget;
  }
  set budget(b: number) {
    this.inner.budget = b;
  }
  get mode(): string {
    return this.inner.mode;
  }

  /**
   * Its plan for the game to draw on the road (the I key), as the highway's are: by time, every PLAN_DRAW_STEP s
   * from where it planned - across, its reference plus the plan's offset; its speed, its line's capped by the plan's.
   * Made once a plan (a getter: the game reads `plan` - a method of that name it took for a path, and froze).
   */
  get plan(): Plan | null {
    const m = this.mplan;
    // (drifting it plans nothing: the drift is the driver's own; a plan of one station - a kick point right there - is
    // no path to draw: one point, and drawing it threw and froze the game)
    if (!m || m.offsets.length < 2 || this.inner.inDrift()) return null;
    if (this.drawnFrom === m) return this.drawn;
    const inner = this.inner;
    const end = m.s0 + (m.offsets.length - 1) * m.step;
    const points: PlanPoint[] = [];
    let s = m.s0;
    for (let k = 0; k < PLAN_DRAW_MAX && (points.length < 2 || s < end); k++) {
      const v = Math.min(inner.speedAt(s), m.vAt(s));
      points.push({ t: k * PLAN_DRAW_STEP, s, d: inner.pathRefAt(s) + m.offsetAt(s), v });
      if (s >= end) break;
      s = Math.min(end, s + Math.max(PLAN_DRAW_CREEP, v) * PLAN_DRAW_STEP);
    }
    this.drawnFrom = m;
    this.drawn = { points };
    return this.drawn;
  }
  /** How long ago its plan was made (s). */
  get planAge(): number {
    return Number.isFinite(this.since) ? this.since : 0;
  }
  private drawnFrom: MountainPlan | null = null;
  private drawn: Plan | null = null;
  get aimD(): number {
    return this.inner.aimD;
  }

  setRoad(road: Centerline, ai: CarSpec['ai']): void {
    this.road = road;
    this.inner.setRoad(road, ai);
    this.net = mountainNetFrom(ai.mountainTracker);
    this.driftNet = driftNetFrom(ai.mountainDrift);
    this.reset(0);
  }

  reset(_d?: number): void {
    this.inner.reset();
    this.inner.external = NO_OFFSET;
    this.mplan = null;
    this.since = Infinity;
    this.wasDrift = false;
    this.moving = Infinity; // (put back moving: no launch; standing on the grid, it counts from there)
    this.launchOpen = true;
    this.seen.clear();
  }

  /**
   * Its launch, once after it was put here: standing, then its first LAUNCH_TIME s moving (put back moving: none).
   * Only then - stopped mid-race behind a stalled car, taken to set off it drove at it on full throttle.
   */
  private launchOpen = true;
  private launch(v: number): void {
    if (!this.launchOpen) return;
    if (v < 0.5) this.moving = 0;
    else if (this.moving === Infinity) this.launchOpen = false;
    else if ((this.moving += PHYSICS_DT) >= LAUNCH_TIME) this.launchOpen = false;
  }

  dispose(): void {
    this.inner.dispose();
  }

  drive(self: SelfState, others: TrafficBox[], p?: CarParams): HandlingInput {
    this.watch(others);
    this.launch(self.vLong);
    this.since += PHYSICS_DT;
    const drifting = this.inner.inDrift();
    // (drifting, no plan of before: its speed cap - a car followed into the hairpin - held it through the drift)
    if (drifting) this.inner.external = NO_OFFSET;
    else if (this.road && (this.since >= MOUNTAIN_REPLAN - 1e-9 || this.wasDrift || !this.mplan)) this.replan(self, others);
    this.wasDrift = drifting;
    const own = this.inner.drive(self, others, p);
    const input = this.withNet(self, own);
    // (round a hairpin after the kick: its drift network on top)
    const view = this.inner.driftView;
    if (!this.driftNet || !view) return input;
    return applyDriftNet(this.driftNet, driftNetInputs(view, input, this.driftInputs), input, view.dir);
  }

  /** The driver's input with its driving network's correction (none, or no road or line yet: as it was). */
  private withNet(self: SelfState, input: HandlingInput): HandlingInput {
    if (!this.net || !this.inner.lastLine || !this.road) return input;
    const inner = this.inner;
    const plan = this.mplan;
    mountainNetInputs(self, { d: (s) => inner.pathRefAt(s) + (plan ? plan.offsetAt(s) : 0), kappa: (s) => inner.refKappa(s) }, this.road, (s) => inner.roomAt(s), input, this.inputs);
    return applyMountainNet(this.net, this.inputs, input);
  }

  /** How each other car is speeding up (smoothed), from its speed step to step. */
  private watch(others: TrafficBox[]): void {
    const k = Math.min(1, PHYSICS_DT / ACCEL_LAG);
    for (const b of others) {
      if (b.id === undefined) continue;
      const last = this.seen.get(b.id);
      if (!last) this.seen.set(b.id, { v: b.v, a: 0 });
      else {
        last.a += ((b.v - last.v) / PHYSICS_DT - last.a) * k;
        last.v = b.v;
      }
    }
  }

  /** Plans anew (not `plan`: the game draws a driver's `plan` on the road - a method of that name it took for a path and froze). */
  private replan(self: SelfState, others: TrafficBox[]): void {
    const inner = this.inner;
    const road = this.road!;
    const v = Math.max(0, self.vLong);
    const refHere = inner.pathRefAt(self.s);
    // (from its last plan where it is, however far the car lags it - planned from the car, a car slow to follow its
    // path was never drawn back to it; out of a drift from its path - it eases back itself from where the drift left
    // it, eased again onto the next drift's entry, as the mountain driver's always did; at the start or put back, from
    // its path with the car near it, else from the car)
    const startOffset = this.wasDrift ? 0 : this.mplan ? this.mplan.offsetAt(self.s) : Math.abs(self.d - refHere) < KEEP_START ? 0 : self.d - refHere;
    const launching = this.launchOpen && this.moving < LAUNCH_TIME;
    const list: PlanOther[] = others.map((b) => {
      // (setting off with it: speeding up as it does, all the way - its line's speed at a standstill's s is ~0, and
      // capped there the car ahead was taken to stop speeding up at once: a wall it planned round or stopped for)
      // (past LAUNCH_TRUST s only one seen to speed up: a stalled one taken to set off for a second, it was run into)
      const seenA = this.seen.get(b.id ?? -1)?.a ?? 0;
      if (launching && b.v < 3 && (this.moving < LAUNCH_TRUST || seenA > LAUNCH_ACCEL)) return { s: b.s, dMin: b.dMin, dMax: b.dMax, v: b.v, accel: MOUNTAIN_PLAN.accelOthers, vAhead: Infinity, length: b.length };
      const a = Math.max(0, Math.min(MOUNTAIN_PLAN.accelOthers, this.seen.get(b.id ?? -1)?.a ?? 0));
      return { s: b.s, dMin: b.dMin, dMax: b.dMax, v: b.v, accel: a, vAhead: Math.max(b.v, inner.refSpeed(b.s, b.v)), length: b.length };
    });
    this.mplan = planMountain({
      s: self.s,
      d: self.d,
      v,
      startOffset,
      halfWidth: self.halfWidth ?? 1,
      halfLength: self.halfLength ?? 2.2,
      ref: { d: (s) => inner.pathRefAt(s), v: (s) => inner.refSpeed(s, 0), kappa: (s) => inner.refKappa(s), room: (s) => inner.roomAt(s) },
      others: list,
      stopAt: inner.kickAhead(self.s, v),
      roadEnd: road.length + 300,
    });
    inner.external = this.mplan;
    this.since = 0;
  }
}
