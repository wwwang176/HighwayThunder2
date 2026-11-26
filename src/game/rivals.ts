import type * as THREE from 'three';
import { KMH, RAIL_D, ROAD_LENGTH } from '../config';
import { selfStateOf } from '../ai/driver';
import { PlannerDriver, PlanSource } from '../ai/plannerDriver';
import type { TrafficBox } from '../ai/sensors';
import { G_NPC_LIVE, G_WRECK, type PhysicsWorld } from '../physics/physicsWorld';
import type { LightFlares } from '../render/lightFlares';
import { laneCenter, lanesOccupied, surfaceGrip } from '../road/coords';
import type { RivalDriver } from '../ai/driver';
import { boxToFrame, OUR_FRAME, type RoadFrame } from '../road/frame';
import type { Centerline } from '../road/centerline';
import type { Occupant } from '../traffic/spawner';
import type { Obstacle } from '../traffic/trafficAI';
import { CarSpec, STREET_RACER } from '../vehicles/cars';
import { randomLivery } from '../vehicles/carModels';
import { NitroAi } from '../vehicles/nitro';
import { PlayerCar } from '../vehicles/playerCar';
import { crossFraction } from '../vehicles/outline';
import { Blocker, clearResetSpot } from './reset';
import { trackerFrom } from '../ai/netTracker';
import { replaceParams, type CarParams } from '../vehicles/handling';
import { randomPerfTuning, tuned, type Tuning } from '../vehicles/tuning';
import { TUNE_CAL } from '../vehicles/tuneCalibration';

/**
 * Rival racers' settings (mutable: the tuning panel). Gaps are "rival minus
 * player" along the road, in metres. The rubber band the same at every difficulty (game/difficulty: only the
 * rivals' top speed), keeping them round the player.
 */
export const RIVAL_TUNING = {
  count: 5,
  /** Behind by more than this, it starts getting a push (within it, none)... */
  boostFrom: 100,
  /** ...rising evenly to the most this far behind (300: as long to its top speed, it caught up later): */
  boostFull: 150,
  /** its engine +60 %, */
  engineBoost: 0.6,
  /**
   * its grip +10 % (+60 % as the engine's leant the muscle car to 24 deg, rocking it side to side three times as
   * often, and rolled it over at full lock: docs/ai-experiments.md),
   */
  gripBoost: 0.1,
  /**
   * its top speed this share of the way from the difficulty's (topShare of its car's) up to its car's own - never
   * past it (0: the difficulty's all the way),
   */
  topLift: 1,
  /**
   * its nitro used this much more eagerly (0..1: bursts longer and gaps shorter, NitroAi's `eager`; the tank burnt
   * as much slower, none at the most - it never runs dry).
   */
  nitroEager: 1,
  /**
   * Behind by this much or more (m: out of sight) it goes through the traffic - no contact with NPCs nor wrecks, and
   * they don't give way to it (it hits the rails and the other rivals as ever)...
   */
  ghostFrom: 200,
  /**
   * ...and from this far it doesn't see them either: straight on at its top speed. Between the two it sees them
   * again, finding its way clear before it can hit them; solid again only with `clearS` / `clearD` m (along /
   * across the road) of room round it from every car and wreck.
   */
  blindFrom: 250,
  clearS: 3,
  clearD: 0.5,
  /** s: and along, as far again as it closes on a car (or one on it) in this long. */
  clearTime: 1,
  /** m: each of those changes back only this much past where it changed (no flicker either side of it). */
  ghostSlack: 10,
  /** Ahead by more than this, its top speed comes down... */
  waitFrom: 100,
  /** ...to `waitSpeed` x the player's speed this far ahead (it waits for the player: as fast, holding the gap). */
  waitFull: 200,
  waitSpeed: 1,
  /** m/s: it never waits slower than this (a car parked on the road is a wreck waiting to happen). */
  waitMinSpeed: 60 * KMH,
  /**
   * Further behind than this it is put back into the race `placeBehind` m
   * behind the player, at the player's speed; the same ahead (past the rubber
   * band's waiting). Both ways alike, far enough not to pop up in sight.
   */
  teleportBehind: 400,
  placeBehind: 200,
  teleportAhead: 400,
  placeAhead: 200,
  /** Slower than this (m/s) for `stuckTime` s: stuck, put back on the road. */
  stuckSpeed: 5 * KMH,
  stuckTime: 2,
  /** Heading off the road by more than this (rad): spun, put back on the road. */
  spunYaw: 0.9,
  /**
   * Stuck, spun or off the road within this (m) of the player, either way, it is left as it is: put back where
   * it was, it would vanish and pop up again in plain sight.
   */
  resetClear: 150,
};

