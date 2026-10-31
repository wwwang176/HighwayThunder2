import * as THREE from 'three';
import { PHYSICS_DT, ROAD_LENGTH } from '../config';
import { PhysicsWorld } from '../physics/physicsWorld';
import { lanesOccupied, surfaceGrip } from '../road/coords';
import type { RoadFrame } from '../road/frame';
import type { Occupant } from '../traffic/spawner';
import { TrafficFocus, TrafficWorld } from '../sim/trafficWorld';
import { PLAYER_L, PLAYER_W, PlayerCar } from '../vehicles/playerCar';
import { WheelInstances } from '../vehicles/wheelInstances';
import type { Brain } from './brain';
import { AiDriver, selfStateOf } from './driver';
import { FITNESS, hitsTraffic, isOffRoad, RunResult } from './fitness';
import { mulberry32 } from './rng';
import type { TrafficBox } from './sensors';

const START_LANE = 1;
const CAR_HALF_W = PLAYER_W / 2;

/** One AI car in a generation. */
export interface Ghost {
  car: PlayerCar;
  driver: AiDriver;
  alive: boolean;
  result: RunResult;
  /** Last time it had made stallMinProgress metres of progress. */
  progressS: number;
  progressT: number;
}

export interface TrainingSimOptions {
  /** Top speed every car in this run is limited to (m/s); also a network input. */
  speedCap: number;
  timeLimit?: number;
  /** Where the traffic is drawn; a throwaway scene when omitted (headless runs). */
  scene?: THREE.Scene;
  wheelPool?: WheelInstances;
}

/**
 * One generation's race: a fresh physics world, traffic from `seed`, and one
 * ghost car per brain, all starting together. Ghosts don't touch each other or
 * the traffic; one is out when it hits a vehicle, leaves our pavement, stalls,
 * or finishes. Traffic ignores the ghosts and is kept around all of them.
 */
export class TrainingSim {
  readonly ghosts: Ghost[] = [];
  readonly physics: PhysicsWorld;
  readonly traffic: TrafficWorld;
  readonly speedCap: number;
  readonly timeLimit: number;
  time = 0;
  private boxes: TrafficBox[] = [];
  private readonly ownPool: WheelInstances | null;
  private readonly scene: THREE.Scene;

  constructor(brains: Brain[], seed: number, opts: TrainingSimOptions) {
    this.speedCap = opts.speedCap;
    this.timeLimit = opts.timeLimit ?? FITNESS.timeLimit;
    this.physics = PhysicsWorld.createSync();
    this.physics.timestep = PHYSICS_DT;
    this.scene = opts.scene ?? new THREE.Scene();
    this.ownPool = opts.wheelPool ? null : new WheelInstances(this.scene);
    const pool = opts.wheelPool ?? this.ownPool!;
    this.traffic = new TrafficWorld(this.physics, this.scene, pool, mulberry32(seed), { oncoming: false });
    for (const brain of brains) {
      const car = new PlayerCar(this.physics, null);
      car.params.maxSpeed = this.speedCap;
      car.surfaceGrip = surfaceGrip; // same ground as the player's car in the game
      car.resetTo(0, START_LANE, 0);
      this.ghosts.push({ car, driver: new AiDriver(brain), alive: true, result: { distance: 0, crashed: false, finishTime: null }, progressS: 0, progressT: 0 });
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
      g.car.prePhysics(g.driver.drive(selfStateOf(g.car, this.speedCap), this.boxes), dt);
    }
    this.traffic.stepAI(dt, this.time, () => []);
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

  private judge(g: Ghost): void {
    const c = g.car;
    g.result.distance = Math.max(g.result.distance, c.s);
    if (c.s >= ROAD_LENGTH) {
      g.result.finishTime = this.time;
      this.retire(g);
    } else if (isOffRoad(c.s, c.d, c.yaw) || hitsTraffic(c.s, c.d, c.yaw, this.boxes)) {
      g.result.crashed = true;
      this.retire(g);
    } else if (c.s - g.progressS >= FITNESS.stallMinProgress) {
      g.progressS = c.s;
      g.progressT = this.time;
    } else if (this.time - g.progressT > FITNESS.stallWindow) {
      this.retire(g);
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
