import type * as THREE from 'three';
import { KMH } from '../config';
import { selfStateOf } from '../ai/driver';
import { trackerFrom } from '../ai/netTracker';
import { PlannerDriver, type PlanSource } from '../ai/plannerDriver';
import type { TrafficBox } from '../ai/sensors';
import type { PhysicsWorld } from '../physics/physicsWorld';
import type { LightFlares } from '../render/lightFlares';
import type { Centerline } from '../road/centerline';
import { lanesOccupied, surfaceGrip } from '../road/coords';
import { boxToFrame, OUR_FRAME, type RoadFrame } from '../road/frame';
import type { Occupant } from '../traffic/spawner';
import type { Obstacle } from '../traffic/trafficAI';
import { POLICE_SUV } from '../vehicles/cars';
import type { DriveInput } from '../vehicles/handling';
import { PlayerCar } from '../vehicles/playerCar';
import { isLost, lineClear, parkSpot, phaseOf, pickTarget, POLICE_TUNING, ramInput, type Racer, SHOULDER_D } from './policeLogic';
import type { Blocker } from './reset';

/** Parked on the shoulder; ahead of its target (on its way); behind it (chasing, ramming); done, pulling over. */
export type PoliceState = 'parked' | 'front' | 'behind' | 'pullover';

export interface PoliceCar {
  index: number;
  car: PlayerCar;
  driver: PlannerDriver;
  state: PoliceState;
  target: Racer | null;
  /** Ramming its target this step (the line to it clear): steered at it, not by its plans. */
  ramming: boolean;
}

/** The police cars' first spots (m along the road, on the shoulder): out of sight at the start, met as the race goes. */
const FIRST_PARKED = [800, 1300, 1800];
/** Ids of their boxes (the planners', the traffic's): clear of the rivals' (-1_000_000 on) and the player's (-1). */
const POLICE_BOX_ID = -2_000_000;
/** How much slower than its target one ahead of it goes, how much faster one behind may (m/s). */
const FRONT_SLOWER = 20 * KMH;
const BEHIND_FASTER = 40 * KMH;
/** Behind: its engine boosted by up to this share, from `boostFrom` m behind its target to `boostFull` m. */
const BOOST = { most: 0.5, from: 30, full: 230 };
/** Pulling over: this fast (m/s) until within `near` m of the shoulder's middle, then to a stop. */
const PULL_OVER = { speed: 40 * KMH, near: 0.4 };
/** Parked again: this far (m) along from any other police car. */
const PARK_APART = 40;
/** Rams only a target at most this far ahead (m): further, it closes in by its plans. */
const RAM_RANGE = 120;
const HOLD: DriveInput = { throttle: 0, brake: 0, steer: 0, hold: true };

/**
 * The police (the highway's): POLICE_TUNING.count SUVs, parked on the shoulder. The player driving past a parked one
 * sets the chase off (`triggered`); from then on each, by the racer it goes for (pickTarget: the player first), guards
 * the road ahead of it (front) or chases it (behind: its plans round the traffic, flat out at it once the line to it is
 * clear). Further than POLICE_TUNING.lost from every racer it has lost them: parked again ahead of them all, out of sight.
 * One that busted the player pulls over onto the shoulder and stays there till it too is lost.
 */
export class Police {
  readonly list: PoliceCar[] = [];
  /** The player has driven past a parked police car: the chase is on (each race anew). */
  triggered = false;
  private readonly boxBuf: TrafficBox[] = [];

  constructor(
    private readonly physics: PhysicsWorld,
    scene: THREE.Scene | null,
    makeSource: () => PlanSource | null,
  ) {
    const spec = POLICE_SUV;
    for (let i = 0; i < POLICE_TUNING.count; i++) {
      const car = new PlayerCar(physics, scene, { spec, entity: { type: 'police', id: i }, realLights: false });
      car.surfaceGrip = surfaceGrip;
      const driver = new PlannerDriver(makeSource());
      driver.accel = spec.ai.accel;
      driver.latAccel = spec.ai.latAccel;
      driver.brake = spec.ai.brake;
      driver.tracker = trackerFrom(spec.ai.tracker);
      this.list.push({ index: i, car, driver, state: 'parked', target: null, ramming: false });
    }
    this.place();
  }

