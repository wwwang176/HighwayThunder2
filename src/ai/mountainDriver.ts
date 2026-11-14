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
  margin: 0.55,
  halfWidth: 1.0,
  /** Where it is headed across the road (aimD: passing): this far ahead (m), plus this many seconds of its speed. */
  lookBase: 4,
  lookTime: 0.35,
  lookMax: 30,
  /**
   * Steering along its path (Stanley): the path's curvature this many seconds ahead (the wheel's lag), its heading
   * error times `headingGain`, its offset closed by atan(offsetGain x error / (speed + offsetSoft)).
   */
  steerLead: 0.12,
  headingGain: 1,
  offsetGain: 2.5,
  offsetSoft: 2,
  /** It aims at the line's speed this many seconds ahead (its braking a moment early: the pedals lag), at least `leadMin` m (off the line: the line starts at a standstill). */
  lead: 0.35,
  leadMin: 5,
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
  /** Past the finish, braked down to this (m/s; 40 km/h, as the highway's FINISHED_SPEED). */
  pastFinish: 40 / 3.6,
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
    this.layLine();
  }

  /** A new road (a new race), and the car's limits (CarSpec.ai). */
  setRoad(road: Centerline, car: LineCar): void {
    this.road = road;
    this.car = car;
    this.layLine();
  }

  /** Its line and speeds for the road and budget (not `plan`: the game draws a driver's `plan` - the planner's path). */
  private layLine(): void {
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

  /**
   * Its path at s (the line plus the passing offset, kept on the road): where across (d), its heading off the road's
   * (rad, + toward +d) and its curvature (1/m).
   */
  private pathAt(s: number): { d: number; psi: number; kappa: number } {
    const line = this.line!;
    const h = 1;
    const clamp = (x: number) => Math.max(-this.room, Math.min(this.room, x));
    const d = clamp(lineAt(line, s).d + this.offset);
    const d1 = clamp(lineAt(line, s + h).d + this.offset);
    const d0 = clamp(lineAt(line, s - h).d + this.offset);
    const kc = this.road!.curvature(s);
    return { d, psi: Math.atan2((d1 - d0) / (2 * h), 1 - kc * d), kappa: lineAt(line, s).kappa };
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
    let target = Math.min(this.speedAt(Math.max(0, self.s) + Math.max(T.leadMin, T.lead * v)), self.speedCap);
    // Past the finish it slows down (the mountain road runs out: not the highway's coasting on for ever).
    if (self.s > road.length) target = Math.min(target, T.pastFinish);

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

    // Along the line (Stanley): its curvature a moment ahead steered for, its heading and its offset closed on.
    const look = Math.min(T.lookMax, T.lookBase + T.lookTime * v);
    this.aimD = Math.max(-this.room, Math.min(this.room, lineAt(line, self.s + look).d + this.offset));
    const here = this.pathAt(self.s);
    const ahead = this.pathAt(self.s + T.steerLead * v);
    const err = self.d - here.d; // (+: right of where it should be)
    const headingErr = here.psi - self.yaw; // (+: the path heads more to the right than the car)
    const angle = Math.atan(p.wheelbase * ahead.kappa) + T.headingGain * headingErr - Math.atan((T.offsetGain * err) / (v + T.offsetSoft));
    const steer = Math.max(-1, Math.min(1, angle / steerRange(v, p)));
    const pedals = speedPedals(target, self.vLong);
    return { ...pedals, steer };
  }
}