/**
 * The rubber band: how a rival `gap` metres from the player (+ ahead) is
 * helped or held back. `push` is how much of the most help behind it gets (0..1: RIVAL_TUNING's engineBoost,
 * gripBoost, nitroEager), `speedCap` its top speed (m/s) - `cap` (the difficulty's) unless it is far behind, then up
 * toward `full` (its car's own: topLift of the way), or far ahead, then down toward the player's speed (waitSpeed of
 * it) so it goes no further ahead.
 */
export function rubberBand(gap: number, playerSpeed: number, cap: number, full = cap): { push: number; speedCap: number } {
  const T = RIVAL_TUNING;
  const push = Math.min(1, Math.max(0, (-gap - T.boostFrom) / (T.boostFull - T.boostFrom)));
  const ahead = Math.min(1, Math.max(0, (gap - T.waitFrom) / (T.waitFull - T.waitFrom)));
  const wait = Math.max(T.waitMinSpeed, playerSpeed * T.waitSpeed);
  if (ahead > 0) return { push, speedCap: Math.min(cap, cap + (wait - cap) * ahead) };
  return { push, speedCap: cap + Math.max(0, full - cap) * T.topLift * push };
}

/**
 * Whether a rival `behind` m behind the player goes through the traffic (`ghost`) and doesn't see it (`blind`),
 * from what it was (`was`) - `clear`: room round it (RIVAL_TUNING.clearS / clearD) from every car and wreck, without
 * which it stays a ghost (never made solid inside one).
 */
export function ghostMode(behind: number, was: { ghost: boolean; blind: boolean }, clear: boolean): { ghost: boolean; blind: boolean } {
  const T = RIVAL_TUNING;
  const blind = behind >= T.blindFrom + (was.blind ? -T.ghostSlack : T.ghostSlack);
  const far = behind >= T.ghostFrom - (was.ghost ? T.ghostSlack : 0);
  return { blind, ghost: blind || far || (was.ghost && !clear) };
}

type Footprint = { s: number; dMin: number; dMax: number; length: number };

/** Whether `b` is within `alongS` / `acrossD` m of `me` (both ways along, either side across). */
function near(me: Footprint, b: TrafficBox, alongS: number, acrossD: number): boolean {
  return Math.abs(b.s - me.s) < (b.length + me.length) / 2 + alongS && b.dMin - acrossD < me.dMax && me.dMin < b.dMax + acrossD;
}

/**
 * Whether `me` (at `v` m/s) has room from every box in `boxes` (phantoms aside): RIVAL_TUNING.clearD across, clearS
 * along - and as far again as it closes on it (or it on `me`) in clearTime s.
 */
export function clearOf(me: Footprint, v: number, boxes: readonly TrafficBox[]): boolean {
  const T = RIVAL_TUNING;
  for (const b of boxes) {
    if (b.phantom) continue;
    const closing = Math.max(0, b.s > me.s ? v - b.v : b.v - v);
    if (near(me, b, T.clearS + closing * T.clearTime, T.clearD)) return false;
  }
  return true;
}

/** What a rival going through the traffic doesn't touch. */
const THROUGH = G_NPC_LIVE | G_WRECK;

/** A car's body through the traffic (`ghost`) or not: NPCs and wrecks left out of its colliders' filter, or put back. */
function setGhost(car: PlayerCar, ghost: boolean): void {
  const b = car.body;
  for (let i = 0; i < b.numColliders(); i++) {
    const c = b.collider(i);
    const g = c.collisionGroups() >>> 0;
    const want = (ghost ? g & ~THROUGH : g | THROUGH) >>> 0;
    if (want !== g) c.setCollisionGroups(want);
  }
}

