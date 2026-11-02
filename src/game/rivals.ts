import type * as THREE from 'three';
import { KMH, RAIL_D, ROAD_LENGTH } from '../config';
import { selfStateOf } from '../ai/driver';
import { PlannerDriver, PlanSource } from '../ai/plannerDriver';
import type { TrafficBox } from '../ai/sensors';
import type { PhysicsWorld } from '../physics/physicsWorld';
import type { LightFlares } from '../render/lightFlares';
import { lanesOccupied, surfaceGrip } from '../road/coords';
import { boxToFrame, OUR_FRAME, type RoadFrame } from '../road/frame';
import type { Occupant } from '../traffic/spawner';
import type { Obstacle } from '../traffic/trafficAI';
import { CarSpec, STREET_RACER } from '../vehicles/cars';
import { PLAYER_L, PLAYER_W, PlayerCar } from '../vehicles/playerCar';
import { Blocker, computeResetSpot } from './reset';
import { trackerFrom } from '../ai/netTracker';
import { aiTopSpeed } from '../ai/aiTopSpeed';

/**
 * Rival racers' settings (mutable: the tuning panel). Gaps are "rival minus
 * player" along the road, in metres.
 */
export const RIVAL_TUNING = {
  count: 5,
  /** Behind by more than this, grip and engine start getting boosted... */
  boostFrom: 30,
  /** ...up to `maxBoost` (+25 % each) this far behind. */
  boostFull: 300,
  maxBoost: 0.25,
  /** Ahead by more than this, its top speed comes down... */
  waitFrom: 150,
  /** ...to `waitSpeed` x the player's speed this far ahead (it waits for the player). */
  waitFull: 300,
  waitSpeed: 0.9,
  /** m/s: it never waits slower than this (a car parked on the road is a wreck waiting to happen). */
  waitMinSpeed: 60 * KMH,
  /** Further behind than this it is put back into the race near the player. */
  teleportBehind: 400,
  /** Slower than this (m/s) for `stuckTime` s: stuck, put back on the road. */
  stuckSpeed: 5 * KMH,
  stuckTime: 2,
  /** Heading off the road by more than this (rad): spun, put back on the road. */
  spunYaw: 0.9,
};

/**
 * The rubber band: how a rival `gap` metres from the player (+ ahead) is
 * helped or held back. `boost` is the extra grip and engine (0.25 = +25 %),
 * `speedCap` its top speed (m/s) - `cap` unless it is far ahead, then down
 * toward a little under the player's speed so the player catches up.
 */
export function rubberBand(gap: number, playerSpeed: number, cap: number): { boost: number; speedCap: number } {
  const T = RIVAL_TUNING;
  const behind = Math.min(1, Math.max(0, (-gap - T.boostFrom) / (T.boostFull - T.boostFrom)));
  const ahead = Math.min(1, Math.max(0, (gap - T.waitFrom) / (T.waitFull - T.waitFrom)));
  const wait = Math.max(T.waitMinSpeed, playerSpeed * T.waitSpeed);
  return { boost: T.maxBoost * behind, speedCap: ahead > 0 ? Math.min(cap, cap + (wait - cap) * ahead) : cap };
}

/**
 * The player's place (1 = leading): rivals that finished before the player,
 * plus - while the player has not finished - those further down the road.
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

export type ResetReason = 'stuck' | 'spun' | 'off-road' | 'far-behind';

/** Whether a rival has to be put back into the race, and why (null: it is racing). */
export function needsReset(r: { s: number; d: number; yaw: number; speed: number; stuckFor: number; playerS: number }): ResetReason | null {
  const T = RIVAL_TUNING;
  if (r.playerS - r.s > T.teleportBehind) return 'far-behind';
  if (Math.abs(r.d) > RAIL_D) return 'off-road';
  if (Math.abs(r.yaw) > T.spunYaw) return 'spun';
  if (r.speed < T.stuckSpeed && r.stuckFor > T.stuckTime) return 'stuck';
  return null;
}

