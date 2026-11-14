import { KMH, PHYSICS_DT, ROAD_LENGTH } from '../config';
import { closingSpeed, knocksOut } from '../game/contact';
import { PhysicsWorld } from '../physics/physicsWorld';
import { laneAt, laneCenter, lanesOccupied, surfaceGrip } from '../road/coords';
import { boxToFrame, OUR_FRAME, type RoadFrame } from '../road/frame';
import type { Occupant } from '../traffic/spawner';
import type { Obstacle } from '../traffic/trafficAI';
import { TrafficFocus, TrafficWorld } from '../sim/trafficWorld';
import { PlayerCar } from '../vehicles/playerCar';
import type { Brain } from './brain';
import { AiDriver, Driver, selfStateOf } from './driver';
import { endOn, FITNESS, isOffRoad, RunResult, touching } from './fitness';
import { mulberry32 } from './rng';
import type { TrafficBox } from './sensors';
import { computeResetSpot } from '../game/reset';
import { STREET_RACER } from '../vehicles/cars';
import type { CarSpec } from '../vehicles/cars';
import { aiTopSpeed } from './aiTopSpeed';

const START_LANE = 1;
/** Settled in a lane: this close to its centre (m) and moving across slower than SETTLED_SIDEWAYS (m/s). */
const HOLDING_LANE_TOLERANCE = 0.5;
const SETTLED_SIDEWAYS = 1;
/**
 * With gameContact: stuck - put back - once under this speed (m/s) for STUCK_TIME s (counted only after first reaching
 * it), as a rival in the game (RIVAL_TUNING.stuckSpeed / stuckTime). (60 km/h for 3 s counted the queue behind a wreck
 * too: put back into it, again and again, and a car getting round a wreck slowly.)
 */
const STUCK_SPEED = 5 * KMH;
const STUCK_TIME = 2;
/** m/s: put back at this speed with no resetOnCrash (as RESET_SPEED_RIVAL in the game). */
const STUCK_RESET_SPEED = 60 * KMH;

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
  /** Last time its body slipped past SLIDING (for RunResult.crashLog). */
  slidAt: number;
  /** With gameContact: since when it has been under STUCK_SPEED (null: not, or not yet up to it since the start). */
  slowSince: number | null;
  /** With gameContact: it has been up to STUCK_SPEED since the start. */
  rolling: boolean;
}

/** Body slip angle (rad) that counts as sliding: cornering hard and changing lanes it stays near 6°. */
const SLIDING = (10 * Math.PI) / 180;

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
 * What touching `touched` means for a car at `car` (road coordinates, moving
 * at vS, vD): a crash when a contact starts too hard - closing in faster than
 * FITNESS.lightContactSpeed the way the two meet (end-on: the speed difference
 * along the road; side-on: only the sideways speed, so sliding past while
 * brushing a side is a scrape) - or has lasted longer than
 * FITNESS.maxContactTime (driving through it), otherwise the number of new
 * light contacts. `open` (id → start time) is updated: contacts that ended are dropped.
 */
