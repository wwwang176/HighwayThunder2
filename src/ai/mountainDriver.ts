import { PHYSICS_DT } from '../config';
import type { Centerline } from '../road/centerline';
import { MOUNTAIN, roadEdges } from '../road/mountain';
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
  /**
   * Drifting round every hairpin (the player's: for show, slower or not; pulling the handbrake, sliding hard on the
   * inside) - its tight run (tighter than R `tight`): the handbrake pulled `kickEarly` s before it for `kickTime` s, the
   * wheel `kickSteer` in (0.4 s on full lock flung it in at 6 m/s across: caught, drifted again), then driftControl: the slide held by the wheel (`angle` rad), the line kept by the throttle and a little
   * of the slide, by where it will be `look` s on (driftOff) - back to following its line `exitEarly` m before the
   * bend ends (the spring straightens it). Not under `minSpeed` (m/s). Its slide past `catchAt` (rad): caught -
   * following its line (counter-steering). Into it no faster than `side` m/s² sideways round its radius plus `room` m
   * (drifting, the rear's grip less: at the line's speed it slid wide into the wall), braked down to that at `brake`
   * m/s². Its line `center` m out from the middle (not the racing line's: wide in, on the apex, wide out - chasing it,
   * it straightened the drift), `wide` m off either edge (the car's corners, turned across the road, swept the walls).
   */
  drift: {
    tight: 26,
    kickEarly: 0.35,
    kickTime: 0.2,
    kickSteer: 0.6,
    angle: (25 * Math.PI) / 180,
    angleGain: (6 * Math.PI) / 180,
    angleLeast: 0.2,
    angleMost: (38 * Math.PI) / 180,
    gas: 0.5,
    gasGain: 0.25,
    panic: 1,
    counter: 0.25,
    rateGain: 1,
    rateMost: 3,
    look: 0.5,
    center: -1,
    useLine: 0,
    exitEarly: 4,
    minSpeed: 30 / 3.6,
    catchAt: 0.6,
    side: 11,
    room: 4,
    brake: 7,
    wide: 1.5,
  },
  /** Past the finish, braked down to this (m/s; 40 km/h, as the highway's FINISHED_SPEED). */
  pastFinish: 40 / 3.6,
  /** ...and stopped this far past it (m: short of where the road runs out, MOUNTAIN.after). */
  stopPast: 300,
};

/** A hairpin's tight run: from, to (s, m), which way (+1 right). */
export interface HairpinRun {
  from: number;
  to: number;
  dir: 1 | -1;
}

/** The road's hairpins: its runs bent tighter than R `tight` one way (m). */
export function hairpinRuns(road: Centerline, tight: number): HairpinRun[] {
  const out: HairpinRun[] = [];
  let open: HairpinRun | null = null;
  for (let s = 0; s <= road.length; s += 0.5) {
    const k = road.curvature(s);
    const dir = Math.sign(k) as 1 | -1;
    if (Math.abs(k) > 1 / tight) {
      if (open && open.dir === dir) open.to = s;
      else {
        open = { from: s, to: s, dir };
        out.push(open);
      }
    } else open = null;
  }
  return out;
}

/**
 * In a drift round a hairpin turning `dir` (+1 right): its slide held by the wheel (turned in for `angle` rad of slide:
 * the drift assist's spring asks sqrt(slide / `limit`) of the wheel), its line kept by the throttle (`gas`, `gasGain`
 * more a metre it will be off it outward: the push toward its nose grows with the throttle) and a little by the slide
 * (`angleGain` a metre, within `angleLeast`..`angleMost`) - not catching the slide when it turned in tight, to drift
 * again when it went wide (the player's: each hairpin drifted twice); about to hit the inside wall (`danger`),
 * counter-steered. `off`: where it will be off its line (m, + right of it: driftOff).
 */
export function driftControl(
  dir: 1 | -1,
  off: number,
  D: { angle: number; angleGain: number; angleLeast: number; angleMost: number; gas: number; gasGain: number; counter: number },
  limit: number,
  danger = false,
): { steer: number; throttle: number } {
  const outward = -dir * off;
  const throttle = Math.max(0, Math.min(1, D.gas + D.gasGain * outward));
  if (danger) return { steer: -dir * D.counter, throttle: D.gas / 2 };
  const angle = Math.max(D.angleLeast, Math.min(D.angleMost, D.angle + D.angleGain * outward));
  return { steer: dir * Math.min(1, Math.sqrt(angle / limit)), throttle };
}
/**
 * In a drift round a hairpin turning `dir` (+1 right): how much faster it should be moving in toward its line (m/s;
 * - too fast) - toward its line (`lineD`, kept `wide` m inside the room either side: the car's corners, turned across
 * the road, swept the walls) as fast as `rateGain` x how far it is (1/s), at most `rateMost` m/s; at `d`, moving `vd`
 * m/s across (+ right). (On how far off its line alone it turned in hard from the outside and could not stop: drifted
 * once, caught, drifted again.)
 */