/** Rival colours: none the player's red, none of the traffic's. */
const RIVAL_COLORS = [0x1e88e5, 0xffb300, 0x8e24aa, 0x00c853, 0x00bcd4];
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
/** s: how fast the rubber band follows the gap (no flicker when cars trade places). */
const BAND_SMOOTH = 1;
/** Speed (m/s) it is put back on the road at (at least the player's when it was far behind). */
const RESET_SPEED_RIVAL = 60 * KMH;
/** Top speed (m/s) once past the finish: it rolls out. */
const FINISHED_SPEED = 40 * KMH;
/** m behind the player a rival that fell far behind is put back. */
const TELEPORT_BEHIND_PLAYER = 60;
const HOLD = { throttle: 0, brake: 0, steer: 0, handbrake: true };

export interface Rival {
  index: number;
  /** Its car type: the base its rubber band boosts from, its own top speed and AI tables. */
  spec: CarSpec;
  car: PlayerCar;
  driver: PlannerDriver;
  /** s it has been slower than RIVAL_TUNING.stuckSpeed. */
  stuckFor: number;
  /** Rubber band boost now (smoothed). */
  boost: number;
  finishTime: number | null;
  resets: number;
}

/** What the rivals need to know about the race each step. */
export interface RaceView {
  player: PlayerCar;
  /** Our carriageway's traffic (NPCs and wrecks). */
  traffic: TrafficBox[];
  /** Top speed the rivals may do (m/s): the AI strength setting. */
  speedCap: number;
  raceTime: number;
}

/**
 * The rival racers: cars like the player's, each driven by the planner AI
 * (plans from `makeSource()`: a Web Worker in the game, in line in tests), held
 * near the player by the rubber band and put back into the race when stuck,
 * spun, off the road or hopelessly far behind.
 */
export class Rivals {
  readonly list: Rival[] = [];
  private readonly boxBuf: TrafficBox[] = [];

  /** `specs`: each rival's car type, one rival each (up to the start grid's size). */
  constructor(
    private readonly physics: PhysicsWorld,
    scene: THREE.Scene | null,
    makeSource: () => PlanSource | null,
    specs: CarSpec[] = Array.from({ length: RIVAL_TUNING.count }, () => STREET_RACER),
  ) {
    for (let i = 0; i < Math.min(specs.length, GRID.length); i++) {
      const spec = specs[i];
      const car = new PlayerCar(physics, scene, { spec, entity: { type: 'rival', id: i }, color: RIVAL_COLORS[i % RIVAL_COLORS.length], realLights: false });
      const driver = new PlannerDriver(makeSource());
      driver.accel = spec.ai.accel;
      driver.latAccel = spec.ai.latAccel;
      driver.tracker = trackerFrom(spec.ai.tracker);
      const r: Rival = { index: i, spec, car, driver, stuckFor: 0, boost: 0, finishTime: null, resets: 0 };
      car.surfaceGrip = (x) => surfaceGrip(x) * (1 + r.boost);
      this.list.push(r);
    }
    this.place();
  }

  /** Line them up on the start grid. */
  place(): void {
    for (const r of this.list) {
      const [lane, s] = GRID[r.index];
      r.car.resetTo(s, lane, 0);
      r.driver.reset();
      r.stuckFor = 0;
      r.boost = 0;
      r.finishTime = null;
      r.resets = 0;
      this.applyBoost(r);
    }
  }

  /** Before the physics step: each rival's AI decides, with the player and the other rivals as obstacles too. */
  drive(dt: number, view: RaceView): void {
    const p = view.player;
    for (const r of this.list) {
      const band = rubberBand(r.car.s - p.s, Math.max(0, p.speed), view.speedCap);
      r.boost += (band.boost - r.boost) * Math.min(1, dt / BAND_SMOOTH);
      this.applyBoost(r);
      const top = aiTopSpeed(band.speedCap, r.spec); // its own top speed when lower than the AI's cap
      const cap = r.finishTime === null ? top : Math.min(top, FINISHED_SPEED);
      r.car.params.maxSpeed = cap;
      r.car.prePhysics(r.driver.drive(selfStateOf(r.car, cap), this.othersAsBoxes(r, view), r.car.params), dt);
    }
  }