export function judgeContacts(
  touched: TrafficBox[],
  car: { s: number; d: number; yaw: number; vS: number; vD: number; w?: number; l?: number },
  time: number,
  open: Map<number, number>,
): 'crash' | number {
  let started = 0;
  const now = new Set<number>();
  for (const t of touched) {
    const id = t.id ?? -1;
    now.add(id);
    const since = open.get(id);
    if (since === undefined) {
      const closing = endOn(car.s, car.d, car.yaw, t, car.w, car.l) ? car.vS - t.v : car.vD;
      if (Math.abs(closing) > FITNESS.lightContactSpeed) return 'crash';
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
  /**
   * Traffic sees the AI cars and gives way to them, as it does the player in
   * the game (for evaluating a single driver). Off for training: dozens of
   * ghosts it all had to dodge would make a traffic jam no race has.
   */
  trafficSeesCars?: boolean;
  /** m/s: a crash does not end the run - the car is put back nearby at this speed, as a rival in the game (resets counted). */
  resetOnCrash?: number;
  /**
   * As in the game: the car has a body and hits the traffic (pushing, pushed), a hit closing in at
   * CONTACT_TUNING.npcWreckSpeed or more wrecks the vehicle, a scrape it drives on from. No crash is judged: the car
   * is put back (at resetOnCrash's speed, 60 km/h if none) only when stuck - under STUCK_SPEED for STUCK_TIME s.
   * RunResult.contacts: the vehicles it wrecked.
   */
  gameContact?: boolean;
  /** The car type every car in this run is (default the supercar); its own top speed holds if lower than `speedCap`. */
  spec?: CarSpec;
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
  private readonly resetOnCrash: number | null;
  private readonly gameContact: boolean;
  /** With gameContact: each ghost's velocity (world x/z) going into the step - a hit is judged on that, as in the game. */
  private velBefore: { x: number; z: number }[] = [];
  time = 0;
  private boxes: TrafficBox[] = [];
  /** With gameContact (investigation): each vehicle wrecked - by which ghost, when, the vehicle's box going into the
   * step, the car's place and speed along / across, the closing speed (m/s) and the contact normal (world x/z). */
  readonly wrecks: { ghost: number; time: number; box: TrafficBox | null; s: number; d: number; yaw: number; speed: number; closing: number; nx: number; nz: number }[] = [];
  private touched: TrafficBox[] = [];

  constructor(drivers: (Brain | Driver)[], seed: number, opts: TrainingSimOptions) {
    const spec = opts.spec ?? STREET_RACER;
    this.speedCap = aiTopSpeed(opts.speedCap, spec);
    this.timeLimit = opts.timeLimit ?? FITNESS.timeLimit;
    this.trafficSeesCars = opts.trafficSeesCars ?? false;
    this.resetOnCrash = opts.resetOnCrash ?? null;
    this.gameContact = opts.gameContact ?? false;
    this.physics = PhysicsWorld.createSync();
    this.physics.timestep = PHYSICS_DT;
    this.traffic = new TrafficWorld(this.physics, mulberry32(seed), { oncoming: false });
    for (const d of drivers) {
      const car = new PlayerCar(this.physics, null, { spec, ...(this.gameContact ? { entity: { type: 'rival' as const, id: this.ghosts.length } } : {}) });
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
        slidAt: -Infinity,
        slowSince: null,
        rolling: false,
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
    if (this.gameContact)
      this.ghosts.forEach((g, i) => {
        const v = g.car.body.linvel();
        this.velBefore[i] = { x: v.x, z: v.z };
      });
    this.physics.step((a, b, n) => {
      const id = this.traffic.onNpcContact(a, b);
      if (id === null || !this.gameContact) return;
      // A ghost into a vehicle (game.ts onContact): a hit wrecks it, a scrape it drives on from.
      const r = a.type === 'rival' ? a : b.type === 'rival' ? b : null;
      const npc = this.traffic.npcs.get(id);
      if (!r || !npc || npc.wrecked) return;
      const nv = npc.parts[0].body.linvel();
      if (knocksOut(this.velBefore[r.id], nv, n)) {
        this.traffic.wreck(id);
        const g = this.ghosts[r.id];
        g.result.contacts = (g.result.contacts ?? 0) + 1;
        const box = this.boxes.find((b) => b.id === id && !b.phantom) ?? null;
        this.wrecks.push({ ghost: r.id, time: this.time, box: box && { ...box }, s: g.car.s, d: g.car.d, yaw: g.car.yaw, speed: g.car.speed,
          closing: closingSpeed(this.velBefore[r.id], nv, n), nx: n ? n.x : 0, nz: n ? n.z : 0 });
      }
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
      const s = frame.sOf(c.s);
      for (const lane of lanesOccupied(c.d - c.width / 2, c.d + c.width / 2)) out.push({ s, lane, length: c.length, v: Math.max(0, c.speed) });
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
      const f = OUR_FRAME.forwardWorld(g.car.yaw, g.car.s);
      out.push({ ...boxToFrame(frame, { x: t.x, z: t.z, fx: f.x, fz: f.z, w: g.car.width, l: g.car.length, vx: v.x, vz: v.z }), id: -1000 - i, isPlayer: true });
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
    const [w, l] = [c.width, c.length];
    if (Math.abs(Math.atan2(c.vLat, Math.max(1, Math.abs(c.vLong)))) > SLIDING) g.slidAt = this.time;
    if (this.gameContact) {
      this.judgeStuck(g);
      return;
    }
    const offRoad = isOffRoad(c.s, c.d, c.yaw, w, l);
    const contact = offRoad
      ? 'crash'
      : judgeContacts(touching(c.s, c.d, c.yaw, this.boxes, own, this.touched, w, l), { s: c.s, d: c.d, yaw: c.yaw, vS, vD, w, l }, this.time, g.touching);
    if (contact === 'crash') (g.result.crashLog ??= []).push({ offRoad, sliding: this.time - g.slidAt < 1, kmh: Math.hypot(vS, vD) * 3.6 });
    if (contact === 'crash' && this.resetOnCrash !== null) {
      // As a rival in the game: put back on the road nearby at a reset speed, and race on.
      const spot = computeResetSpot(c.s, c.d, this.boxes.filter((b) => !b.phantom), this.resetOnCrash);
      c.resetTo(spot.s, spot.lane, this.resetOnCrash);
      g.driver.reset(c.d);
      g.touching.clear();
      g.result.resets = (g.result.resets ?? 0) + 1;
    } else if (contact === 'crash') {
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

  /** With gameContact: put back nearby once under STUCK_SPEED for STUCK_TIME s (after first reaching it). */
  private judgeStuck(g: Ghost): void {
    const c = g.car;
    if (c.speed >= STUCK_SPEED) {
      g.rolling = true;
      g.slowSince = null;
      return;
    }
    if (!g.rolling) return;
    g.slowSince ??= this.time;
    if (this.time - g.slowSince < STUCK_TIME) return;
    const speed = this.resetOnCrash ?? STUCK_RESET_SPEED;
    (g.result.crashLog ??= []).push({ offRoad: isOffRoad(c.s, c.d, c.yaw, c.width, c.length), sliding: this.time - g.slidAt < 1, kmh: c.speed * 3.6 });
    const spot = computeResetSpot(c.s, c.d, this.boxes.filter((b) => !b.phantom), speed);
    c.resetTo(spot.s, spot.lane, speed);
    g.driver.reset(c.d);
    g.slowSince = null;
    g.result.resets = (g.result.resets ?? 0) + 1;
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
    this.physics.free();
  }
}
