import * as THREE from 'three';
import { PHYSICS_DT, ROAD_LENGTH } from '../config';
import { PhysicsWorld } from '../physics/physicsWorld';
import { laneAt, laneCenter, lanesOccupied, surfaceGrip } from '../road/coords';
import { boxToFrame, OUR_FRAME, type RoadFrame } from '../road/frame';
import type { Occupant } from '../traffic/spawner';
import type { Obstacle } from '../traffic/trafficAI';
import { TrafficFocus, TrafficWorld } from '../sim/trafficWorld';
import { PLAYER_L, PLAYER_W, PlayerCar } from '../vehicles/playerCar';
import { WheelInstances } from '../vehicles/wheelInstances';
import type { Brain } from './brain';
import { AiDriver, Driver, selfStateOf } from './driver';
import { FITNESS, isOffRoad, RunResult, touching } from './fitness';
import { mulberry32 } from './rng';
import type { TrafficBox } from './sensors';

const START_LANE = 1;
const CAR_HALF_W = PLAYER_W / 2;
/** Settled in a lane: this close to its centre (m) and moving across slower than SETTLED_SIDEWAYS (m/s). */
const HOLDING_LANE_TOLERANCE = 0.5;
const SETTLED_SIDEWAYS = 1;

/** One AI car in a generation. */
export interface Ghost {
  car: PlayerCar;
  driver: Driver;
  alive: boolean;
  result: RunResult;
  /** Last time it had made stallMinProgress metres of progress. */
  progressS: number;
  progressT: number;
  /** Lane changes made so far (counted when settled in the new lane). */
  laneChanges: number;
  /** The lane it last settled in. */
  lane: number;
  /** Vehicles it is touching now (id → since when). */
  touching: Map<number, number>;
}

/**
 * The lane whose traffic from behind would brake for this car in the game: the
 * one it is settled in (near its centre, not moving across), or none while it
 * moves across (cutting in front of traffic is its own doing).
 */
export function ownLane(d: number, vD: number): number | null {
  const lane = laneAt(d);
  return Math.abs(vD) < SETTLED_SIDEWAYS && Math.abs(d - laneCenter(lane)) < HOLDING_LANE_TOLERANCE ? lane : null;
}

/**
 * What touching `touched` means for a car moving at (vS, vD) in road
 * coordinates: a crash when any contact is too hard (relative speed over
 * FITNESS.lightContactSpeed) or has lasted longer than FITNESS.maxContactTime
 * (driving through it), otherwise the number of new light contacts. `open`
 * (id → start time) is updated: contacts that ended are dropped.
 */
export function judgeContacts(touched: TrafficBox[], vS: number, vD: number, time: number, open: Map<number, number>): 'crash' | number {
  let started = 0;
  const now = new Set<number>();
  for (const t of touched) {
    if (Math.hypot(vS - t.v, vD) > FITNESS.lightContactSpeed) return 'crash';
    const id = t.id ?? -1;
    now.add(id);
    const since = open.get(id);
    if (since === undefined) {
      open.set(id, time);
      started++;
    } else if (time - since > FITNESS.maxContactTime) return 'crash';
  }
  for (const id of [...open.keys()]) if (!now.has(id)) open.delete(id);
  return started;
}

export interface TrainingSimOptions {
  /** Top speed every car in this run is limited to (m/s); also a network input. */
  speedCap: number;
  timeLimit?: number;
  /** Where the traffic is drawn; a throwaway scene when omitted (headless runs). */
  scene?: THREE.Scene;
  wheelPool?: WheelInstances;
  /**
   * Traffic sees the AI cars and gives way to them, as it does the player in
   * the game (for evaluating a single driver). Off for training: dozens of
   * ghosts it all had to dodge would make a traffic jam no race has.
   */
  trafficSeesCars?: boolean;
}

/**
 * One generation's race: a fresh physics world, traffic from `seed`, and one
 * ghost car per brain (or driver), all starting together. Ghosts don't touch
 * each other or the traffic; one is out when it hits a vehicle hard, leaves our
 * pavement, stalls, or finishes. Traffic ignores the ghosts and is kept around
 * all of them.
 */
export class TrainingSim {
  readonly ghosts: Ghost[] = [];
  readonly physics: PhysicsWorld;
  readonly traffic: TrafficWorld;
  readonly speedCap: number;
  readonly timeLimit: number;
  private readonly trafficSeesCars: boolean;
  time = 0;
  private boxes: TrafficBox[] = [];
  private touched: TrafficBox[] = [];
  private readonly ownPool: WheelInstances | null;
  private readonly scene: THREE.Scene;

  constructor(drivers: (Brain | Driver)[], seed: number, opts: TrainingSimOptions) {
    this.speedCap = opts.speedCap;
    this.timeLimit = opts.timeLimit ?? FITNESS.timeLimit;
    this.trafficSeesCars = opts.trafficSeesCars ?? false;
    this.physics = PhysicsWorld.createSync();
    this.physics.timestep = PHYSICS_DT;
    this.scene = opts.scene ?? new THREE.Scene();
    this.ownPool = opts.wheelPool ? null : new WheelInstances(this.scene);
    const pool = opts.wheelPool ?? this.ownPool!;
    this.traffic = new TrafficWorld(this.physics, this.scene, pool, mulberry32(seed), { oncoming: false });
    for (const d of drivers) {
      const car = new PlayerCar(this.physics, null);
      car.params.maxSpeed = this.speedCap;
      car.surfaceGrip = surfaceGrip; // same ground as the player's car in the game
      car.resetTo(0, START_LANE, 0);
      const driver = 'weights' in d ? new AiDriver(d) : d;
      driver.reset(car.d);
      this.ghosts.push({
        car,
        driver,
        alive: true,
        result: { distance: 0, crashed: false, finishTime: null, contacts: 0 },
        progressS: 0,
        progressT: 0,
        laneChanges: 0,
        lane: START_LANE,
        touching: new Map(),
      });
    }
    this.traffic.reset({ sLead: 0, sTail: 0, vLead: 0, raceTime: 0 }, (f) => this.occupants(f));
    this.boxes = this.traffic.ourBoxes(this.boxes);
  }