  /** Before the physics step while the race has not started (countdown, title): held on the grid. */
  hold(dt: number): void {
    for (const r of this.list) r.car.prePhysics(HOLD, dt);
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
      if (r.finishTime === null && c.s >= ROAD_LENGTH) r.finishTime = view.raceTime;
      r.stuckFor = c.speed < RIVAL_TUNING.stuckSpeed ? r.stuckFor + dt : 0;
      const why = needsReset({ s: c.s, d: c.d, yaw: c.yaw, speed: c.speed, stuckFor: r.stuckFor, playerS: view.player.s });
      if (why && r.finishTime === null) this.putBack(r, why, view, blockers);
    }
  }

  /** The rivals as the traffic sees the player: it gives way to them. */
  obstacles(frame: RoadFrame): Obstacle[] {
    return this.list.map((r) => {
      const t = r.car.body.translation();
      const v = r.car.body.linvel();
      const f = OUR_FRAME.forwardWorld(r.car.yaw);
      return { ...boxToFrame(frame, { x: t.x, z: t.z, fx: f.x, fz: f.z, w: PLAYER_W, l: PLAYER_L, vx: v.x, vz: v.z }), id: RIVAL_BOX_ID - r.index, isPlayer: true };
    });
  }

  /** Where the rivals are, so traffic is never spawned on top of one. */
  occupants(frame: RoadFrame): Occupant[] {
    const out: Occupant[] = [];
    for (const r of this.list) {
      const c = r.car;
      const s = frame.fromWorld(c.d, -c.s).s;
      for (const lane of lanesOccupied(c.d - PLAYER_W / 2, c.d + PLAYER_W / 2)) out.push({ s, lane, length: PLAYER_L, v: Math.max(0, c.speed) });
    }
    return out;
  }

  /** The rivals as boxes in our road coordinates (for the player's AI). */
  boxes(out: TrafficBox[] = []): TrafficBox[] {
    out.length = 0;
    for (const r of this.list) out.push({ ...r.car.footprint(), id: RIVAL_BOX_ID - r.index, v: Math.max(0, r.car.speed) });
    return out;
  }

  /** The player's place in the race (1 = leading). */
  rank(playerS: number, playerFinish: number | null): number {
    return placeOf(playerS, playerFinish, this.list.map((r) => ({ s: r.car.s, finishTime: r.finishTime })));
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

  /** Everything but `r` on its road: traffic, the player, the other rivals. */
  private othersAsBoxes(r: Rival, view: RaceView): TrafficBox[] {
    const out = this.boxBuf;
    out.length = 0;
    for (const t of view.traffic) out.push(t);
    out.push({ ...view.player.footprint(), id: PLAYER_BOX_ID, v: Math.max(0, view.player.speed) });
    for (const o of this.list) if (o !== r) out.push({ ...o.car.footprint(), id: RIVAL_BOX_ID - o.index, v: Math.max(0, o.car.speed) });
    return out;
  }

  /** Engine and grip with the rubber band's boost (the grip through `surfaceGrip`). */
  private applyBoost(r: Rival): void {
    const base = r.spec.params;
    const k = 1 + r.boost;
    r.car.params.power = base.power * k;
    r.car.params.engineTorque = base.engineTorque * k;
    r.car.params.maxDriveForce = base.maxDriveForce * k;
    r.driver.accelScale = k;
  }

  private putBack(r: Rival, why: ResetReason, view: RaceView, blockers: Blocker[]): void {
    const p = view.player;
    const farBehind = why === 'far-behind';
    const speed = farBehind ? Math.max(RESET_SPEED_RIVAL, p.speed) : RESET_SPEED_RIVAL;
    const all: Blocker[] = [...blockers, { ...p.footprint(), v: Math.max(0, p.speed) }];
    for (const o of this.list) if (o !== r) all.push({ ...o.car.footprint(), v: Math.max(0, o.car.speed) });
    // Far behind: back in on the player's tail. Otherwise where it was.
    const spot = computeResetSpot(farBehind ? p.s - TELEPORT_BEHIND_PLAYER : r.car.s, r.car.d, all, speed);
    r.car.resetTo(spot.s, spot.lane, speed);
    r.driver.reset();
    r.stuckFor = 0;
    r.resets++;
  }
}