/**
 * The player's place (1 = leading): rivals that finished before the player,
 * plus - while the player has not finished - those further down the road (`s`: each one's front, PlayerCar.lead).
 */
export function placeOf(playerS: number, playerFinish: number | null, rivals: { s: number; finishTime: number | null }[]): number {
  let ahead = 0;
  for (const r of rivals) {
    if (r.finishTime !== null) {
      if (playerFinish === null || r.finishTime < playerFinish) ahead++;
    } else if (playerFinish === null && r.s > playerS) ahead++;
  }
  return ahead + 1;
}

export type ResetReason = 'stuck' | 'spun' | 'off-road' | 'far-behind' | 'far-ahead';

/** Whether a rival has to be put back into the race, and why (null: it is racing, or the player is too near to see it put back). */
/** A road's edge: the same either side all along, or each side's own at s (a shoulder: the mountain road's roadEdges). */
export type RoadEdge = number | ((s: number, side: 1 | -1) => number);

export function needsReset(r: { s: number; d: number; yaw: number; speed: number; stuckFor: number; playerS: number }, edge: RoadEdge = RAIL_D, teleport = true): ResetReason | null {
  const T = RIVAL_TUNING;
  if (teleport && r.playerS - r.s > T.teleportBehind) return 'far-behind';
  if (teleport && r.s - r.playerS > T.teleportAhead) return 'far-ahead';
  if (Math.abs(r.s - r.playerS) < T.resetClear) return null; // (the player would see it pop)
  if (Math.abs(r.d) > (typeof edge === 'number' ? edge : edge(r.s, r.d < 0 ? -1 : 1))) return 'off-road';
  if (Math.abs(r.yaw) > T.spunYaw) return 'spun';
  if (r.speed < T.stuckSpeed && r.stuckFor > T.stuckTime) return 'stuck';
  return null;
}

/**
 * Where along the road (s) and how fast a rival is put back: far behind or
 * far ahead, close to the player (behind it / ahead of it) at the player's
 * speed; stuck, spun or off the road, where it was at a set speed. The lane
 * (and, with traffic in the way, a little further back) is the reset spot's.
 */
export function putBackAt(why: ResetReason, rivalS: number, player: { s: number; speed: number }): { s: number; speed: number } {
  const T = RIVAL_TUNING;
  const speed = Math.max(0, player.speed);
  if (why === 'far-behind') return { s: player.s - T.placeBehind, speed };
  if (why === 'far-ahead') return { s: player.s + T.placeAhead, speed };
  return { s: rivalS, speed: RESET_SPEED_RIVAL };
}

/** Rival colours: none the player's red, none of the traffic's. */
export const RIVAL_COLORS = [0x1e88e5, 0xffb300, 0x8e24aa, 0x00c853, 0x00bcd4];
/** Start grid: [lane, s] (the player starts in lane 1 at s = -3). */
const GRID: [number, number][] = [
  [0, -3],
  [2, -3],
  [3, -3],
  [1, -12],
  [2, -12],
];
/** Ids for rivals in box lists: clear of NPCs (+), the player (-1), wreck parts and training ghosts. */
const RIVAL_BOX_ID = -1_000_000;
export const PLAYER_BOX_ID = -1;
/** This far under a road that climbs (m), a car has gone through it: put back. */
const FALLEN = 5;
/** s: how fast the rubber band follows the gap (no flicker when cars trade places). */
const BAND_SMOOTH = 1;
/** Speed (m/s) it is put back on the road at when stuck, spun or off the road. */
const RESET_SPEED_RIVAL = 60 * KMH;
/** s: no clear spot to put it back at, it tries again this much later. */
const RESET_RETRY = 0.5;
/** Top speed (m/s) once past the finish: it rolls out. */
export const FINISHED_SPEED = 40 * KMH;
const HOLD = { throttle: 0, brake: 0, steer: 0, hold: true };
/** On the grid in the countdown: both pedals down, as the player's - a burnout on the line (held to its spot). */
const REV_ON_GRID = { throttle: 1, brake: 1, steer: 0, hold: false, nitro: false };
/**
 * Revving on the grid as a driver does: the throttle blipped for `on` s and let go for `off` s (each drawn anew,
 * from..to), over and over, until `launch` s before the green: then held down, waiting for it. `firstWait`: off the
 * throttle that long first, so they do not all start together. `planAhead`: s before the green the AI starts planning
 * (its pedals not used yet), so it has a plan at the green - its first one takes a few frames to come back from the
 * worker, the throttle let go of till then (0.1 s late off the line).
 */
