import { PHYSICS_DT } from '../config';
import type { Centerline } from '../road/centerline';
import { MOUNTAIN } from '../road/mountain';
import { type CarParams, DEFAULT_CAR, type HandlingInput, steerRange } from '../vehicles/handling';
import { type RivalDriver, speedPedals } from './driver';
import { type LineCar, lineAt, type RaceLine, racingLine, speedProfile } from './mountainLine';
import type { SelfState, TrafficBox } from './sensors';

/** The mountain driver's settings (mutable: tuning). */
export const MOUNTAIN_DRIVER = {
  /** Room either side of the centre line its line may use: the road's edge less half a car and a margin (m). */
  margin: 0.35,
  halfWidth: 0.95,
  /** Pure pursuit: the point it steers for is this far ahead (m), plus this many seconds of its speed. */
  lookBase: 4,
  lookTime: 0.35,
  lookMax: 30,
  /** It aims at the line's speed this many seconds ahead (its braking a moment early: the pedals lag). */
  lead: 0.35,
  /** A car ahead within this (m, bumper to bumper) and slower than it: passed on the side with more room, else followed. */
  passFrom: 40,
  /** Room it wants beside a car it passes (m, past the car's side), and how fast it moves over to the side (1/s). */
  passGap: 0.5,
  passRate: 1.5,
  /** Following: the speed of the car ahead plus this much per metre of the gap past `followGap`. */
  followGap: 5,
  followGain: 0.5,
  /** The top speed its line is planned to (m/s: past any car's; the car's own limit caps it). */
  vMax: 100,
};

/**
 * Drives the mountain road: its racing line (least curvature within the road: mountainLine) at the line's speeds
 * (`budget` of the car's grip and brakes; the rubber band's `push` takes it up to all of them), steering by pure
 * pursuit for a point on the line ahead; a slower car ahead on its line passed on the side with more room, or
 * followed when there is none. No traffic on the mountain road: what it meets are the other racers.
 */
export class MountainDriver implements RivalDriver {
  accelScale = 1;
  /** The rubber band's push (0..1): its speeds from `budget`'s to the grip's own. */
  push = 0;
  /** Its line at `budget` and at the grip's whole. */
  line: RaceLine | null = null;
  private full: RaceLine | null = null;
  private road: Centerline | null = null;
  private car: LineCar | null = null;
  private budgetNow = 0.9;
  /** Its passing offset from the line now (m, + right). */
  private offset = 0;
  /** Where it steers for, across the road (m): the line's there plus the offset. */
  aimD = 0;
  readonly room = MOUNTAIN.edge - MOUNTAIN_DRIVER.halfWidth - MOUNTAIN_DRIVER.margin;

  /** Share of its car's grip and brakes its line is planned to (the race's difficulty). */
  get budget(): number {
    return this.budgetNow;
  }

  set budget(b: number) {
    if (b === this.budgetNow) return;
    this.budgetNow = b;
    this.plan();
  }

  /** A new road (a new race), and the car's limits (CarSpec.ai). */
  setRoad(road: Centerline, car: LineCar): void {
    this.road = road;
    this.car = car;
    this.plan();
  }

  private plan(): void {
    if (!this.road || !this.car) return;
    const d = racingLine(this.road, this.room);
    this.line = speedProfile(this.road, d, this.car, this.budgetNow, MOUNTAIN_DRIVER.vMax);
    this.full = speedProfile(this.road, d, this.car, 1, MOUNTAIN_DRIVER.vMax);
  }

  /** The speed it aims at at s (m/s): the line's, pushed toward the grip's whole. */
  speedAt(s: number): number {
    if (!this.line || !this.full) return 0;
    const a = lineAt(this.line, s).v;
    return a + (lineAt(this.full, s).v - a) * Math.min(1, Math.max(0, this.push));
  }

  reset(): void {
    this.offset = 0;
  }

  dispose(): void {}

  drive(self: SelfState, others: TrafficBox[], p: CarParams = DEFAULT_CAR): HandlingInput {
    const road = this.road;
    const line = this.line;
    if (!road || !line) return { throttle: 0, brake: 1, steer: 0 };
    const T = MOUNTAIN_DRIVER;
    const v = Math.max(0, self.vLong);
    const half = self.halfWidth ?? T.halfWidth;
    const halfLen = self.halfLength ?? 2.2;
    let target = Math.min(this.speedAt(self.s + T.lead * v), self.speedCap);

    // The racer ahead on its line nearest it: passed on the roomier side, or followed.
    let want = 0;
    let nearest = Infinity;
    for (const b of others) {
      const gap = b.s - b.length / 2 - (self.s + halfLen);
      if (gap < -halfLen || gap > T.passFrom || gap >= nearest) continue;
      const myD = lineAt(line, b.s).d + this.offset;
      if (b.dMax < myD - half - T.passGap || b.dMin > myD + half + T.passGap) continue; // (not in its way)
      if (b.v >= target - 0.5 && gap > 0) continue; // (as fast: no need)
      nearest = gap;
      const left = b.dMin + this.room; // (room beside it, to the road's edge)
      const right = this.room - b.dMax;
      const need = 2 * half + T.passGap;
      const lineD = lineAt(line, b.s).d;
      if (Math.max(left, right) >= need) {
        const d = right >= left ? b.dMax + half + T.passGap : b.dMin - half - T.passGap;
        want = Math.max(-this.room, Math.min(this.room, d)) - lineD;
      } else {
        want = this.offset;
        if (gap > 0) target = Math.min(target, b.v + T.followGain * Math.max(0, gap - T.followGap));
      }
    }
    this.offset += (want - this.offset) * Math.min(1, PHYSICS_DT * T.passRate);

    // Pure pursuit for the point on the line ahead.
    const look = Math.min(T.lookMax, T.lookBase + T.lookTime * v);
    const sT = self.s + look;
    this.aimD = Math.max(-this.room, Math.min(this.room, lineAt(line, sT).d + this.offset));
    const c = road.toWorld(self.s, self.d);
    const t = road.toWorld(sT, this.aimD);
    const phi = road.heading(self.s) + self.yaw;
    const fx = Math.sin(phi);
    const fz = -Math.cos(phi);
    const dx = t.x - c.x;
    const dz = t.z - c.z;
    const ahead = dx * fx + dz * fz;
    const across = dx * Math.cos(phi) + dz * Math.sin(phi);
    const k = (2 * across) / Math.max(1, ahead * ahead + across * across);
    const angle = Math.atan(p.wheelbase * k);
    const steer = Math.max(-1, Math.min(1, angle / steerRange(v, p)));
    const pedals = speedPedals(target, self.vLong);
    return { ...pedals, steer };
  }
}
