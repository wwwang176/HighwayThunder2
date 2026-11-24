import { PHYSICS_DT } from '../config';
import type { Centerline } from '../road/centerline';
import { MOUNTAIN, roadEdges } from '../road/mountain';
import { type CarParams, DEFAULT_CAR, type DriveInput, steerRange } from '../vehicles/handling';
import { type RivalDriver, speedPedals } from './driver';
import { type LineCar, lineAt, type RaceLine, racingLine, speedProfile } from './mountainLine';
import type { SelfState, TrafficBox } from './sensors';
import type { DriftView } from './mountainDriftNet';

/** The mountain driver's settings (mutable: tuning). */
export const MOUNTAIN_DRIVER = {
  /** Room either side of the centre line its line may use: the road's edge less half a car and a margin (m). */
  // (0.55: at 130-146 km/h in the long bends its line ran within half a metre of the wall, the car 0.8-1 m off it -
  // with its driving network's bolder pedals, two to three times main's brushes; 1.05: as few, ~0.3 s a race)
  margin: 1.05,
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
  /**
   * At a standstill the offset term soft by this much more (m/s), easing to none at drift.minSpeed: 1.5 m off its line
   * at the start, atan(2.5 x 1.5 / 2) put the wheel on full lock and it set off 13° across the road (4 more: still
   * full lock - the wheel's whole range is ~0.55 rad; 10: half of it).
   */
  lowSoft: 10,
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
   * The share of its car's grip and brakes its line is planned to (CarSpec.ai.mountain: as measured, at the limit
   * before it slides), at every difficulty - the difficulty is its top speed only, as the highway's. (Once 0.82-0.97
   * by the difficulty, on tables 13-19 % under the car's grip. All of it: on the ground's rows half a metre apart -
   * no longer bouncing - 30 roads at 1 against 0.95 0.15-1 s faster, a wall a race either way, none stopping it; its
   * walls no longer where the bends turned the other way fast, the bounce's.)
   */
  budget: 1,
  /** Its line over a crest planned on its tyres' load there (1; 0: as on the flat) - speedProfile's `crest`. */
  crest: 1,
  /** Its line's sideways acceleration changing no faster than this (m/s³; 0: no limit) - speedProfile's `jerk`. */
  jerk: 0,
  /**
   * Its line speeding up as its tyres allow, not its engine (1; 0: its engine's table) - speedProfile's `tyreDrive`.
   * (On its engine's - even measured - it lifted off out of every hairpin the car pulled out of better than planned:
   * 30 roads 98.35 s -> 96.99 for the muscle car, the others 0.2-0.4 s.)
   */
  tyreDrive: 1,
  /**
   * Full throttle this far (m/s) under the speed it aims at (speedPedals). (The highway's 3: its aim the line's speed a
   * moment ahead - the line itself as fast as the engine speeds it up - it ran ~3 m/s under its line down every straight,
   * on part throttle out of every bend.)
   */
  gasRamp: 1,
  /**
   * Full brake this far (m/s) past a metre a second over its aim (speedPedals). (The highway's 5: coming to a hairpin it
   * was on the brakes half the time, lightly - over its aim by up to 6 m/s before they were full on.)
   */
  brakeRamp: 5,
  /**
   * Drifting round every hairpin (the player's way: for show, slower or not; pulling the handbrake, sliding hard) -
   * its tight run (tighter than R `tight`): slowed for it first (`latDrift` m/s² round the bend's radius, plus
   * `kickLoss` m/s the kick takes, braked down to that at `brake` m/s²), the handbrake pulled `kickEarly` s before
   * it for `kickTime` s with the wheel `kickSteer` in, then the slide held by the wheel and the line by the throttle
   * and the handbrake (driveRaw), back to following its line once its nose is round. Not under `minSpeed` (m/s). Its
   * slide past `catchAt` (rad): caught - following its line (counter-steering).
   */
  drift: {
    tight: 26,
    kickEarly: 0.35,
    kickTime: 0.2,
    kickSteer: 0.6,
    panic: 0.6,
    steerLeast: 0.2,
    steerMost: 1,
    approach: 60,
    exitTurn: 0.01,
    dangerLook: 0.4,
    slid: 0.17,
    over: 0.09,
    // (out of a drift its wheel eased back in and steered by its course this long (s): 1.5 held the network off it -
    // 30 roads, p15 nets: 0.05 0.4-0.5 s faster, more walls (its nets trained on 1.5); 0 divides by it - not allowed)
    recover: 0.05,
    merge: 0.5,
    recoverSteer: 0.5,
    minSpeed: 30 / 3.6,
    catchAt: 0.75,
    latDrift: 22,
    kickLoss: 2.5,
    // (its braking down to a hairpin's speed, m/s² - into it as fast either way, only later: at 5, ~0.5 g, it was off
    // the throttle 100-200 m out)
    brake: 7.5,
    lineYawDamp: 0.1,
    steerRate: 5,
    kickSlide: 0,
    hbPulse: 0.1,
    pullLook: 0.6,
    pullRoom: 2.5,
    pullGap: 0.2,
    pullMost: 0.9,
    /**
     * A big slide (the AI's once slid little, just enough; out of it the player's way): the wheel holds `bigSlide` rad
     * (35°) of slide, `bigSlideErr` more a metre wide of its line (within bigSlideMin..bigSlideMax); the throttle steady
     * at `gasMid` (the car's own: DriftAssist.ai.gas), never under `gasLow`. Into the bend's last `exitInFrac` its line
     * eased `exitIn` m in; past `alignAfter` of the bend, its nose come round parallel to the straight out of it
     * (within `alignAt` rad): done with the hairpin, sliding on out to the middle.
     */
    bigSlide: 0.6,
    bigSlideErr: 0.1,
    bigSlideMin: 0.3,
    bigSlideMax: 0.7,
    gasMid: 0.75,
    gasLow: 0.1,
    exitIn: 1.2,
    exitInFrac: 0.3,
    alignAfter: 0.4,
    alignAt: 0.03,
    slideGain: 1.5,
    springLimit: Math.PI / 4,
    innerRoom: 1,
    innerSteer: -0.3,
    innerLook: 1.2,
    innerGas: 0.2,
    aimSlide: 0,
    aimPull: 0.5,
    aimMinT: 0.6,
    viewExitD: 2,
    pullAfter: 0.4,
    entryOut: 1.5,
    mergeFrac: 0.5,
    errLook: 0.8,
    pullErr: 0.3,
    arcLag: 0.15,
    kickMax: 0.6,
    gasSlideFrom: 0.05,
    gasSlideSpan: 0.1,
    gasSlideLeast: 0.3,
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
  private budgetNow = MOUNTAIN_DRIVER.budget;
  /** Its passing offset from the line now (m, + right). */
  private offset = 0;
  /**
   * Offsets and a speed cap from outside (a planner: MountainPlannerDriver): its path its reference (refAt) plus
   * `offsetAt`, its speed no more than `vAt` a moment ahead; its own passing left out. Null: it passes by itself.
   */
  external: { offsetAt(s: number): number; vAt(s: number): number } | null = null;
  /**
   * Its last step's input if that step followed its line or settled out of a drift - the driving network's to correct
   * (MountainPlannerDriver.withNet: out of a drift on full throttle, it takes the throttle down as it needs to); null:
   * kicking, drifting, catching - the drift network's.
   */
  lastLine: DriveInput | null = null;
  /** Where it steers for, across the road (m): the line's there plus the offset. */
  aimD = 0;
  /** The road's hairpins (hairpinRuns), the one it last pulled the handbrake into, and how long more it holds it (s). */
  private hairpins: HairpinRun[] = [];
  private kicked: HairpinRun | null = null;
  private kickLeft = 0;
  /** The hairpin it is done drifting round (its slide gone after it slid), whether it has slid in this one, and how long more it steers by its course (s). */
  private done: HairpinRun | null = null;
  private slid = false;
  private recover = 0;
  /** Its slide last step (rad, signed: its course's turning, out of its heading's). */
  private lastSlide = 0;
  /** The next hairpin's kick point (s, m) and its drift line (d, m): its path eased onto that line coming to it. */
  private toPin: { kickAt: number; d: number } | null = null;
  /** What it did last (for tracing): following its line, the handbrake's kick, drifting, catching a slide, the inside wall near. */
  mode: 'line' | 'kick' | 'drift' | 'catch' | 'danger' | 'exit' | 'pull' | 'ease' = 'line';
  /** How long more it holds the handbrake mid-drift (s): turning too little, about to be thrown wide. */
  private pullLeft = 0;
  /** Since its last pull ended (s). */
  private pullSince = 99;
  /** Since the kick ended (s). */
  private sinceKick = 0;
  /** Where across it began drifting round `entryPin` (m): its line eased from there to the middle (wide round first). */
  private entryD = 0;
  private entryPin: HairpinRun | null = null;
  /** The slide it holds now (rad: the player's way, by how far off its line). */
  private slideT = 0;
  /** Its throttle now (the line kept by it). */
  private gasT = 0.5;
  /** Aimed at a bend's exit (drift.aimSlide): the course rate it wants (rad/s)... */
  aimRate = 0;
  /** Drifting round a hairpin, kept to be drawn (record: on; the benches' trajectory dumps): its path turning on as it turns now, and, aiming, the arc it wants and the point it aims at (s, d; null: none this step). */
  aimPath: { pred: [number, number][]; need: [number, number][] | null; at: [number, number] | null } | null = null;
  record = false;
  /** Round a hairpin after the kick, what it sees (mountainDriftNet.ts; null: not there this step). */
  driftView: DriftView | null = null;
  private lastMiss = 0;
  private lastMissPin: HairpinRun | null = null;

  /** Its room either side of the centre line on a straight (m); roomAt: a bend's wider. */
  readonly room = MOUNTAIN.edge - MOUNTAIN_DRIVER.halfWidth - MOUNTAIN_DRIVER.margin;
  /** Its room either side of the centre line at s (m: the road wider in a bend, roadEdges' widen; not the shoulder). */
  roomAt(s: number): number {
    return this.road ? this.room + roadEdges(this.road).widen(s) : this.room;
  }

  /** Share of its car's grip and brakes its line is planned to (MOUNTAIN_DRIVER.budget). */
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
    const opts = { crest: MOUNTAIN_DRIVER.crest > 0, jerk: MOUNTAIN_DRIVER.jerk, tyreDrive: MOUNTAIN_DRIVER.tyreDrive > 0 };
    this.line = speedProfile(this.road, d, this.car, this.budgetNow, MOUNTAIN_DRIVER.vMax, undefined, opts);
    this.full = speedProfile(this.road, d, this.car, 1, MOUNTAIN_DRIVER.vMax, undefined, opts);
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
    const ext = this.external;
    const at = ext ? (x: number) => clamp(this.refOf(x, this.offset) + ext.offsetAt(x), x) : (x: number) => this.refOf(x, this.offset);
    const d = at(s);
    const d1 = at(s + h);
    const d0 = at(s - h);
    const kc = this.road!.curvature(s);
    return { d, psi: Math.atan2((d1 - d0) / (2 * h), 1 - kc * d), kappa: lineAt(line, s).kappa };
  }

  /** Its line at x plus `offset`, kept on the road, eased onto the next hairpin's drift entry coming to it (toPin). */
  private refOf(x: number, offset: number): number {
    const room = this.roomAt(x);
    const base = Math.max(-room, Math.min(room, lineAt(this.line!, x).d + offset));
    if (!this.toPin) return base;
    const u = Math.max(0, Math.min(1, 1 - (this.toPin.kickAt - x) / MOUNTAIN_DRIVER.drift.approach));
    const w = u * u * (3 - 2 * u);
    return base * (1 - w) + this.toPin.d * w;
  }

  /** The computed no-traffic path across the road at s (m): its line eased onto a drift's entry (as of its last step's toPin). */
  refAt(s: number): number {
    return this.line ? this.refOf(s, 0) : 0;
  }

  /**
   * The path a planner's offsets are taken from at s (m): refAt, but out of a drift still easing back to it from where
   * the drift left it (its offset, drift.merge a second) - alone, the path it drives as it always did.
   */
  pathRefAt(s: number): number {
    return this.line ? this.refOf(s, this.offset) : 0;
  }

  /** pathRefAt's curvature at s (1/m, + right): its line's, plus the bend of its easing. */
  refKappa(s: number): number {
    if (!this.line) return 0;
    const h = 2;
    const b = (x: number) => this.refOf(x, this.offset) - lineAt(this.line!, x).d;
    return lineAt(this.line, s).kappa + (b(s + h) - 2 * b(s) + b(s - h)) / (h * h);
  }

  /**
   * The speed it aims at at s going v (m/s): its line's a moment ahead (lead), no faster than it can brake down
   * from for the next hairpins (drifting round them: drift.latDrift round the bend's radius, plus what the kick takes).
   */
  refSpeed(s: number, v: number): number {
    const T = MOUNTAIN_DRIVER;
    return Math.min(this.speedAt(Math.max(0, s) + Math.max(T.leadMin, T.lead * v)), this.hairpinCap(s, v));
  }

  /** No faster at s going v than it can brake down from for the next hairpins (m/s; Infinity: none near). */
  private hairpinCap(s: number, v: number): number {
    const D = MOUNTAIN_DRIVER.drift;
    let target = Infinity;
    if (!this.road) return target;
    for (const h of this.hairpins) {
      if (h === this.done || h.to < s || h.from - s > 200) continue;
      // (drifting, it turns at about latDrift m/s² (measured, flat: 17-23): round the bend's radius as fast as that,
      // plus what the kick takes off)
      const k = Math.abs(this.road.curvature((h.from + h.to) / 2));
      const most = Math.sqrt(D.latDrift * Math.max(5, 1 / k)) + D.kickLoss;
      const toIt = Math.max(0, h.from - v * D.kickEarly - s); // (to where it kicks)
      target = Math.min(target, Math.sqrt(most * most + 2 * D.brake * toIt));
    }
    return target;
  }

  /** The next hairpin's kick point from s going v (s, m), or null: none left (its drift starts there). */
  kickAhead(s: number, v: number): number | null {
    const h = this.hairpins.find((x) => x !== this.done && x.to > s);
    return h ? h.from - v * MOUNTAIN_DRIVER.drift.kickEarly : null;
  }

  /** Not following its line: kicking, drifting, catching. */
  inDrift(): boolean {
    return this.mode !== 'line';
  }

  /** Just out of a drift: on its line its first drift.recover s after it (training's EXIT_GAIN walls). */
  outOfDrift(): boolean {
    return this.mode === 'line' && this.recover > 0;
  }

  reset(): void {
    this.offset = 0;
    this.kicked = null;
    this.kickLeft = 0;
    this.done = null;
    this.slid = false;
    this.recover = 0;
    this.mode = 'line';
    // (the rest of a drift as it was built: put back mid-drift, its next steered by the last bend's)
    this.pullLeft = 0;
    this.pullSince = 99;
    this.entryD = 0;
    this.entryPin = null;
    this.lastSteer = 0;
    this.courseA = 0;
  }

  dispose(): void {}

  /** Its wheel last step (for its turning rate: drift.steerRate a second at most - a hand's, not a flick). */
  private lastSteer = 0;
  /** Its course's turning (from its slide's change a step: noisy) smoothed over drift.arcLag s, for its forecast (rad/s). */
  private courseA = 0;

  drive(self: SelfState, others: TrafficBox[], p: CarParams = DEFAULT_CAR): DriveInput {
    const input = this.driveRaw(self, others, p);
    const r = MOUNTAIN_DRIVER.drift.steerRate;
    if (r > 0) {
      const step = r * PHYSICS_DT;
      input.steer = Math.max(this.lastSteer - step, Math.min(this.lastSteer + step, input.steer));
    }
    this.lastSteer = input.steer;
    this.lastLine = this.mode === 'line' ? input : null;
    return input;
  }

  private driveRaw(self: SelfState, others: TrafficBox[], p: CarParams = DEFAULT_CAR): DriveInput {
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
    // (a planner's offsets instead: MountainPlannerDriver)
    if (!this.external) for (const b of others) {
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
    // Coming to a hairpin it will drift round: onto its drift line first (in grip: from the outside's edge, drifting on a
    // circle as tight as the bend, it cut in across the road and could not stop).
    const D0 = T.drift;
    this.toPin = null;
    const next = this.hairpins.find((h) => h !== this.done && h.to > self.s && h.from - v * D0.kickEarly - self.s <= D0.approach);
    if (next && v >= D0.minSpeed) this.toPin = { kickAt: next.from - v * D0.kickEarly, d: -next.dir * D0.entryOut };
    // (out of a drift - this.recover: its path from where it came out back to its line slowly; a planner's offsets on
    // top of it - its own passing left out, `want` 0)
    this.offset += (want - this.offset) * Math.min(1, PHYSICS_DT * (this.recover > 0 && want === 0 ? T.drift.merge : T.passRate));

    // Round a hairpin, drifting (MOUNTAIN_DRIVER.drift) - which one, if any: one drift a hairpin (out of it, its slide
    // gone after it slid, done with it: drifting on, it drifted again).
    const D = T.drift;
    this.aimPath = null;
    const hadView = this.driftView !== null;
    this.driftView = null;
    const slideSigned = Math.atan2(self.vLat, Math.max(Math.abs(self.vLong), 1));
    const slide = Math.abs(slideSigned);
    let pin = v >= D.minSpeed ? this.hairpins.find((h) => h !== this.done && self.s >= h.from - v * D.kickEarly && self.s <= h.to) : undefined;
    // (its nose come round parallel to the straight out of the bend - past alignAfter of it, after it slid: done with
    // it, sliding on out - the player's way)
    if (pin && this.kicked === pin && this.kickLeft <= 0 && this.slid && self.s > pin.from + D.alignAfter * (pin.to - pin.from)) {
      const out = road.heading(pin.to + 15);
      const nose = road.heading(self.s) + self.yaw;
      if (pin.dir * Math.atan2(Math.sin(out - nose), Math.cos(out - nose)) <= D.alignAt) {
        this.done = pin;
        pin = undefined;
      }
    }
    if (pin && this.kicked === pin && this.kickLeft <= 0) {
      if (slide > D.slid) this.slid = true;
      // (the player's way: its slide let off mid-bend - too far in, the wheel straightened - is not the drift's end; only
      // in its last exitTurn rad: handed to settling mid-bend, no handbrake, it was thrown wide into the wall)
      else if (this.slid && slide < D.over && pin.to - self.s < D.exitTurn / Math.max(1e-3, Math.abs(road.curvature((pin.from + pin.to) / 2)))) {
        this.done = pin;
        pin = undefined;
      }
    }
    // Out of a drift: its path from where the car is, easing back to its line (the passing offset: handed straight back
    // to its line from the inside of the bend, it counter-steered on full lock and swung from wall to wall), and for a
    // while steered by where it is going, not where its nose points (still sliding).
    if (!pin && this.mode !== 'line') {
      const room = this.roomAt(self.s);

      this.offset = Math.max(-2 * room, Math.min(2 * room, self.d - lineAt(line, self.s).d));
      this.recover = D.recover;
    }
    this.recover = Math.max(0, this.recover - PHYSICS_DT);

    // Along the line (Stanley): its curvature a moment ahead steered for, its heading and its offset closed on.
    const look = Math.min(T.lookMax, T.lookBase + T.lookTime * v);
    const aimRoom = this.roomAt(self.s + look);
    const aim = this.external ? this.pathRefAt(self.s + look) + this.external.offsetAt(self.s + look) : lineAt(line, self.s + look).d + this.offset;
    this.aimD = Math.max(-aimRoom, Math.min(aimRoom, aim));
    const here = this.pathAt(self.s);
    const ahead = this.pathAt(self.s + T.steerLead * v);
    const err = self.d - here.d; // (+: right of where it should be)
    const heading = this.recover > 0 ? self.yaw + slideSigned : self.yaw; // (out of a drift: its course)
    const headingErr = here.psi - heading; // (+: the path heads more to the right than the car)
    const soft = T.offsetSoft + T.lowSoft * Math.max(0, 1 - v / D.minSpeed); // (softer at a standstill)
    const angle = Math.atan(p.wheelbase * ahead.kappa) + T.headingGain * headingErr - Math.atan((T.offsetGain * err) / (v + soft)) - D.lineYawDamp * (self.yawRate - v * here.kappa);
    // (out of a drift, the wheel gently: turned hard, the drift assist slid it again and it swung wall to wall)
    const most = D.recoverSteer + (1 - D.recoverSteer) * (1 - this.recover / D.recover); // (out of a drift: back to all of it gradually)
    const steer = Math.max(-most, Math.min(most, angle / steerRange(v, p)));
    // Slowed for a hairpin first, the handbrake pulled coming into it, the wheel turned in.
    target = Math.min(target, this.hairpinCap(self.s, v));
    // (a planner's cap: following a car it cannot get by, a tighter path than its line's)
    if (this.external) target = Math.min(target, this.external.vAt(self.s + Math.max(T.leadMin, T.lead * v)));
    const pedals = speedPedals(target, self.vLong, T.gasRamp, T.brakeRamp);
    if (pin) {
      if (this.kicked !== pin) {
        this.kicked = pin;
        this.kickLeft = D.kickTime;
        this.slid = false;
      }
      // (held on past kickTime till it slides kickSlide rad into the bend, kickMax s at most: a grippier car needs longer)
      const handbrake = this.kickLeft > 0 || (this.mode === 'kick' && -pin.dir * slideSigned < D.kickSlide && this.kickLeft > D.kickTime - D.kickMax);
      this.kickLeft -= PHYSICS_DT;
      if (handbrake) this.sinceKick = 0;
      else this.sinceKick += PHYSICS_DT;
      if (handbrake) {
        this.mode = 'kick';
        this.lastSlide = slideSigned;
        return { ...pedals, steer: pin.dir * D.kickSteer, handbrake };
      }
      if (slide > D.catchAt) {
        this.mode = 'catch'; // (sliding too far: caught)
        return { ...pedals, steer };
      }
      // (its sideways speed across the road: along its heading off the road's, and its slide)
      const vd = self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw);
      const kap = road.curvature(self.s);
      // (its line: from where it began - outside, by entryOut - eased in to the middle over the bend's first mergeFrac;
      // come in on the inside, round wide first: tightened at once, it cut in, counter-steered, came out wide)
      if (this.entryPin !== pin) {
        this.entryPin = pin;
        this.entryD = self.d;
      }
      const targetAt = (x: number) => {
        const u = Math.max(0, Math.min(1, (x - pin.from) / (D.mergeFrac * (pin.to - pin.from))));
        let d = this.entryD - this.entryD * u * u * (3 - 2 * u);
        // (into its last exitInFrac: a little in - the room it slides out over, its nose held down the straight)
        const len = D.exitInFrac * (pin.to - pin.from);
        const w = Math.max(0, Math.min(1, (x - (pin.to - len)) / len));
        d += pin.dir * D.exitIn * w * w * (3 - 2 * w);
        return d;
      };
      const along = self.vLong * Math.cos(self.yaw) - self.vLat * Math.sin(self.yaw);
      const course = self.yawRate + (kap * along) / Math.max(0.2, 1 - kap * self.d) + (slideSigned - this.lastSlide) / PHYSICS_DT;
      this.lastSlide = slideSigned;
      this.courseA = D.arcLag > 0 && this.mode !== 'kick' ? this.courseA + (course - this.courseA) * Math.min(1, PHYSICS_DT / D.arcLag) : course;
      // (about to hit the inside wall: dangerLook s on within panic m of its room's edge)
      const danger = pin.dir * (self.d + vd * D.dangerLook) > this.roomAt(self.s) - D.panic;
      // The player's way: the wheel holds a slide (slideT rad: its spring's rest angle is springLimit x wheel²), the line
      // kept by the throttle, by the handbrake (thrown wide: pulled a moment, the nose round, slower) and by the wheel let
      // off (too far in: wheel innerSteer - less slide, less push, out it drifts).
      // Where it will be `time` s on (d, and how far off its line then: + wide of it): on an arc - its course turning as
      // it turns now, round the road's bend (a straight line from its sideways speed: drifting, it curves - moving in
      // fast at the kick, the line said it would hit the inside wall, it straightened and lost the slide)
      const along0 = Math.max(1, self.vLong * Math.cos(self.yaw) - self.vLat * Math.sin(self.yaw));
      const forecast = (time: number): { d: number; off: number } => {
        const sp = Math.hypot(along0, vd);
        let psi = Math.atan2(vd, along0);
        let d = self.d;
        let x = self.s;
        const n = Math.max(1, Math.round(time / 0.05));
        const h = time / n;
        for (let i = 0; i < n; i++) {
          const k = road.curvature(x);
          const f = Math.max(0.2, 1 - k * d);
          d += sp * Math.sin(psi) * h;
          x += (sp * Math.cos(psi) * h) / f;
          psi += (this.courseA - (sp * Math.cos(psi) * k) / f) * h;
        }
        return { d, off: pin.dir * (targetAt(x) - d) };
      };
      // Aimed at the bend's exit (the car's own aimSlide, DriftAssist.ai; 0: not): the course rate (rad/s) that, held,
      // brings it to the middle by the bend's end (aimMinT s on at least) - the slide it holds aimSlide rad more a rad/s
      // it turns short of that (the wheel in: it turns more), the handbrake aimPull rad/s short.
      // (Tried: the throttle on it instead - the arcade drift's throttle turns it more - slid less, as many walls: off
      // the throttle the slide went; on full throttle short still, the muscle car thrown wide at 45 walls of 10 roads)
      const aimSlide = p.drift?.ai?.aimSlide ?? D.aimSlide;
      let aimShort = 0;
      const sAim = Math.max(pin.to, self.s + v * D.aimMinT);
      const dAim = 0; // (the middle)
      const sp = Math.hypot(along0, vd);
      // (where it ends up across the road by sAim, turning steadily at omega; its arc into `path` every 0.1 s)
      const endAt = (omega: number, path?: [number, number][]): number => {
        let psi = Math.atan2(vd, along0);
        let d = self.d;
        let x = self.s;
        for (let i = 0; i < 80 && x < sAim && Math.cos(psi) > 0.05; i++) {
          const k = road.curvature(x);
          const f = Math.max(0.2, 1 - k * d);
          d += sp * Math.sin(psi) * 0.05;
          x += (sp * Math.cos(psi) * 0.05) / f;
          psi += (omega - (sp * Math.cos(psi) * k) / f) * 0.05;
          if (path && i % 2) path.push([x, d]);
        }
        path?.push([x, d]);
        return d;
      };
      if (aimSlide > 0) {
        let lo = this.courseA - 4;
        let hi = this.courseA + 4;
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2;
          if (endAt(mid) < dAim) lo = mid;
          else hi = mid;
        }
        this.aimRate = (lo + hi) / 2;
        aimShort = pin.dir * (this.aimRate - this.courseA); // (+: turning too little)
      }
      // Where it is going, the driver's way: turning on as it turns now (omega, rad/s) till it heads down the straight
      // out of the bend, then straight on - where it is across the road by sAim (its path into `path` every 0.1 s).
      // (Turning on to the bend's end, it went round and round: inside of its point all through the drift.)
      const hOut = road.heading(pin.to + 15);
      const goTo = (omega: number, path?: [number, number][]): number => {
        let course = road.heading(self.s) + Math.atan2(vd, along0);
        let d = self.d;
        let x = self.s;
        for (let i = 0; i < 120 && x < sAim; i++) {
          const left = pin.dir * Math.atan2(Math.sin(hOut - course), Math.cos(hOut - course)); // (to turn yet)
          if (left > 0) course += pin.dir * Math.min(left, pin.dir * omega * 0.05);
          const psi = Math.atan2(Math.sin(course - road.heading(x)), Math.cos(course - road.heading(x)));
          if (Math.cos(psi) <= 0.05) break;
          const f = Math.max(0.2, 1 - road.curvature(x) * d);
          d += sp * Math.sin(psi) * 0.05;
          x += (sp * Math.cos(psi) * 0.05) / f;
          if (path && i % 2) path.push([x, d]);
        }
        path?.push([x, d]);
        return d;
      };
      // What it sees, for its drift network (mountainDriftNet.ts): where it is going (goTo) by the bend's exit, how far
      // wide (m; -: inside) of a point viewExitD m in from the middle - it slides out from there to the middle on the
      // straight. (Tried: the wheel, the throttle and the handbrake on that miss by rule - as many walls, 3-4° less
      // slide: the arcade drift's slide is its throttle's, the throttle kept the line at its cost.)
      const missV = pin.dir * (pin.dir * D.viewExitD - goTo(this.courseA));
      const missRate = hadView && this.lastMissPin === pin ? (missV - this.lastMiss) / PHYSICS_DT : 0;
      this.lastMiss = missV;
      this.lastMissPin = pin;
      const roomNow = this.roomAt(self.s);
      this.driftView = { dir: pin.dir, miss: missV, missRate, roomIn: roomNow - pin.dir * self.d, roomOut: roomNow + pin.dir * self.d, slide: -pin.dir * slideSigned, yawRate: pin.dir * self.yawRate, vIn: pin.dir * vd, v, through: (self.s - pin.from) / Math.max(1, pin.to - pin.from), kappa: Math.abs(road.curvature((pin.from + pin.to) / 2)), sinceKick: this.sinceKick };
      if (this.record) {
        // (to be drawn: where it is going; and, aiming, the arc it wants and its point)
        const pred: [number, number][] = [[self.s, self.d]];
        goTo(this.courseA, pred);
        let need: [number, number][] | null = null;
        if (aimSlide > 0) endAt(this.aimRate, (need = [[self.s, self.d]]));
        this.aimPath = { pred, need, at: aimSlide > 0 ? [sAim, dAim] : null };
      }
      const inSlide = -pin.dir * slideSigned;
      // (a big slide, all but steady - by how far off its line it will be errLook s on: wide of it more, the push turning
      // it in; the line kept by the throttle)
      const err = forecast(D.errLook).off;
      this.slideT = Math.max(D.bigSlideMin, Math.min(D.bigSlideMax, D.bigSlide + D.bigSlideErr * err));
      this.gasT = Math.max(D.gasLow, Math.min(1, p.drift?.ai?.gas ?? D.gasMid));
      if (aimSlide > 0) this.slideT = Math.max(D.bigSlideMin, Math.min(D.bigSlideMax, D.bigSlide + aimSlide * aimShort));
      // (tried for the muscle car on more throttle, running wide in the bend's second half: off the throttle there
      // (0.2 over its last half) - fewer walls, little more slide (28°); more throttle wide of its line - worse. Its
      // own handbrake (DriftAssist.ai: pulled sooner, longer) caught it)
      const hold = Math.sqrt(this.slideT / D.springLimit) + D.slideGain * (this.slideT - inSlide);
      const inRoom = this.roomAt(self.s) - pin.dir * forecast(D.innerLook).d;
      // (too far in: after the kick only, the kick moves it in)
      const easing = this.sinceKick > D.pullAfter && inRoom < D.innerRoom;
      // (about to hit the inside wall - danger - the wheel and the throttle as ever: tried on the arcade drift, the wheel
      // straightened there hit the wall more (the jdm 1 -> 19 of 54 flat hairpins); off it only at danger worse)
      // (too far in: the wheel innerSteer, and off the throttle to innerGas (the arcade drift's throttle pushes it in):
      // solo on 30 roads walls 25 / 15 / 13 -> 9 / 12 / 6, 1-2 s slower, 2-4° less slide - the supercar's and the jdm's
      // own throttle up to 1 for it. Judged once on races (0.15: 29 -> 36 walls), unrepeatable)
      const c = { steer: pin.dir * (easing ? D.innerSteer : Math.max(D.steerLeast, Math.min(D.steerMost, hold))), throttle: easing ? Math.min(this.gasT, D.innerGas) : this.gasT };
      // Its last exitTurn rad of the bend: the wheel eased straight (the spring straightens the slide) before it is handed
      // back to its line.
      const rampLen = D.exitTurn / Math.max(1e-3, Math.abs(road.curvature((pin.from + pin.to) / 2)));
      const rem = pin.to - self.s;
      const exiting = rem < rampLen;
      // About to be thrown wide - pullLook s on within pullRoom m of the outside's edge, or about to cross its line
      // outward (pullErr m past it: pulled before, not after), or (aiming) turning aimPull rad/s short: a little more
      // handbrake - the rear lets go, the nose comes round, and it slows (the player's: pull it again).
      const pullAhead = forecast(p.drift?.ai?.pullLook ?? D.pullLook); // (the car's own: DriftAssist.ai)
      const outRoom = this.roomAt(self.s) + pin.dir * pullAhead.d;
      const wideSoon = (aimSlide > 0 && aimShort > D.aimPull) || outRoom < D.pullRoom || pullAhead.off > D.pullErr;
      // (a short pull, a gap after it - held on, it slowed to a crawl and spun round past its line - and not past pullMost of slide)
      if (!danger && wideSoon && this.pullLeft <= 0 && this.pullSince >= D.pullGap && slide < D.pullMost) this.pullLeft = p.drift?.ai?.hbPulse ?? D.hbPulse;
      if (this.pullLeft > 0) this.pullSince = 0;
      else this.pullSince += PHYSICS_DT;
      const pull = this.pullLeft > 0;
      this.pullLeft = Math.max(0, this.pullLeft - PHYSICS_DT);
      if (exiting) {
        this.mode = pull ? 'pull' : 'exit';
        return { throttle: c.throttle, brake: 0, steer: c.steer * Math.max(0, rem / rampLen), handbrake: pull };
      }
      this.mode = danger ? 'danger' : pull ? 'pull' : easing ? 'ease' : 'drift';
      return { throttle: c.throttle, brake: 0, steer: c.steer, handbrake: pull };
    }
    this.mode = 'line';
    // (sliding, the throttle eased: on full throttle the drift assist's rear let go and swung it)
    // (not at a standstill: turning at a crawl its body moves sideways of its heading - not a slide - and the cut left it
    // creeping round on full lock at the start)
    const gasMost = v < D.minSpeed ? 1 : Math.max(D.gasSlideLeast, 1 - ((1 - D.gasSlideLeast) * Math.max(0, slide - D.gasSlideFrom)) / D.gasSlideSpan);
    return { ...pedals, throttle: Math.min(pedals.throttle, gasMost), steer };
  }
}