export const GRID_REV = { on: [0.12, 0.4], off: [0.2, 0.6], launch: [0.5, 1], firstWait: [0, 0.4], planAhead: 1 };

/** A rival's revving on the grid: blipping now or not, s left of that, and how long before the green it holds on. */
export interface GridRev {
  on: boolean;
  left: number;
  launch: number;
}

const between = ([lo, hi]: number[], rng: () => number) => lo + (hi - lo) * rng();

/** A fresh start for the countdown. */
export function gridRevStart(rng: () => number = Math.random): GridRev {
  return { on: false, left: between(GRID_REV.firstWait, rng), launch: between(GRID_REV.launch, rng) };
}

/** On the throttle this step? `toGo`: s of the countdown left. */
export function gridRevStep(g: GridRev, dt: number, toGo: number, rng: () => number = Math.random): boolean {
  if (toGo <= g.launch) return true; // (held down for the green)
  g.left -= dt;
  if (g.left <= 0) {
    g.on = !g.on;
    g.left = between(g.on ? GRID_REV.on : GRID_REV.off, rng);
  }
  return g.on;
}

/** A road's own setup of the cars (vehicles/mountainSetup): their params as built or tuned, their AI tables (for their tuning). */
export interface RoadSetup {
  params: (p: CarParams, spec: CarSpec) => CarParams;
  ai: (ai: CarSpec['ai'], spec: CarSpec, tuning: Tuning) => CarSpec['ai'];
}

export interface Rival<D extends RivalDriver = PlannerDriver> {
  index: number;
  /** Its car type: its AI tables. */
  spec: CarSpec;
  /** Its tuning this race (Rivals.tuneAtRandom: its perf knobs at random; else as built). */
  tuning: Tuning;
  /** Its car as tuned: the base its rubber band boosts from, its own top speed. */
  base: CarParams;
  car: PlayerCar;
  driver: D;
  /** s it has been slower than RIVAL_TUNING.stuckSpeed. */
  stuckFor: number;
  /** The rubber band's push now (0..1, smoothed: rubberBand). */
  push: number;
  /** Going through the traffic, and not seeing it (ghostMode: far behind, out of sight). */
  ghost: boolean;
  blind: boolean;
  /** When it uses its nitro (by rule: nitro.ts). */
  nitroAi: NitroAi;
  finishTime: number | null;
  /** The front of its body last step (PlayerCar.lead; -Infinity: none yet): where in a step it got over the line. */
  lastLead: number;
  resets: number;
  /** s left before it may be put back again (no clear spot last time: RESET_RETRY). */
  resetWait: number;
  /** Its revving in the countdown. */
  gridRev: GridRev;
}

/** What the rivals need to know about the race each step. */
export interface RaceView {
  player: PlayerCar;
  /** Our carriageway's traffic (NPCs and wrecks). */
  traffic: TrafficBox[];
  /** Top speed the rivals may do (m/s): the AI strength setting. */
  speedCap: number;
  /** And at most this share of their own car's top speed (the race's difficulty; none: all of it). */
  topShare?: number;
  raceTime: number;
  /** The police cars (game/police: boxes()), seen as any car on the road; none: no police. */
  police?: TrafficBox[];
}

/**
 * The rival racers: cars like the player's, each driven by the planner AI
 * (plans from `makeSource()`: a Web Worker in the game, in line in tests), held
 * near the player by the rubber band and put back into the race when stuck,
 * spun, off the road or hopelessly far behind.
 */
