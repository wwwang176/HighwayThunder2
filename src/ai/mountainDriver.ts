import { PHYSICS_DT } from '../config';
import type { Centerline } from '../road/centerline';
import { MOUNTAIN, roadEdges } from '../road/mountain';
import { type CarParams, DEFAULT_CAR, type HandlingInput, steerRange } from '../vehicles/handling';
import { type RivalDriver, speedPedals } from './driver';
import { type LineCar, lineAt, type RaceLine, racingLine, speedProfile } from './mountainLine';
import type { SelfState, TrafficBox } from './sensors';
import type { DriftView } from './mountainDriftNet';

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
   * Full throttle this far (m/s) under the speed it aims at (speedPedals). (The highway's 3: its aim the line's speed a
   * moment ahead - the line itself as fast as the engine speeds it up - it ran ~3 m/s under its line down every straight,
   * on part throttle out of every bend.)
   */
  gasRamp: 1,
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
    panic: 0.6,
    posGain: 1.5,
    velGain: 3,
    ffSteer: 0.7,
    ffSlope: 0.05,
    ffLeast: 0.4,
    ffGas: 0.6,
    steerGain: 1,
    gasGain: 1,
    steerLeast: 0.2,
    steerMost: 1,
    approach: 60,
    exitTurn: 0.01,
    gasLeast: 0.3,
    dangerLook: 0.4,
    slid: 0.17,
    over: 0.09,
    recover: 1.5,
    merge: 0.5,
    recoverSteer: 0.5,
    exitEarly: 0,
    minSpeed: 30 / 3.6,
    catchAt: 0.75,
    latDrift: 22,
    speedGain: 0,
    overSpeed: 99,
    speedLine: 0,
    holdGas: 0.5,
    speedLook: 0.5,
    kickLoss: 2.5,
    // (its braking down to a hairpin's speed, m/s² - into it as fast either way, only later: at 5, ~0.5 g, it was off
    // the throttle 100-200 m out)
    brake: 7.5,
    brakeGain: 0.3,
    wide: 1.5,
    lineShare: 0,
    settleSlide: 0.1,
    // (out of the drift on full throttle - and alignGas: the driving network takes it down as it needs to, its own
    // throttle and brake as the highway's. The driver alone on it hit the walls 3-12 times as often; at 0.3/0.4, the
    // first part of every straight was crawled.)
    settleGas: 1,
    settleSteer: 0.5,
    settleHead: 2,
    settleRate: 0.5,
    approachBlend: 1,
    settleYaw: 0.15,
    lineYawDamp: 0.1,
    buildSteer: 0,
    steerRate: 5,
    satGas: 0,
    kickSlide: 0,
    hbOn: 0,
    hbPulse: 0.1,
    hbExit: 2,
    pullLook: 0.6,
    pullRoom: 2.5,
    pullSlide: 0,
    pullGap: 0.2,
    pullMost: 0.9,
    userCtl: 3,
    /**
     * userCtl 3 (the player's: a big slide - the AI's slid little, just enough; out of it the player's way): the wheel
     * holds `bigSlide` rad (35°) of slide, `bigSlideErr` more a metre wide of its line (within bigSlideMin..bigSlideMax);
     * the throttle steady at `gasMid` (`gasErr` more a metre wide - 0: on it the throttle fell as it went in, it slowed,
     * its radius ~ v² / 20 tightened, and it crawled round its bend), never under `gasLow`; no pull for a slide short of
     * its big one (pullAngle 0: pulled and pulled, it slowed to a crawl). Into
     * the bend's last `exitInFrac` its line eased `exitIn` m in; past `alignAfter` of the bend, its nose come round
     * parallel to the straight out of it (within `alignAt` rad): counter-steered to hold it so (`alignHead` a rad off,
     * `alignRate` against its turning, at most `alignSteer`), `alignGas` throttle - sliding on out to the middle.
     */
    bigSlide: 0.6,
    bigSlideErr: 0.1,
    bigSlideMin: 0.3,
    bigSlideMax: 0.7,
    gasMid: 0.75,
    gasErr: 0,
    gasLow: 0.1,
    exitIn: 1.2,
    exitInFrac: 0.3,
    alignAfter: 0.4,
    alignAt: 0.03,
    alignHead: 2,
    alignRate: 0.4,
    alignSteer: 1,
    alignGas: 1, // (settleGas)
    slideTarget: 0.45,
    slideGain: 1.5,
    springLimit: Math.PI / 4,
    innerRoom: 1,
    innerSteer: -0.3,
    innerLook: 1.2,
    innerGas: 0.2,
    aimSlide: 0,
    aimPull: 0.5,
    aimMinT: 0.6,
    exitD: 0,
    viewExitD: 2,
    pullAngle: 0,
    pullAfter: 0.4,
    tightOn: 0,
    entryOut: 1.5,
    mergeFrac: 0.5,
    slideErrGain: 0.1,
    errLook: 0.8,
    slideMin: 0.25,
    pullErr: 0.3,
    pullLong: 0,
    arc: 1,
    arcLag: 0.15,
    exitTaper: 0,
    pullLow: 0.1,
    slideMax: 0.55,
    kickMax: 0.6,
    courseLag: 0,
    settleOff: 0,
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
 * In a drift: how fast its course should turn (rad/s, + right) - round its line at `dTarget` (m across) as the road
 * bends there (`kappa`, 1/m, + right: tighter on its inside), and toward that line from `d`, damped by how fast it
 * moves across (`vd`, m/s): `posGain` (1/s²) a metre off, `velGain` (1/s) a m/s, over its speed `v`.
 */