export function driftRate(dir: 1 | -1, d: number, vd: number, lineD: number, room: number, D: { wide: number; rateGain: number; rateMost: number }): number {
  const keep = Math.max(0, room - D.wide);
  const toIt = dir * (Math.max(-keep, Math.min(keep, lineD)) - d);
  const want = Math.max(-D.rateMost, Math.min(D.rateMost, D.rateGain * toIt));
  return want - dir * vd;
}

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
  /** The road's hairpins (hairpinRuns), the one it last pulled the handbrake into, and how long more it holds it (s). */
  private hairpins: HairpinRun[] = [];
  private kicked: HairpinRun | null = null;
  private kickLeft = 0;
  /** Its room either side of the centre line on a straight (m); roomAt: a bend's wider. */
  readonly room = MOUNTAIN.edge - MOUNTAIN_DRIVER.halfWidth - MOUNTAIN_DRIVER.margin;
  /** Its room either side of the centre line at s (m: the road wider in a bend, roadEdges' widen; not the shoulder). */
  roomAt(s: number): number {
    return this.road ? this.room + roadEdges(this.road).widen(s) : this.room;
  }

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
    this.hairpins = hairpinRuns(road, MOUNTAIN_DRIVER.drift.tight);
    this.reset();
    this.layLine();
  }

  /** Its line and speeds for the road and budget (not `plan`: the game draws a driver's `plan` - the planner's path). */
  private layLine(): void {
    if (!this.road || !this.car) return;
    const d = racingLine(this.road, this.room, undefined, roadEdges(this.road).widen);
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
    const clamp = (x: number, at: number) => Math.max(-this.roomAt(at), Math.min(this.roomAt(at), x));
    const d = clamp(lineAt(line, s).d + this.offset, s);
    const d1 = clamp(lineAt(line, s + h).d + this.offset, s + h);
    const d0 = clamp(lineAt(line, s - h).d + this.offset, s - h);
    const kc = this.road!.curvature(s);
    return { d, psi: Math.atan2((d1 - d0) / (2 * h), 1 - kc * d), kappa: lineAt(line, s).kappa };
  }

  reset(): void {
    this.offset = 0;
    this.kicked = null;
    this.kickLeft = 0;
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
    if (self.s > road.length) target = Math.min(target, self.s > road.length + T.stopPast ? 0 : T.pastFinish);

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
      const room = this.roomAt(b.s);
      const left = b.dMin + room; // (room beside it, to the road's edge)
      const right = room - b.dMax;
      const need = 2 * half + T.passGap;
      const lineD = lineAt(line, b.s).d;
      if (Math.max(left, right) >= need) {
        const d = right >= left ? b.dMax + half + T.passGap : b.dMin - half - T.passGap;
        want = Math.max(-room, Math.min(room, d)) - lineD;
      } else {
        want = this.offset;
        if (gap > 0) target = Math.min(target, b.v + T.followGain * Math.max(0, gap - T.followGap));
      }
    }
    this.offset += (want - this.offset) * Math.min(1, PHYSICS_DT * T.passRate);

    // Along the line (Stanley): its curvature a moment ahead steered for, its heading and its offset closed on.
    const look = Math.min(T.lookMax, T.lookBase + T.lookTime * v);
    const aimRoom = this.roomAt(self.s + look);
    this.aimD = Math.max(-aimRoom, Math.min(aimRoom, lineAt(line, self.s + look).d + this.offset));
    const here = this.pathAt(self.s);
    const ahead = this.pathAt(self.s + T.steerLead * v);
    const err = self.d - here.d; // (+: right of where it should be)
    const headingErr = here.psi - self.yaw; // (+: the path heads more to the right than the car)
    const angle = Math.atan(p.wheelbase * ahead.kappa) + T.headingGain * headingErr - Math.atan((T.offsetGain * err) / (v + T.offsetSoft));
    const steer = Math.max(-1, Math.min(1, angle / steerRange(v, p)));
    // Round a hairpin, drifting (MOUNTAIN_DRIVER.drift): slowed for it first, the handbrake pulled coming into it,
    // the wheel turned in.
    const D = T.drift;
    for (const h of this.hairpins) {
      if (h.to - D.exitEarly < self.s || h.from - self.s > 200) continue;
      const k = Math.abs(road.curvature((h.from + h.to) / 2));
      const most = Math.sqrt(D.side * (1 / k + D.room));
      const toIt = Math.max(0, h.from - self.s);
      target = Math.min(target, Math.sqrt(most * most + 2 * D.brake * toIt));
    }
    const pedals = speedPedals(target, self.vLong);
    const pin = v >= D.minSpeed ? this.hairpins.find((h) => self.s >= h.from - v * D.kickEarly && self.s <= h.to - D.exitEarly) : undefined;
    if (pin) {
      if (this.kicked !== pin) {
        this.kicked = pin;
        this.kickLeft = D.kickTime;
      }
      const handbrake = this.kickLeft > 0;
      this.kickLeft -= PHYSICS_DT;
      if (handbrake) return { ...pedals, steer: pin.dir * D.kickSteer, handbrake }; // (the kick)
      const slide = Math.abs(Math.atan2(self.vLat, Math.max(Math.abs(self.vLong), 1)));
      if (slide > D.catchAt) return { ...pedals, steer }; // (sliding too far: caught)
      // (its sideways speed across the road: along its heading off the road's, and its slide)
      const vd = self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw);
      // (driftControl's `off`: + the way it should turn more, as off its line outward)
      const off = -pin.dir * driftRate(pin.dir, self.d, vd, D.useLine ? here.d : -pin.dir * D.center, this.roomAt(self.s), D);
      // (about to hit the inside wall: look s on within panic m of its room's edge)
      const danger = pin.dir * (self.d + vd * D.look) > this.roomAt(self.s) - D.panic;
      const c = driftControl(pin.dir, off, D, p.drift?.limit ?? Math.PI / 4, danger);
      return { throttle: c.throttle, brake: 0, steer: c.steer };
    }
    return { ...pedals, steer };
  }
}