export class Rivals<D extends RivalDriver = PlannerDriver> {
  readonly list: Rival<D>[] = [];
  private readonly boxBuf: TrafficBox[] = [];
  /** Where each starts (d, s), and how far either side of the centre line it is off the road (m). */
  private readonly grid: [number, number][];
  private readonly edge: RoadEdge;
  /**
   * Its own road's put-back (the mountain road's two lanes), else the highway's (clearResetSpot). With its own lanes,
   * no teleports either (far behind or ahead it races on: the rubber band alone keeps it near).
   */
  private readonly ownLanes: number[] | null;
  private readonly setup: RoadSetup | null;

  /**
   * `specs`: each rival's car type, one rival each (up to the start grid's size). `opts`: another road's - each
   * rival's driver (`makeDriver`; none: the planner, plans from `makeSource`), its grid (d, s), its grip push
   * (RIVAL_TUNING.gripBoost's), its road's edge and its lanes (d) to be put back in.
   */
  constructor(
    private readonly physics: PhysicsWorld,
    scene: THREE.Scene | null,
    makeSource: () => PlanSource | null,
    specs: CarSpec[] = Array.from({ length: RIVAL_TUNING.count }, () => STREET_RACER),
    opts: {
      makeDriver?: (spec: CarSpec) => D;
      grid?: [number, number][];
      gripBoost?: number;
      edge?: RoadEdge;
      lanes?: number[];
      setup?: RoadSetup;
    } = {},
  ) {
    this.setup = opts.setup ?? null;
    this.grid = opts.grid ?? GRID.map(([lane, s]) => [laneCenter(lane), s]);
    this.edge = opts.edge ?? RAIL_D;
    this.ownLanes = opts.lanes ?? null;
    const gripBoost = opts.gripBoost ?? RIVAL_TUNING.gripBoost;
    for (let i = 0; i < Math.min(specs.length, this.grid.length); i++) {
      const spec = specs[i];
      const car = new PlayerCar(physics, scene, {
        spec,
        entity: { type: 'rival', id: i },
        color: RIVAL_COLORS[i % RIVAL_COLORS.length],
        livery: randomLivery(spec.style), // a car with paint jobs wears one at random (its colour is for the HUD)
        realLights: false, // (their real lamps are a pool shared by them all: game/rivalLights)
      });
      let driver: D;
      if (opts.makeDriver) driver = opts.makeDriver(spec);
      else {
        const planner = new PlannerDriver(makeSource());
        planner.accel = spec.ai.accel;
        planner.latAccel = spec.ai.latAccel;
        planner.brake = spec.ai.brake;
        planner.tracker = trackerFrom(spec.ai.tracker);
        driver = planner as unknown as D;
      }
      const base = this.setup ? this.setup.params(spec.params, spec) : spec.params;
      if (this.setup) {
        Object.assign(car.params, base);
        car.applyMass(); // (a setup may move its centre of mass)
      }
      const r: Rival<D> = { index: i, spec, tuning: {}, base, car, driver, stuckFor: 0, push: 0, ghost: false, blind: false, nitroAi: new NitroAi(), finishTime: null, lastLead: -Infinity, resets: 0, resetWait: 0, gridRev: gridRevStart() };
      car.surfaceGrip = (x) => surfaceGrip(x) * (1 + gripBoost * r.push);
      this.list.push(r);
    }
    this.place();
  }

  /** A race's start: each rival's perf knobs at random (the game's; off: as built, as the training's races). */
  tuneAtRandom = false;
  /** The race's length (m): past it, a rival has finished. */
  length = ROAD_LENGTH;

  /** The road they drive on (setRoad's). */
  private roadLine: Centerline | null = null;

  /** The road they drive on (their s, d and yaw along it). */
  setRoad(line: Centerline): void {
    this.roadLine = line;
    for (const r of this.list) {
      r.car.road = line;
      this.layLine(r);
    }
  }

  /** A driver with a line of its own: the share of its car's grip its line is planned to (the difficulty's; none: its own). */
  budget: ((spec: CarSpec) => number) | null = null;

