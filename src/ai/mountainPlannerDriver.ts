import { PHYSICS_DT } from '../config';
import type { Centerline } from '../road/centerline';
import type { CarSpec } from '../vehicles/cars/types';
import type { CarParams, HandlingInput } from '../vehicles/handling';
import type { Brain } from './brain';
import type { RivalDriver } from './driver';
import { MountainDriver } from './mountainDriver';
import { applyMountainNet, MOUNTAIN_NET_INPUTS, mountainNetFrom, mountainNetInputs } from './mountainNet';
import { MOUNTAIN_PLAN, type MountainPlan, type PlanOther, planMountain } from './mountainPlanner';
import type { SelfState, TrafficBox } from './sensors';

/** How often it plans anew (s). */
export const MOUNTAIN_REPLAN = 0.25;
/** At the start (its own launch's first second) a standing car ahead is taken to set off as it does. */
const LAUNCH_TIME = 1;
/** Its plan's start kept from its last plan while the car is this near it (m); further (out of a drift): from the car. */
const KEEP_START = 1;
/** Others' speeding up, smoothed over this long (s). */
const ACCEL_LAG = 0.2;

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
  get aimD(): number {
    return this.inner.aimD;
  }

  setRoad(road: Centerline, ai: CarSpec['ai']): void {
    this.road = road;
    this.inner.setRoad(road, ai);
    this.net = mountainNetFrom(ai.mountainTracker);
    this.reset(0);
  }

  reset(_d?: number): void {
    this.inner.reset();
    this.inner.external = NO_OFFSET;
    this.mplan = null;
    this.since = Infinity;
    this.wasDrift = false;
    this.moving = Infinity; // (put back moving: no launch; standing on the grid, it counts from there)
    this.seen.clear();
  }

  dispose(): void {
    this.inner.dispose();
  }

  drive(self: SelfState, others: TrafficBox[], p?: CarParams): HandlingInput {
    this.watch(others);
    this.moving = self.vLong < 0.5 ? 0 : this.moving + PHYSICS_DT;
    this.since += PHYSICS_DT;
    const drifting = this.inner.inDrift();
    if (!drifting && this.road && (this.since >= MOUNTAIN_REPLAN || this.wasDrift || !this.mplan)) this.plan(self, others);
    this.wasDrift = drifting;
    const input = this.inner.drive(self, others, p);
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

  private plan(self: SelfState, others: TrafficBox[]): void {
    const inner = this.inner;
    const road = this.road!;
    const v = Math.max(0, self.vLong);
    const refHere = inner.pathRefAt(self.s);
    // (from its last plan where it is, however far the car lags it - planned from the car, a car slow to follow its
    // path was never drawn back to it; out of a drift from its path - it eases back itself from where the drift left
    // it, eased again onto the next drift's entry, as the mountain driver's always did; at the start or put back, from
    // its path with the car near it, else from the car)
    const startOffset = this.wasDrift ? 0 : this.mplan ? this.mplan.offsetAt(self.s) : Math.abs(self.d - refHere) < KEEP_START ? 0 : self.d - refHere;
    const launching = this.moving < LAUNCH_TIME;
    const list: PlanOther[] = others.map((b) => {
      // (setting off with it: speeding up as it does, all the way - its line's speed at a standstill's s is ~0, and
      // capped there the car ahead was taken to stop speeding up at once: a wall it planned round or stopped for)
      if (launching && b.v < 3) return { s: b.s, dMin: b.dMin, dMax: b.dMax, v: b.v, accel: MOUNTAIN_PLAN.accelOthers, vAhead: Infinity, length: b.length };
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