  /** The road they drive on. */
  setRoad(line: Centerline): void {
    for (const p of this.list) p.car.road = line;
  }

  /** A race's start: all parked at their first spots, the chase not on yet. */
  place(): void {
    this.triggered = false;
    this.list.forEach((p, i) => this.park(p, FIRST_PARKED[i % FIRST_PARKED.length] + Math.floor(i / FIRST_PARKED.length) * 1500));
  }

  /** Before the race: held where they are. */
  hold(dt: number): void {
    for (const p of this.list) {
      p.car.holdInPlace(true);
      p.car.prePhysics(HOLD, dt);
    }
  }

  /**
   * Before the physics step: each one's input. `racers` (the player and the rivals) with their boxes `racerBoxes` (the
   * same order); `traffic` our carriageway's.
   */
  drive(dt: number, racers: readonly Racer[], racerBoxes: readonly TrafficBox[], traffic: readonly TrafficBox[]): void {
    const player = racers.find((r) => r.isPlayer);
    for (const p of this.list) {
      const c = p.car;
      if (p.state === 'parked' && player && player.s > c.s) this.triggered = true;
    }
    for (const p of this.list) {
      const c = p.car;
      p.ramming = false;
      // Lost: parked again ahead of them all (one parked behind them all too - left behind, the chase not on).
      const behindAll = racers.every((r) => r.s > c.s);
      if (racers.length && isLost(c.s, racers, POLICE_TUNING.lost) && (p.state !== 'parked' || behindAll)) {
        this.parkAhead(p, racers);
        continue;
      }
      if (p.state === 'parked') {
        const t = this.triggered ? pickTarget(c.s, racers, POLICE_TUNING.wake) : null;
        if (!t) {
          c.holdInPlace(true);
          c.prePhysics(HOLD, dt);
          continue;
        }
        c.holdInPlace(false);
        p.driver.reset();
        p.state = phaseOf(c.s, t);
      }
      if (p.state === 'pullover') {
        p.target = null;
        const there = Math.abs(c.d - SHOULDER_D) < PULL_OVER.near;
        this.boost(p, 1);
        c.prePhysics(p.driver.drive(selfStateOf(c, there ? 0 : PULL_OVER.speed), this.seen(p, racerBoxes, traffic), c.params), dt);
        continue;
      }
      const t = pickTarget(c.s, racers, POLICE_TUNING.lost);
      if (!t) {
        this.parkAhead(p, racers);
        continue;
      }
      p.target = t;
      p.state = phaseOf(c.s, t);
      const seen = this.seen(p, racerBoxes, traffic);
      if (p.state === 'front') {
        this.boost(p, 1);
        c.prePhysics(p.driver.drive(selfStateOf(c, Math.max(0, t.v - FRONT_SLOWER)), seen, c.params), dt);
        continue;
      }
      // Behind: boosted the further back it is; flat out at it once the line to it is clear.
      const gap = t.s - c.s;
      this.boost(p, 1 + BOOST.most * Math.max(0, Math.min(1, (gap - BOOST.from) / (BOOST.full - BOOST.from))));
      const aim = { s: t.s + t.v * POLICE_TUNING.aimAhead, d: t.d };
      const others = seen.filter((b) => !this.isTargetBox(b, t, racers, racerBoxes));
      const cap = Math.min(POLICE_SUV.params.maxSpeed, t.v + BEHIND_FASTER);
      c.params.maxSpeed = cap;
      if (gap < RAM_RANGE && lineClear({ s: c.s, d: c.d }, aim, others, POLICE_TUNING.laneWidth)) {
        p.ramming = true;
        c.prePhysics(ramInput(selfStateOf(c, cap), aim, c.params), dt);
      } else c.prePhysics(p.driver.drive(selfStateOf(c, cap), seen, c.params), dt);
    }
  }

  /** After the physics step. */
  after(): void {
    for (const p of this.list) p.car.postPhysics();
  }

  /** Police car `index` busted the player: it pulls over onto the shoulder, and goes for nobody now. */
  pullOver(index: number): void {
    const p = this.list[index];
    if (!p) return;
    p.state = 'pullover';
    p.target = null;
    p.driver.preferD = SHOULDER_D;
    p.driver.shoulder = true;
  }