  /** A driver with a line of its own: worked out for the road, by its car's tables as set up (and as tuned). */
  private layLine(r: Rival<D>): void {
    if (!this.roadLine) return;
    const driver = r.driver as { budget?: number };
    if (this.budget && driver.budget !== undefined) driver.budget = this.budget(r.spec);
    const ai = this.setup ? this.setup.ai(r.spec.ai, r.spec, r.tuning) : r.spec.ai;
    (r.driver as { setRoad?: (l: Centerline, ai: CarSpec['ai']) => void }).setRoad?.(this.roadLine, ai);
  }

  /** Line them up on the start grid (each tuned anew: tuneAtRandom). */
  place(): void {
    for (const r of this.list) {
      if (this.tuneAtRandom) {
        r.tuning = randomPerfTuning();
        r.base = tuned(r.spec.params, r.tuning, TUNE_CAL[r.spec.id]);
        if (this.setup) r.base = this.setup.params(r.base, r.spec);
        replaceParams(r.car.params, r.base); // (assigned over, the last race's knobs not drawn this time stayed)
        if (this.setup) r.car.applyMass();
        this.layLine(r); // (its line on its grip as tuned)
      }
      const [d, s] = this.grid[r.index];
      r.car.resetAt(s, d, 0);
      r.driver.reset(d);
      r.car.nitro.reset();
      r.nitroAi.reset();
      r.stuckFor = 0;
      r.push = 0;
      r.ghost = r.blind = false;
      setGhost(r.car, false);
      r.finishTime = null;
      r.lastLead = -Infinity;
      r.resets = 0;
      r.resetWait = 0;
      r.gridRev = gridRevStart();
      this.applyBoost(r);
    }
  }

  /** Before the physics step: each rival's AI decides, with the player and the other rivals as obstacles too. */
  drive(dt: number, view: RaceView): void {
    const p = view.player;
    for (const r of this.list) {
      r.car.holdInPlace(false);
      const full = Math.min(view.speedCap, r.base.maxSpeed); // its car's own top speed (as tuned), within the AI's cap
      const own = Math.min(view.speedCap, (view.topShare ?? 1) * r.base.maxSpeed); // (the difficulty's share of its car's)
      const band = rubberBand(r.car.s - p.s, Math.max(0, p.speed), own, full);
      r.push += (band.push - r.push) * Math.min(1, dt / BAND_SMOOTH);
      this.applyBoost(r);
      const mode = ghostMode(p.s - r.car.s, r, !r.ghost || clearOf(r.car.footprint(), Math.max(0, r.car.speed), view.traffic));
      if (mode.ghost !== r.ghost) setGhost(r.car, mode.ghost);
      r.ghost = mode.ghost;
      r.blind = mode.blind;
      const top = Math.min(band.speedCap, r.base.maxSpeed);
      const cap = r.finishTime === null ? top : Math.min(top, FINISHED_SPEED);
      r.car.params.maxSpeed = cap;
      // Past the line it coasts down to FINISHED_SPEED: no more push over it (maxSpeed), the AI aiming at the speed
      // it has - never braking for it (only for what is ahead).
      const aim = r.finishTime === null ? cap : Math.max(cap, r.car.speed);
      const input = r.driver.drive(selfStateOf(r.car, aim), this.othersAsBoxes(r, view), r.car.params);
      const eager = r.finishTime === null ? RIVAL_TUNING.nitroEager * r.push : 0;
      r.car.params.nitroBurn = (r.base.nitroBurn ?? 1) / Math.max(1e-3, 1 - eager); // (the tank burnt as much slower)
      r.car.prePhysics({ ...input, nitro: r.nitroAi.want(dt, input.throttle, r.car.nitro, eager) }, dt);
    }
  }