  get done(): boolean {
    return this.time >= this.timeLimit || !this.ghosts.some((g) => g.alive);
  }

  get aliveCount(): number {
    let n = 0;
    for (const g of this.ghosts) if (g.alive) n++;
    return n;
  }

  /** The car in front (alive), or the one that got furthest once all are out. */
  leader(): Ghost | null {
    let best: Ghost | null = null;
    for (const g of this.ghosts) if (g.alive && (!best || g.car.s > best.car.s)) best = g;
    if (best) return best;
    for (const g of this.ghosts) if (!best || g.result.distance > best.result.distance) best = g;
    return best;
  }

  /** Advance one fixed physics step. */
  step(): void {
    if (this.done) return;
    const dt = PHYSICS_DT;
    for (const g of this.ghosts) {
      if (!g.alive) continue;
      g.car.prePhysics(g.driver.drive(selfStateOf(g.car, this.speedCap), this.boxes, g.car.params), dt);
    }
    this.traffic.stepAI(dt, this.time, (frame) => (this.trafficSeesCars ? this.carObstacles(frame) : []));
    this.physics.step((a, b) => {
      this.traffic.onNpcContact(a, b);
    });
    for (const g of this.ghosts) if (g.alive) g.car.postPhysics();
    this.traffic.afterPhysics();
    this.time += dt;
    this.boxes = this.traffic.ourBoxes(this.boxes);
    for (const g of this.ghosts) if (g.alive) this.judge(g);
    const focus = this.focus();
    if (focus) this.traffic.maintain(dt, focus, (f) => this.occupants(f));
  }

  /**
   * Lanes the live ghosts take up, so traffic is never spawned on top of one
   * (traffic still drives as if they were not there).
   */
  occupants(frame: RoadFrame): Occupant[] {
    const out: Occupant[] = [];
    for (const g of this.ghosts) {
      if (!g.alive) continue;
      const c = g.car;
      const s = frame.fromWorld(c.d, -c.s).s;
      for (const lane of lanesOccupied(c.d - CAR_HALF_W, c.d + CAR_HALF_W)) out.push({ s, lane, length: PLAYER_L, v: Math.max(0, c.speed) });
    }
    return out;
  }

  /** The live ghosts as the traffic sees the player in the game (with `trafficSeesCars`). */
  private carObstacles(frame: RoadFrame): Obstacle[] {
    const out: Obstacle[] = [];
    this.ghosts.forEach((g, i) => {
      if (!g.alive) return;
      const t = g.car.body.translation();
      const v = g.car.body.linvel();
      const f = OUR_FRAME.forwardWorld(g.car.yaw);
      out.push({ ...boxToFrame(frame, { x: t.x, z: t.z, fx: f.x, fz: f.z, w: PLAYER_W, l: PLAYER_L, vx: v.x, vz: v.z }), id: -1000 - i, isPlayer: true });
    });
    return out;
  }

  private judge(g: Ghost): void {
    const c = g.car;
    g.result.distance = Math.max(g.result.distance, c.s);
    // Velocity in road coordinates (yaw > 0 turns toward +d; vLat is to the car's right).
    const vS = c.vLong * Math.cos(c.yaw) - c.vLat * Math.sin(c.yaw);
    const vD = c.vLong * Math.sin(c.yaw) + c.vLat * Math.cos(c.yaw);
    const own = ownLane(c.d, vD);
    if (own !== null && own !== g.lane) {
      g.laneChanges++;
      g.lane = own;
    }
    if (c.s >= ROAD_LENGTH) {
      g.result.finishTime = this.time;
      this.retire(g);
      return;
    }
    const contact = isOffRoad(c.s, c.d, c.yaw) ? 'crash' : judgeContacts(touching(c.s, c.d, c.yaw, this.boxes, own, this.touched), vS, vD, this.time, g.touching);
    if (contact === 'crash') {
      g.result.crashed = true;
      this.retire(g);
    } else {
      g.result.contacts = (g.result.contacts ?? 0) + contact;
      if (c.s - g.progressS >= FITNESS.stallMinProgress) {
        g.progressS = c.s;
        g.progressT = this.time;
      } else if (this.time - g.progressT > FITNESS.stallWindow) this.retire(g);
    }
  }

  /** Out of the race: the body stops simulating (no more cost) but keeps its last pose for drawing. */
  private retire(g: Ghost): void {
    g.alive = false;
    g.car.body.setEnabled(false);
  }

  private focus(): TrafficFocus | null {
    let lead: Ghost | null = null;
    let tail = Infinity;
    for (const g of this.ghosts) {
      if (!g.alive) continue;
      if (!lead || g.car.s > lead.car.s) lead = g;
      tail = Math.min(tail, g.car.s);
    }
    return lead ? { sLead: lead.car.s, sTail: tail, vLead: lead.car.speed, raceTime: this.time } : null;
  }

  dispose(): void {
    this.traffic.dispose();
    if (this.ownPool) this.scene.remove(this.ownPool.mesh);
    this.physics.free();
  }
}