  /** As boxes in our road's coordinates (the racers' AIs). */
  boxes(out: TrafficBox[] = []): TrafficBox[] {
    out.length = 0;
    for (const p of this.list) out.push({ ...p.car.footprint(), id: POLICE_BOX_ID - p.index, v: Math.max(0, p.car.speed) });
    return out;
  }

  /** As the traffic sees the player: it gives way to them. */
  obstacles(frame: RoadFrame): Obstacle[] {
    return this.list.map((p) => {
      const c = p.car;
      const t = c.body.translation();
      const v = c.body.linvel();
      const f = OUR_FRAME.forwardWorld(c.yaw, c.s);
      const box = { x: t.x, z: t.z, fx: f.x, fz: f.z, w: c.width, l: c.length, vx: v.x, vz: v.z };
      return { ...boxToFrame(frame, box, frame.sOf(c.s)), id: POLICE_BOX_ID - p.index, isPlayer: true };
    });
  }

  /** Where they are, so traffic is never spawned on top of one. */
  occupants(frame: RoadFrame): Occupant[] {
    const out: Occupant[] = [];
    for (const p of this.list) {
      const c = p.car;
      const s = frame.sOf(c.s);
      for (const lane of lanesOccupied(c.d - c.width / 2, c.d + c.width / 2)) out.push({ s, lane, length: c.length, v: Math.max(0, c.speed) });
    }
    return out;
  }

  /** In the way of a car put back (game/reset). */
  blockers(): Blocker[] {
    return this.list.map((p) => ({ ...p.car.footprint(), v: Math.max(0, p.car.speed) }));
  }

  /** Which police car `id`'s box is (boxes()); none: -1. */
  static indexOfBox(id: number | undefined): number {
    return id !== undefined && id <= POLICE_BOX_ID && id > POLICE_BOX_ID - 1000 ? POLICE_BOX_ID - id : -1;
  }

  render(alpha: number, flares?: LightFlares): void {
    for (const p of this.list) p.car.render(alpha, flares);
  }

  dispose(): void {
    for (const p of this.list) {
      p.car.dispose(this.physics);
      p.driver.dispose();
    }
    this.list.length = 0;
  }

  /** What one sees: the traffic, the racers, the other police cars. */
  private seen(p: PoliceCar, racerBoxes: readonly TrafficBox[], traffic: readonly TrafficBox[]): TrafficBox[] {
    const out = this.boxBuf;
    out.length = 0;
    for (const t of traffic) out.push(t);
    for (const b of racerBoxes) out.push(b);
    for (const o of this.list) if (o !== p) out.push({ ...o.car.footprint(), id: POLICE_BOX_ID - o.index, v: Math.max(0, o.car.speed) });
    return out;
  }

  private isTargetBox(b: TrafficBox, t: Racer, racers: readonly Racer[], racerBoxes: readonly TrafficBox[]): boolean {
    const i = racers.indexOf(t);
    return i >= 0 && racerBoxes[i] !== undefined && b.id === racerBoxes[i].id;
  }

  /** Its engine (and its plans' acceleration) times `k`. */
  private boost(p: PoliceCar, k: number): void {
    const base = POLICE_SUV.params;
    p.car.params.power = base.power * k;
    p.car.params.engineTorque = base.engineTorque * k;
    p.car.params.maxSpeed = base.maxSpeed;
    p.driver.accelScale = k;
  }

  /** Parked again on the shoulder ahead of every racer (out of sight), clear of the other police cars. */
  private parkAhead(p: PoliceCar, racers: readonly Racer[]): void {
    let s = parkSpot(racers, POLICE_TUNING.parkAhead).s;
    while (this.list.some((o) => o !== p && Math.abs(o.car.s - s) < PARK_APART)) s += PARK_APART;
    this.park(p, s);
  }

  private park(p: PoliceCar, s: number): void {
    p.state = 'parked';
    p.target = null;
    p.ramming = false;
    p.driver.preferD = null;
    p.driver.shoulder = false;
    this.boost(p, 1);
    p.car.resetAt(s, SHOULDER_D, 0);
    p.car.holdInPlace(true);
    p.driver.reset();
  }
}