  /**
   * Before the physics step while the race has not started (countdown, title): held on the grid - `revving` (the
   * countdown, `toGo` s of it left) blipping the throttle (the brake held: bursts of burnout going nowhere), then
   * held down for the green (GRID_REV), let go of at the green. With `view`, from GRID_REV.planAhead s before the
   * green its AI plans as in the race (its pedals not used): a plan in hand at the green.
   */
  hold(dt: number, revving = false, toGo = 0, view?: RaceView): void {
    for (const r of this.list) {
      if (view && revving && toGo <= GRID_REV.planAhead) {
        const own = Math.min(view.speedCap, (view.topShare ?? 1) * r.base.maxSpeed);
        const band = rubberBand(r.car.s - view.player.s, 0, own, Math.min(view.speedCap, r.base.maxSpeed));
        r.driver.drive(selfStateOf(r.car, Math.min(band.speedCap, r.base.maxSpeed)), this.othersAsBoxes(r, view), r.car.params);
      }
      r.car.holdInPlace(revving);
      r.car.prePhysics(revving && gridRevStep(r.gridRev, dt, toGo) ? REV_ON_GRID : HOLD, dt);
    }
  }

  /**
   * After the physics step: finishes, and (while racing) putting stuck / spun
   * / lost cars back into the race.
   */
  after(dt: number, view: RaceView, blockers: Blocker[], racing = true): void {
    for (const r of this.list) {
      r.car.postPhysics();
      if (!racing) continue;
      const c = r.car;
      // Over the line: the front of its body (PlayerCar.lead), its time where in the step it got there (the race's
      // time as the step began: view's).
      const lead = c.lead;
      if (r.finishTime === null && lead >= this.length) r.finishTime = view.raceTime + dt * crossFraction(r.lastLead, lead, this.length);
      r.lastLead = lead;
      r.stuckFor = c.speed < RIVAL_TUNING.stuckSpeed ? r.stuckFor + dt : 0;
      r.resetWait = Math.max(0, r.resetWait - dt);
      if (r.resetWait > 0) continue;
      // Under a road that climbs (through its surface: a mesh has no inside): off the road, wherever it is.
      const under = c.road.hilly && c.body.translation().y < c.road.height(c.s) - FALLEN;
      const why = under ? 'off-road' : needsReset({ s: c.s, d: c.d, yaw: c.yaw, speed: c.speed, stuckFor: r.stuckFor, playerS: view.player.s }, this.edge, !this.ownLanes);
      if (why && (r.finishTime === null || under)) this.putBack(r, why, view, blockers);
    }
  }

  /** The rivals as the traffic sees the player: it gives way to them (not to one going through it: a ghost). */
  obstacles(frame: RoadFrame): Obstacle[] {
    return this.list.filter((r) => !r.ghost).map((r) => {
      const t = r.car.body.translation();
      const v = r.car.body.linvel();
      const f = OUR_FRAME.forwardWorld(r.car.yaw, r.car.s);
      const box = { x: t.x, z: t.z, fx: f.x, fz: f.z, w: r.car.width, l: r.car.length, vx: v.x, vz: v.z };
      return { ...boxToFrame(frame, box, frame.sOf(r.car.s)), id: RIVAL_BOX_ID - r.index, isPlayer: true };
    });
  }

  /** Where the rivals are, so traffic is never spawned on top of one. */
  occupants(frame: RoadFrame): Occupant[] {
    const out: Occupant[] = [];
    for (const r of this.list) {
      const c = r.car;
      const s = frame.sOf(c.s);
      for (const lane of lanesOccupied(c.d - c.width / 2, c.d + c.width / 2)) out.push({ s, lane, length: c.length, v: Math.max(0, c.speed) });
    }
    return out;
  }

  /** The rivals as boxes in our road coordinates (for the player's AI). */
  boxes(out: TrafficBox[] = []): TrafficBox[] {
    out.length = 0;
    for (const r of this.list) out.push({ ...r.car.footprint(), id: RIVAL_BOX_ID - r.index, v: Math.max(0, r.car.speed) });
    return out;
  }

  /** The player's place in the race (1 = leading): `playerLead` and theirs, the fronts of the bodies (PlayerCar.lead). */
  rank(playerLead: number, playerFinish: number | null): number {
    return placeOf(playerLead, playerFinish, this.list.map((r) => ({ s: r.car.lead, finishTime: r.finishTime })));
  }