export function driftTurnWant(kappa: number, dTarget: number, d: number, v: number, vd: number, W: { posGain: number; velGain: number }): number {
  const along = (v * kappa) / (1 - kappa * dTarget);
  return along + (W.posGain * (dTarget - d) - W.velGain * vd) / Math.max(v, 5);
}

/**
 * In a drift round a bend turning `dir` (+1 right): the wheel and the throttle on `u`, how much faster its course should
 * turn (rad/s, + right: driftTurnWant less its course's turning) - both turn it harder (the wheel: more slide and the
 * front tyres; the throttle: the push toward the nose - measured open loop, flat: a 0.6 / 0.8 / 1.0 wheel held a 17 /
 * 26 / 37° slide on 0.5-1 throttle, off it the slide died and it turned in tight as it slowed), about `ffSteer` and
 * `ffGas`, `steerGain` and `gasGain` a rad/s, never under `steerLeast` and `gasLeast` (the drift kept alive).
 */
export function driftTurn(
  dir: 1 | -1,
  u: number,
  H: { ffSteer: number; ffGas: number; steerGain: number; gasGain: number; steerLeast: number; steerMost: number; gasLeast: number },
): { steer: number; throttle: number } {
  const more = dir * u;
  return {
    steer: dir * Math.max(H.steerLeast, Math.min(H.steerMost, H.ffSteer + H.steerGain * more)),
    throttle: Math.max(H.gasLeast, Math.min(1, H.ffGas + H.gasGain * more)),
  };
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
  lastLine: HandlingInput | null = null;
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
  /** Out of a drift and still settling it (the slide not yet under drift.settleSlide). */
  private settling = false;
  /** The next hairpin's kick point (s, m) and its drift line (d, m): its path eased onto that line coming to it. */
  private toPin: { kickAt: number; d: number } | null = null;
  /** What it did last (for tracing): following its line, the handbrake's kick, drifting, catching a slide, the inside wall near. */
  mode: 'line' | 'kick' | 'drift' | 'catch' | 'danger' | 'exit' | 'settle' | 'pull' | 'ease' = 'line';
  /** How long more it holds the handbrake mid-drift (s): turning too little, about to be thrown wide. */
  private pullLeft = 0;
  /** Since its last pull ended (s). */
  private pullSince = 99;
  /** How long it has held this pull (s). */
  private pullHeld = 0;
  /** Since the kick ended (s). */
  private sinceKick = 0;
  /** Where across it began drifting round `entryPin` (m): its line eased from there to the middle (wide round first). */
  private entryD = 0;
  private entryPin: HairpinRun | null = null;
  /** The slide it holds now (rad: the player's way, by how far off its line). */
  private slideT = 0;
  /** userCtl 3: its throttle now (the line kept by it), and the heading out of the bend it holds its nose to (rad; null: none). */
  private gasT = 0.5;
  private alignTo: number | null = null;
  /** Aimed at a bend's exit (drift.aimSlide): the course rate it wants (rad/s)... */
  aimRate = 0;
  /** Drifting round a hairpin, kept to be drawn (record: on; the benches' trajectory dumps): its path turning on as it turns now, and, aiming, the arc it wants and the point it aims at (s, d; null: none this step). */
  aimPath: { pred: [number, number][]; need: [number, number][] | null; at: [number, number] | null } | null = null;
  record = false;
  /** Round a hairpin after the kick, what it sees (mountainDriftNet.ts; null: not there this step). */
  driftView: DriftView | null = null;
  private lastMiss = 0;
  private lastMissPin: HairpinRun | null = null;

  /** A hairpin's drift line (d, m): between its inside's edge (kept drift.wide off it) and the middle. */
  private driftLineOf(h: HairpinRun): number {
    const at = (h.from + h.to) / 2;
    return h.dir * Math.max(0, this.roomAt(at) - MOUNTAIN_DRIVER.drift.wide) * MOUNTAIN_DRIVER.drift.lineShare;
  }
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
      if (h === this.done || h.to - D.exitEarly < s || h.from - s > 200) continue;
      // (drifting, it turns at about latDrift m/s² (measured, flat: 17-23): its radius round its line - between the
      // inside and the middle - as fast as that, plus what the kick takes off)
      const k = Math.abs(this.road.curvature((h.from + h.to) / 2));
      const most = Math.sqrt(D.latDrift * Math.max(5, 1 / k - Math.max(0, this.roomAt((h.from + h.to) / 2) - D.wide) * D.lineShare)) + D.kickLoss;
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

  /** Not following its line: kicking, drifting, catching, settling out of a drift. */
  inDrift(): boolean {
    return this.mode !== 'line';
  }

  reset(): void {
    this.offset = 0;
    this.kicked = null;
    this.kickLeft = 0;
    this.done = null;
    this.slid = false;
    this.recover = 0;
    this.mode = 'line';
  }

  dispose(): void {}

  /** Its wheel last step (for its turning rate: drift.steerRate a second at most - a hand's, not a flick). */
  private lastSteer = 0;
  /** Its course's turning, smoothed over drift.courseLag s (from its slide's change a step: noisy). */
  private courseF = 0;
  /** Its course's turning smoothed over drift.arcLag s, for its forecast (rad/s). */
  private courseA = 0;

  drive(self: SelfState, others: TrafficBox[], p: CarParams = DEFAULT_CAR): HandlingInput {
    const input = this.driveRaw(self, others, p);
    const r = MOUNTAIN_DRIVER.drift.steerRate;
    if (r > 0) {
      const step = r * PHYSICS_DT;
      input.steer = Math.max(this.lastSteer - step, Math.min(this.lastSteer + step, input.steer));
    }
    this.lastSteer = input.steer;
    this.lastLine = this.mode === 'line' || this.mode === 'settle' ? input : null;
    return input;
  }

  private driveRaw(self: SelfState, others: TrafficBox[], p: CarParams = DEFAULT_CAR): HandlingInput {
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
    if (D0.approachBlend) {
      const next = this.hairpins.find((h) => h !== this.done && h.to > self.s && h.from - v * D0.kickEarly - self.s <= D0.approach);
      if (next && v >= D0.minSpeed) this.toPin = { kickAt: next.from - v * D0.kickEarly, d: this.driftLineOf(next) - next.dir * D0.entryOut };
    } else if (want === 0 && v >= D0.minSpeed && !this.external) {
      const next = this.hairpins.find((h) => h !== this.done && h.from - v * D0.kickEarly - self.s >= 0 && h.from - v * D0.kickEarly - self.s <= D0.approach);
      if (next) want = this.driftLineOf(next) - lineAt(line, self.s).d;
    }
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
    let pin = v >= D.minSpeed ? this.hairpins.find((h) => h !== this.done && self.s >= h.from - v * D.kickEarly && self.s <= h.to - D.exitEarly) : undefined;
    // (userCtl 3: its nose come round parallel to the straight out of the bend - past alignAfter of it, after it slid:
    // done with it, counter-steered to hold its nose so, sliding on out - the player's way)
    if (pin && D.userCtl >= 3 && this.kicked === pin && this.kickLeft <= 0 && this.slid && self.s > pin.from + D.alignAfter * (pin.to - pin.from)) {
      const out = road.heading(pin.to + 15);
      const nose = road.heading(self.s) + self.yaw;
      if (pin.dir * Math.atan2(Math.sin(out - nose), Math.cos(out - nose)) <= D.alignAt) {
        this.done = pin;
        this.alignTo = out;
        pin = undefined;
      }
    }
    if (pin && this.kicked === pin && this.kickLeft <= 0) {
      if (slide > D.slid) this.slid = true;
      // (the player's way: its slide let off mid-bend - too far in, the wheel straightened - is not the drift's end; only
      // in its last exitTurn rad: handed to settling mid-bend, no handbrake, it was thrown wide into the wall)
      else if (this.slid && slide < D.over && (!D.userCtl || pin.to - self.s < D.exitTurn / Math.max(1e-3, Math.abs(road.curvature((pin.from + pin.to) / 2))))) {
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
      if (this.mode !== 'settle') this.settling = true;
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
    const pedals = speedPedals(target, self.vLong, T.gasRamp);
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
      // Its line: between the inside's edge (kept `wide` off it) and the middle - its course turned as that line wants
      // (driftTurnWant), the wheel and the throttle on how far off that it turns (driftTurn).
      const kap = road.curvature(self.s);
      // (its line: from where it began - outside, by entryOut - eased in to the middle over the bend's first mergeFrac;
      // come in on the inside, round wide first: tightened at once, it cut in, counter-steered, came out wide)
      if (this.entryPin !== pin) {
        this.entryPin = pin;
        this.entryD = self.d;
      }
      const lineOfPin = this.driftLineOf(pin);
      const targetAt = (x: number) => {
        if (!(D.mergeFrac > 0 && D.userCtl >= 2)) return lineOfPin;
        const u = Math.max(0, Math.min(1, (x - pin.from) / (D.mergeFrac * (pin.to - pin.from))));
        let d = this.entryD + (lineOfPin - this.entryD) * u * u * (3 - 2 * u);
        if (D.userCtl >= 3) {
          // (into its last exitInFrac: a little in - the room it slides out over, its nose held down the straight)
          const len = D.exitInFrac * (pin.to - pin.from);
          const w = Math.max(0, Math.min(1, (x - (pin.to - len)) / len));
          d += pin.dir * D.exitIn * w * w * (3 - 2 * w);
        }
        return d;
      };
      const dTarget = targetAt(self.s);
      const want = driftTurnWant(kap, dTarget, self.d, v, vd, D);
      const along = self.vLong * Math.cos(self.yaw) - self.vLat * Math.sin(self.yaw);
      const course = self.yawRate + (kap * along) / Math.max(0.2, 1 - kap * self.d) + (slideSigned - this.lastSlide) / PHYSICS_DT;
      this.lastSlide = slideSigned;
      this.courseF = D.courseLag > 0 && this.mode === 'drift' ? this.courseF + (course - this.courseF) * Math.min(1, PHYSICS_DT / D.courseLag) : course;
      this.courseA = D.arcLag > 0 && this.mode !== 'kick' ? this.courseA + (course - this.courseA) * Math.min(1, PHYSICS_DT / D.arcLag) : course;
      // (about to hit the inside wall: dangerLook s on within panic m of its room's edge)
      const danger = pin.dir * (self.d + vd * D.dangerLook) > this.roomAt(self.s) - D.panic;
      // (its slide by the bend's radius: past 15° the push toward the nose is all there, the turning ~2 g - a wide bend
      // wants a small slide, the push less, or it cut in)
      const pinR = Math.abs(1 / road.curvature((pin.from + pin.to) / 2));
      const ff = Math.max(D.ffLeast, Math.min(D.ffSteer, D.ffSteer - D.ffSlope * (pinR - 15)));
      const turn = danger ? { steer: pin.dir * D.steerLeast, throttle: D.gasLeast } : driftTurn(pin.dir, want - this.courseF, { ...D, ffSteer: ff });
      // The throttle and the brake on its speed alone: as fast as its line's radius wants (latDrift m/s², the bend's bank
      // in it: the throttle both speeds it up and pushes it round - on the turning, it braked, slowed and turned in tight)
      // (and on where it is: in from its line or moving in - turning too tight - faster, its radius wider; out, slower)
      const inward = pin.dir * (self.d - dTarget) + D.speedLook * pin.dir * vd;
      const vStar = Math.sqrt(D.latDrift * Math.max(5, Math.abs(1 / road.curvature((pin.from + pin.to) / 2)) - pin.dir * dTarget)) * Math.max(0.8, Math.min(1.25, 1 + D.speedLine * inward));
      const gasIt = Math.max(D.gasLeast, Math.min(1, D.ffGas + D.speedGain * (vStar - v)));
      const brakeIt = v > vStar + D.overSpeed ? Math.min(1, D.brakeGain * (v - vStar - D.overSpeed)) : 0;
      // (till the slide is built: the wheel kept in at least its feed-forward - turning enough on grip, the feedback let
      // the wheel off, and the slide came late, at the bend's end, and ran it wide)
      if (D.buildSteer && !this.slid && !danger) turn.steer = pin.dir * Math.max(Math.abs(turn.steer), ff * D.buildSteer);
      // (the wheel all the way in and still not turning enough: too fast for this car's drift - off the throttle by how
      // much more it wants, slowing it, its radius tighter; a heavier, stronger car drifts wider at the same throttle)
      const excess = Math.max(0, ff + D.steerGain * pin.dir * (want - this.courseF) - D.steerMost);
      const gasNow = Math.max(0, D.holdGas - D.satGas * excess);
      // The player's way (userCtl): the wheel holds a slide (slideTarget rad: its spring's rest angle is
      // springLimit x wheel²), the line kept by the handbrake (thrown wide: pulled a moment, the nose round, slower) and by
      // the wheel let off (too far in: wheel innerSteer - less slide, less push, out it drifts).
      // Where it will be `time` s on (d, and how far off its line then: + wide of it): on an arc (D.arc) - its course
      // turning as it turns now, round the road's bend (a straight line from its sideways speed: drifting, it curves -
      // moving in fast at the kick, the line said it would hit the inside wall, it straightened and lost the slide)
      const along0 = Math.max(1, self.vLong * Math.cos(self.yaw) - self.vLat * Math.sin(self.yaw));
      const forecast = (time: number): { d: number; off: number } => {
        if (!D.arc) {
          const d = self.d + vd * time;
          return { d, off: pin.dir * (targetAt(self.s) - d) };
        }
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
      // brings it to the middle (exitD m in) by the bend's end (aimMinT s on at least) - the slide it holds aimSlide rad
      // more a rad/s it turns short of that (the wheel in: it turns more), the handbrake aimPull rad/s short.
      // (Tried: the throttle on it instead - the arcade drift's throttle turns it more - slid less, as many walls: off
      // the throttle the slide went; on full throttle short still, the muscle car thrown wide at 45 walls of 10 roads)
      const aimSlide = p.drift?.ai?.aimSlide ?? D.aimSlide;
      let aimShort = 0;
      const sAim = Math.max(pin.to, self.s + v * D.aimMinT);
      const dAim = pin.dir * D.exitD;
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
      let easing = false;
      if (D.userCtl) {
        const inSlide = -pin.dir * slideSigned;
        // (the slide by how far off its line it will be errLook s on: wide of it more - the push, the turning - in, less)
        const err = forecast(D.errLook).off;
        // (exitTaper: its last exitTurn rad, the slide it holds eased down to none - the line still kept, the handbrake
        // still there; not the wheel let off blind)
        const exitLen = D.exitTurn / Math.max(1e-3, Math.abs(road.curvature((pin.from + pin.to) / 2)));
        const share = D.exitTaper ? Math.max(0, Math.min(1, (pin.to - self.s) / exitLen)) : 1;
        this.slideT = D.slideErrGain > 0 ? Math.max(D.slideMin * share, Math.min(D.slideMax, D.slideTarget * share + D.slideErrGain * err)) : D.slideTarget * share;
        if (D.userCtl >= 3) {
          // (a big slide, all but steady; the line kept by the throttle - wide of it more, the push turning it in)
          this.slideT = Math.max(D.bigSlideMin, Math.min(D.bigSlideMax, D.bigSlide + D.bigSlideErr * err));
          this.gasT = Math.max(D.gasLow, Math.min(1, (p.drift?.ai?.gas ?? D.gasMid) + D.gasErr * err));
          if (aimSlide > 0) this.slideT = Math.max(D.bigSlideMin, Math.min(D.bigSlideMax, D.bigSlide + aimSlide * aimShort));
          // (tried for the muscle car on more throttle, running wide in the bend's second half: off the throttle there
          // (0.2 over its last half) - fewer walls, little more slide (28°); more throttle wide of its line - worse. Its
          // own handbrake (DriftAssist.ai: pulled sooner, longer) caught it)
        }
        const hold = Math.sqrt(this.slideT / D.springLimit) + D.slideGain * (this.slideT - inSlide);
        const inRoom = this.roomAt(self.s) - pin.dir * forecast(D.innerLook).d;
        // (too far in, or turning too fast for its line - spun round past it: after the kick only, the kick moves it in)
        const tight = this.sinceKick > D.pullAfter && (inRoom < D.innerRoom || (D.tightOn > 0 && pin.dir * (want - this.courseF) < -D.tightOn));
        easing = tight;
        // (about to hit the inside wall - danger - the wheel and the throttle as ever: tried on the arcade drift, the wheel
        // straightened there hit the wall more (the jdm 1 -> 19 of 54 flat hairpins); off it only at danger worse)
        // (too far in - tight: the wheel innerSteer, and off the throttle to innerGas (the arcade drift's throttle
        // pushes it in): solo on 30 roads walls 25 / 15 / 13 -> 9 / 12 / 6, 1-2 s slower, 2-4° less slide - the
        // supercar's and the jdm's own throttle up to 1 for it. Judged once on races (0.15: 29 -> 36 walls), unrepeatable)
        turn.steer = pin.dir * (tight ? D.innerSteer : Math.max(D.steerLeast, Math.min(D.steerMost, hold)));
      }
      const c = { steer: turn.steer, throttle: D.userCtl >= 3 ? (easing && D.innerGas >= 0 ? Math.min(this.gasT, D.innerGas) : this.gasT) :D.holdGas >= 0 ? (brakeIt > 0 ? 0 : gasNow) : brakeIt > 0 ? 0 : gasIt };
      // Its last exitTurn rad of the bend: the wheel eased straight (the spring straightens the slide) before it is handed
      // back to its line.
      const rampLen = D.exitTurn / Math.max(1e-3, Math.abs(road.curvature((pin.from + pin.to) / 2)));
      const rem = pin.to - self.s;
      // Turning too little (about to be thrown wide: its course turning hbOn rad/s short of what its line wants):
      // a little more handbrake - the rear lets go, the nose comes round, and it slows (the player's: pull it again).
      const short = pin.dir * (want - this.courseF);
      const exiting = rem < rampLen;
      // (thrown wide: pullLook s on within pullRoom m of the outside's edge; or its slide still under pullSlide and
      // turning too little)
      const pullAhead = forecast(p.drift?.ai?.pullLook ?? D.pullLook); // (the car's own: DriftAssist.ai)
      const outRoom = this.roomAt(self.s) + pin.dir * pullAhead.d;
      // (the player's: about to cross its line outward - pullLook s on, pullErr m past it - pulled before, not after)
      const crossing = D.pullErr >= 0 && pullAhead.off > D.pullErr;
      const wideSoon = (aimSlide > 0 && aimShort > D.aimPull) ||(D.pullRoom > 0 && outRoom < D.pullRoom) || crossing;
      const tooLittle = (D.hbOn > 0 && short > D.hbOn && (D.pullSlide <= 0 || slide < D.pullSlide)) ||
        (D.pullAngle > 0 && this.sinceKick > D.pullAfter && (D.userCtl ? this.slideT : D.slideTarget) - -pin.dir * slideSigned > D.pullAngle);
      // (a short pull, a gap after it - held on, it slowed to a crawl and spun round past its line - and not past pullMost of slide)
      if (!danger && (!exiting ? wideSoon || tooLittle : D.hbExit === 1 ? wideSoon || tooLittle : D.hbExit === 2 ? wideSoon : false) && this.pullLeft <= 0 && this.pullSince >= D.pullGap && slide < D.pullMost) this.pullLeft = p.drift?.ai?.hbPulse ?? D.hbPulse;
      // (its slide gone - a tap does not break it loose again: held on till it slides pullLow rad, pullLong s at most)
      if (D.pullLong > 0 && this.pullLeft > 0 && this.pullLeft <= PHYSICS_DT * 1.5 && -pin.dir * slideSigned < D.pullLow && this.pullHeld < D.pullLong) this.pullLeft += PHYSICS_DT;
      this.pullHeld = this.pullLeft > 0 ? this.pullHeld + PHYSICS_DT : 0;
      if (this.pullLeft > 0) this.pullSince = 0;
      else this.pullSince += PHYSICS_DT;
      const pull = this.pullLeft > 0;
      this.pullLeft = Math.max(0, this.pullLeft - PHYSICS_DT);
      if (exiting) {
        this.mode = pull ? 'pull' : 'exit';
        return { throttle: c.throttle, brake: brakeIt, steer: D.exitTaper && D.userCtl ? c.steer : c.steer * Math.max(0, rem / rampLen), handbrake: pull };
      }
      this.mode = danger ? 'danger' : pull ? 'pull' : easing ? 'ease' : 'drift';
      return { throttle: c.throttle, brake: brakeIt, steer: c.steer, handbrake: pull };
    }
    // Out of a drift, still sliding: settled first - the throttle low (its spin and push: on full throttle, counter-
    // steered, the tail swung over the other way, wall to wall), the wheel a little - the spring straightens it.
    if (this.settling && slide < D.settleSlide && Math.abs(self.yawRate - v * this.pathAt(self.s).kappa) < D.settleYaw) {
      this.settling = false;
      this.alignTo = null;
    }
    if (this.settling && this.alignTo !== null) {
      // (the player's way out: its nose held parallel to the straight - counter-steered, its turning stopped - sliding on
      // out to the middle)
      this.mode = 'settle';
      const nose = road.heading(self.s) + self.yaw;
      // (tried: its nose held further in by its course out across the road - walls 8 -> 5 for the muscle car on more
      // throttle, not enough: it was at the outside's edge already as its drift ended)
      const a = D.alignHead * Math.atan2(Math.sin(this.alignTo - nose), Math.cos(this.alignTo - nose)) - D.alignRate * self.yawRate;
      const s = Math.max(-D.alignSteer, Math.min(D.alignSteer, a / steerRange(v, p)));
      return { throttle: Math.min(pedals.throttle, D.alignGas), brake: 0, steer: s };
    }
    if (this.settling) {
      this.mode = 'settle';
      // (its nose pointed down the road, its turning stopped: the push draws its course in under its nose)
      const roadRate = v * here.kappa;
      const a = Math.atan(p.wheelbase * ahead.kappa) + D.settleHead * (here.psi - self.yaw) - D.settleRate * (self.yawRate - roadRate) - D.settleOff * Math.atan((T.offsetGain * err) / (v + T.offsetSoft));
      const s = Math.max(-D.settleSteer, Math.min(D.settleSteer, a / steerRange(v, p)));
      return { throttle: Math.min(pedals.throttle, D.settleGas), brake: 0, steer: s };
    }
    this.mode = 'line';
    // (sliding, the throttle eased: on full throttle the drift assist's rear let go and swung it)
    // (not at a standstill: turning at a crawl its body moves sideways of its heading - not a slide - and the cut left it
    // creeping round on full lock at the start)
    const gasMost = v < D.minSpeed ? 1 : Math.max(D.gasSlideLeast, 1 - ((1 - D.gasSlideLeast) * Math.max(0, slide - D.gasSlideFrom)) / D.gasSlideSpan);
    return { ...pedals, throttle: Math.min(pedals.throttle, gasMost), steer };
  }
}