  render(alpha: number, flares?: LightFlares): void {
    for (const r of this.list) r.car.render(alpha, flares);
  }

  /** Take every rival out of the world (new ones, on other cars, take their place). */
  dispose(): void {
    for (const r of this.list) {
      r.car.dispose(this.physics);
      r.driver.dispose();
    }
    this.list.length = 0;
  }

  /**
   * Everything but `r` on its road: traffic (not while it is blind to it; going through it, not what it is in - it
   * plans its way out round the rest), the player, the other rivals.
   */
  private othersAsBoxes(r: Rival<D>, view: RaceView): TrafficBox[] {
    const out = this.boxBuf;
    out.length = 0;
    const me = r.ghost ? r.car.footprint() : null;
    if (!r.blind) for (const t of view.traffic) if (!me || !near(me, t, 0, 0)) out.push(t);
    out.push({ ...view.player.footprint(), id: PLAYER_BOX_ID, v: Math.max(0, view.player.speed) });
    for (const o of this.list) if (o !== r) out.push({ ...o.car.footprint(), id: RIVAL_BOX_ID - o.index, v: Math.max(0, o.car.speed) });
    if (view.police) for (const b of view.police) out.push(b);
    return out;
  }

  /** The engine with the rubber band's push (the grip's: `surfaceGrip`, set up with the car). */
  private applyBoost(r: Rival<D>): void {
    const base = r.base;
    const k = 1 + RIVAL_TUNING.engineBoost * r.push;
    r.car.params.power = base.power * k;
    r.car.params.engineTorque = base.engineTorque * k;
    r.driver.accelScale = k;
    if (r.driver.push !== undefined) r.driver.push = r.push;
  }

  private putBack(r: Rival<D>, why: ResetReason, view: RaceView, blockers: Blocker[]): void {
    const p = view.player;
    const at = putBackAt(why, r.car.s, p);
    const all: Blocker[] = [...blockers, { ...p.footprint(), v: Math.max(0, p.speed) }];
    for (const o of this.list) if (o !== r) all.push({ ...o.car.footprint(), v: Math.max(0, o.car.speed) });
    if (view.police) for (const b of view.police) all.push(b); // (a rival rammed by one is put back beside it)
    if (this.ownLanes) {
      this.putBackOnLanes(r, at, all);
      return;
    }
    // Only somewhere clear - never on top of another car - looking on from a spot ahead of the player, back from one
    // behind it (never past the player into the lead, nor back behind it). No room yet: it waits and tries again.
    const spot = clearResetSpot(at.s, r.car.d, all, at.speed, at.s >= p.s ? 1 : -1);
    if (!spot) {
      r.resetWait = RESET_RETRY;
      return;
    }
    r.car.resetTo(spot.s, spot.lane, at.speed);
    r.driver.reset(r.car.d);
    r.stuckFor = 0;
    r.resets++;
  }

  /**
   * On a road of its own lanes (the mountain road's): in the first lane clear of the others (none within a few car
   * lengths) at `at.s`, or a little further back; at a speed it can take the bends just ahead at. None clear: later.
   */
  private putBackOnLanes(r: Rival<D>, at: { s: number; speed: number }, all: Blocker[]): void {
    const road = r.car.road;
    for (let back = 0; back <= 60; back += 6) {
      const s = Math.max(0, at.s - back);
      for (const d of this.ownLanes ?? []) {
        if (all.some((b) => Math.abs(b.s - s) < 12 && b.dMax > d - 1.5 && b.dMin < d + 1.5)) continue;
        let k = 0;
        for (let a = 0; a <= 40; a += 4) k = Math.max(k, Math.abs(road.curvature(s + a)));
        const speed = Math.min(at.speed, k > 0 ? Math.sqrt((0.5 * 9.81) / k) : at.speed);
        r.car.resetAt(s, d, speed);
        r.driver.reset(d);
        r.stuckFor = 0;
        r.resets++;
        return;
      }
    }
    r.resetWait = RESET_RETRY;
  }
}
