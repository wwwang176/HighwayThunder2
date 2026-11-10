import RAPIER from '@dimforge/rapier3d-compat';
import { KMH, LANE_COUNT, LANE_WIDTH, PHYSICS_DT } from '../src/config';
import { laneCenter } from '../src/road/coords';
import { PlayerCar } from '../src/vehicles/playerCar';
import { CARS } from '../src/vehicles/cars';
import type { Brain } from '../src/ai/brain';
import { selfStateOf } from '../src/ai/driver';
import { baseSteer, netDrive } from '../src/ai/netTracker';
import { lateralTurn, maxAccel, Plan, planAt, PLANNER } from '../src/ai/planner';
import { TrainingSim } from '../src/ai/trainingSim';
import { planPedals, PlannerDriver } from '../src/ai/plannerDriver';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import type { Rng } from '../src/ai/rng';
import { openGround } from './openGround';

/**
 * The tracker training's exams (training/tracker.train.ts): its settings, the open-ground scenarios, the crash
 * aftermath, the race - run in the training itself and in its worker threads (trackerWorker.ts) alike. Settings come
 * from the environment (a worker thread has the same).
 */

/** Physics and the planner set up as the training has them (once a thread). */
export async function initExams(): Promise<void> {
  await RAPIER.init();
  Object.assign(PLANNER, { step: 0.25, cellsPerLane: 8, maxLateral: 6, latGrip: 1 });
  if (process.env.PLANNER_JSON) Object.assign(PLANNER, JSON.parse(process.env.PLANNER_JSON));
}

export const SPEC = CARS[process.env.CAR ?? 'street-racer'];
if (!SPEC) throw new Error(`no car "${process.env.CAR}" (have: ${Object.keys(CARS).join(', ')})`);
/** Fastest a scenario runs (km/h): the car's own top speed, at most 300. */
export const TOP_KMH = Math.min(300, SPEC.params.maxSpeed / KMH);
export const SCENARIO_S = 8; // s each
export const PER_GEN = Number(process.env.SCENARIOS ?? 4);
export const VALIDATION = 8;
export const CHATTER = 0.002; // cost per unit of wheel input change per step
export const SPIN_SLIP = 0.35; // rad of body slip (cornering.train.ts) or...
export const SPIN_YAW = 0.7; // ...heading off the road: spun
export const RECOVERY = Number(process.env.RECOVERY ?? 1); // a generation
export const RECOVERY_WEIGHT = Number(process.env.RECOVERY_WEIGHT ?? 0.3);
export const RECOVERY_S = 8;
export const RECOVERY_VALIDATION = (process.env.RECOVERY_VALIDATION ?? '60,-60,120,-120').split(',').map(Number); // deg off the road's heading
/** ...each at each of these (x, m across: the lanes' centres +-1.875, +-5.625; the median's grass -10..-20). */
export const RECOVERY_VALIDATION_X = (process.env.RECOVERY_VALIDATION_X ?? '1.875').split(',').map(Number);
/** Where across a generation's crash leaves it (x, m, from..to): by default always the same lane's centre. */
export const RECOVERY_X_FROM = Number(process.env.RECOVERY_X_FROM ?? 1.875);
export const RECOVERY_X_TO = Number(process.env.RECOVERY_X_TO ?? RECOVERY_X_FROM);
export const AWAY_YAW = (15 * Math.PI) / 180;
export const AWAY_V = 40 * KMH;
export const AWAY_HOLD = 1; // s
export const DONUT = 4 * Math.PI; // rad turned in all
export const NOT_AWAY = RECOVERY_S + 4;
export const LAG_AFTER = 0.75; // s after a plan its position is checked (as the benchmark's tracking)
export const LAG_WEIGHT = Number(process.env.LAG_WEIGHT ?? 1);
export const DRIVE_GUARD = Number(process.env.DRIVE_GUARD ?? 20);
export const DRIVE_EPS = Number(process.env.DRIVE_EPS ?? 0.05);
export const RACE_TRAIN = Number(process.env.RACE_TRAIN ?? 1); // race exams a generation
export const RACE_TRAIN_S = Number(process.env.RACE_TRAIN_S ?? 20);
export const RACE_WEIGHT = Number(process.env.RACE_WEIGHT ?? 1);
export const RESET_COST = Number(process.env.RESET_COST ?? 3);
/** The validation's races (one was noise enough to fire the driving guard on brains that raced no worse). */
export const RACE_VALIDATION_SEEDS = (process.env.RACE_VALIDATION_SEEDS ?? '9001').split(',').map(Number);
export const RACE_SEEDS = (process.env.RACE_SEEDS ?? '8101,8102,8103,8104,8105,8106').split(',').map(Number);
export const RACE_S = Number(process.env.RACE_S ?? 45);
export const RACE_KEEP = Number(process.env.RACE_KEEP ?? 0.97); // of the start's distance at least
export const RACE_RESETS = Number(process.env.RACE_RESETS ?? 1.3); // times the start's resets at most (+2)
/**
 * Share of scenarios from a standstill (the race's start): half of them held on the line revving first (the game's
 * countdown burnout, 1-3 s), flat out; the targets as any scenario's. The scenarios otherwise start at 40 km/h or
 * more, and the race exam's one start in 20 s weighs next to nothing: the networks pulled to one side pulling away
 * (the street racer's: 0.4 left at once, 4 deg, half a metre by 1.5 s; the plain tracker dead straight).
 */
export const LAUNCH = Number(process.env.LAUNCH ?? 0);
/** Off-the-plan cost times this over a launch's first LAUNCH_S s (1: scored as the rest). */
export const LAUNCH_WEIGHT = Number(process.env.LAUNCH_WEIGHT ?? 1);
export const LAUNCH_S = 4;

export interface Scenario {
  v: number;
  /** [time, lateral target] */
  targets: [number, number][];
  /** [time, target speed] (m/s): it speeds up flat out and slows, changing lanes as it goes - as in a race. */
  speeds: [number, number][];
  /** s held on the line revving before it goes (from a standstill only). */
  hold?: number;
}

/** How much progress counts against wheel tracking: taking the throttle back must not just slow it down. */
export const PROGRESS = 0.01; // cost per metre

export function scenario(rng: Rng): Scenario {
  const launch = LAUNCH > 0 && rng() < LAUNCH;
  const v = launch ? 0 : (40 + rng() * (TOP_KMH - 40)) * KMH;
  const targets: [number, number][] = [];
  const lo = laneCenter(0);
  const hi = laneCenter(LANE_COUNT - 1);
  for (let t = 0; t < SCENARIO_S; t += 0.6 + rng() * 1.9) {
    // Lane centres mostly; else anywhere on the eighth-lane grid (a gap between two cars).
    const d = rng() < 0.6 ? laneCenter(Math.floor(rng() * LANE_COUNT)) : lo + Math.round((rng() * (hi - lo)) / (LANE_WIDTH / 8)) * (LANE_WIDTH / 8);
    targets.push([t, d]);
  }
  const speeds: [number, number][] = [[0, (60 + rng() * (TOP_KMH - 60)) * KMH]];
  for (let t = 2 + rng() * 2; t < SCENARIO_S; t += 2 + rng() * 2) speeds.push([t, (50 + rng() * (TOP_KMH - 50)) * KMH]);
  if (launch) {
    speeds[0][1] = TOP_KMH * KMH;
    return { v, targets, speeds, hold: rng() < 0.5 ? 0 : 1 + rng() * 2 };
  }
  return { v, targets, speeds };
}

export const targetAt = (sc: Scenario, t: number) => {
  let d = sc.targets[0][1];
  for (const [at, x] of sc.targets) if (at <= t) d = x;
  return d;
};

export const speedAt = (sc: Scenario, t: number) => {
  let v = sc.speeds[0][1];
  for (const [at, x] of sc.speeds) if (at <= t) v = x;
  return v;
};

/**
 * A plan from (s, d, vD) at speed v toward lateral `target` the way the planner moves: whole cells
 * a step, the change in sideways move each step within what the car's grip allows (`lateralTurn`),
 * as fast as it can while still able to stop on the target.
 */
export function movePlan(s: number, d: number, vD: number, v: number, target: number, vTarget = v): Plan {
  const dt = PLANNER.step;
  const cell = LANE_WIDTH / PLANNER.cellsPerLane;
  const turn = Math.min(lateralTurn(v, dt, cell, SPEC.ai.latAccel), 6);
  const maxLat = PLANNER.maxLateral;
  let lat = Math.max(-maxLat, Math.min(maxLat, (vD * dt) / cell));
  const first = laneCenter(0) - 2 * cell * PLANNER.cellsPerLane; // any cell boundary works: positions are relative
  let c = Math.round((d - first) / cell);
  const goal = Math.round((target - first) / cell);
  // Cells still covered while slowing from `m` a step to a stop.
  const stopping = (m: number) => {
    let sum = 0;
    for (let x = Math.abs(m) - turn; x > 0; x -= turn) sum += x;
    return sum;
  };
  const points = [{ t: 0, s, d, v }];
  let speed = v;
  let along = s;
  for (let k = 1; k <= Math.round(3 / dt); k++) {
    // Toward the target speed: flat out up, the planner's soft brake down.
    const dv = vTarget - speed;
    const was = speed;
    speed += dv > 0 ? Math.min(dv, maxAccel(speed, SPEC.ai.accel) * dt) : Math.max(dv, -PLANNER.softBrake * dt);
    along += ((was + speed) / 2) * dt;
    const rest = goal - c;
    let best = NaN;
    for (let m = Math.ceil(lat - turn - 0.01); m <= Math.floor(lat + turn + 0.01); m++) {
      if (Math.abs(m) > maxLat) continue;
      // Toward the goal as fast as it can without passing it (counting the cells it takes to stop).
      const reach = m + Math.sign(m) * stopping(m);
      const ok = rest >= 0 ? reach <= rest : reach >= rest;
      if (ok && (Number.isNaN(best) || (rest >= 0 ? m > best : m < best))) best = m;
    }
    // Nothing stops in time: brake sideways as hard as it may.
    if (Number.isNaN(best)) best = rest >= 0 ? Math.max(-maxLat, Math.ceil(lat - turn - 0.01)) : Math.min(maxLat, Math.floor(lat + turn + 0.01));
    c += best;
    lat = best;
    points.push({ t: k * dt, s: along, d: first + c * cell, v: speed });
  }
  return { points };
}

export interface Run {
  car: PlayerCar;
  brain: Brain | null; // null: the plain tracker
  plan: Plan | null;
  madeAt: number;
  cost: number;
  /** Of the cost, what LAUNCH_WEIGHT added (the driving guard leaves it out: a better launch buys no worse driving). */
  launch: number;
  out: boolean;
  lastSteer: number;
  errs: number[];
  /** Plans made, to check LAG_AFTER s on. */
  recent: { plan: Plan; t: number }[];
  lags: number[];
}

/** Every brain (and the plain tracker, last) through the scenarios together; cost per brain, and the runs' errors. */
export function evaluate(brains: (Brain | null)[], scenarios: Scenario[], keepErrors = false): { cost: number[]; errs: number[][]; lags: number[][]; launch: number[] } {
  const physics = openGround();
  physics.timestep = PHYSICS_DT;
  const runs: Run[] = brains.map((brain) => ({ car: new PlayerCar(physics, null, { spec: SPEC }), brain, plan: null, madeAt: 0, cost: 0, launch: 0, out: false, lastSteer: 0, errs: [], recent: [], lags: [] }));
  const cap = SPEC.params.maxSpeed;
  for (const r of runs) r.car.params.maxSpeed = cap;
  for (const sc of scenarios) {
    const lane = Math.floor(LANE_COUNT / 2);
    for (const r of runs) {
      r.car.body.setEnabled(true);
      r.car.resetTo(0, lane, sc.v);
      r.plan = null;
      r.out = false;
      r.lastSteer = 0;
      r.recent = [];
    }
    if (sc.hold) {
      // On the line revving, held to its spot (the game's countdown), then let go.
      for (const r of runs) r.car.holdInPlace(true);
      for (let i = 0; i < Math.round(sc.hold / PHYSICS_DT); i++) {
        for (const r of runs) r.car.prePhysics({ steer: 0, throttle: 1, brake: 1 }, PHYSICS_DT);
        physics.step(() => {});
        for (const r of runs) r.car.postPhysics();
      }
      for (const r of runs) r.car.holdInPlace(false);
    }
    const steps = Math.round(SCENARIO_S / PHYSICS_DT);
    for (let i = 0; i < steps; i++) {
      const t = i * PHYSICS_DT;
      for (const r of runs) {
        if (r.out) continue;
        const self = selfStateOf(r.car, cap);
        if (!r.plan || t - r.madeAt >= 0.25 - 1e-9) {
          const vD = self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw);
          r.plan = movePlan(self.s, self.d, vD, Math.max(5, self.vLong), targetAt(sc, t), speedAt(sc, t));
          r.madeAt = t;
          r.recent.push({ plan: r.plan, t });
        }
        const age = t - r.madeAt;
        const pedals = planPedals(r.plan, age, self.vLong, SPEC.ai.accel);
        let steer: number;
        if (r.brain) {
          const net = netDrive(r.brain, r.plan, age, self, r.car.params, pedals.throttle);
          steer = net.steer;
          pedals.throttle = net.throttle;
          if (net.across) pedals.brake = 0; // (as PlannerDriver)
        } else steer = baseSteer(r.plan, age, self, r.car.params);
        r.car.prePhysics({ steer, ...pedals }, PHYSICS_DT);
        r.cost += CHATTER * Math.abs(steer - r.lastSteer);
        r.lastSteer = steer;
      }
      physics.step(() => {});
      for (const r of runs) {
        if (r.out) continue;
        r.car.postPhysics();
        const age = t + PHYSICS_DT - r.madeAt;
        const pts = r.plan!.points;
        // Off the plan now (linear between its points).
        const k = Math.min(pts.length - 2, Math.floor(age / PLANNER.step));
        const u = Math.min(1, (age - pts[k].t) / (pts[k + 1].t - pts[k].t));
        const err = r.car.d - (pts[k].d + (pts[k + 1].d - pts[k].d) * u);
        const w = sc.v === 0 && t < LAUNCH_S ? LAUNCH_WEIGHT : 1; // (a launch's first seconds)
        r.cost += w * err * err * PHYSICS_DT;
        r.launch += (w - 1) * err * err * PHYSICS_DT;
        if (keepErrors) r.errs.push(err);
        const now = t + PHYSICS_DT;
        while (r.recent.length && now - r.recent[0].t >= LAG_AFTER - 1e-9) {
          const old = r.recent.shift()!;
          if (now - old.t > LAG_AFTER + PHYSICS_DT) continue;
          const lag = r.car.d - planAt(old.plan, LAG_AFTER).d;
          r.cost += w * LAG_WEIGHT * lag * lag * 0.25; // (one a replan: 0.25 s of it)
          r.launch += (w - 1) * LAG_WEIGHT * lag * lag * 0.25;
          if (keepErrors) r.lags.push(lag);
        }
        const slip = Math.abs(Math.atan2(r.car.vLat, Math.max(1, r.car.vLong)));
        if (slip > SPIN_SLIP || Math.abs(r.car.yaw) > SPIN_YAW) {
          r.out = true;
          r.cost += 10 * (SCENARIO_S - t); // spun: the worst of all
          r.car.body.setEnabled(false);
        }
      }
    }
    for (const r of runs) r.cost -= PROGRESS * r.car.s; // the way it got
  }
  physics.free();
  return { cost: runs.map((r) => r.cost / scenarios.length), errs: runs.map((r) => r.errs), lags: runs.map((r) => r.lags), launch: runs.map((r) => r.launch / scenarios.length) };
}

/** A crash's aftermath: how far off the road's heading (rad, either way) it stands. */
export const recoveryHeading = (rng: Rng) => ((rng() < 0.5 ? -1 : 1) * (30 + rng() * 120) * Math.PI) / 180;

/** Where a crash left it: heading off the road's (rad) and where across the road (x, m). */
export interface RecoveryStart {
  yaw: number;
  x: number;
}

/** A generation's crash: a heading, and somewhere between RECOVERY_X_FROM and _TO. */
export function recoveryStart(rng: Rng): RecoveryStart {
  const yaw = recoveryHeading(rng);
  return { yaw, x: RECOVERY_X_TO > RECOVERY_X_FROM ? RECOVERY_X_FROM + rng() * (RECOVERY_X_TO - RECOVERY_X_FROM) : RECOVERY_X_FROM };
}

/**
 * Every brain (and the plain tracker for null) driving off from standing across the road at each of `starts`
 * (a heading, a place across), on the road with its rails, with the game's planner (PlannerDriver): its cost per
 * brain, the mean of the starts'.
 */
export function recoveryCost(brains: (Brain | null)[], starts: RecoveryStart[]): number[] {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const cars = brains.map(() => new PlayerCar(physics, null, { spec: SPEC }));
  const cap = SPEC.params.maxSpeed;
  const cost = brains.map(() => 0);
  const lane = Math.floor(LANE_COUNT / 2);
  for (const { yaw: a, x } of starts) {
    for (const car of cars) {
      car.body.setEnabled(true);
      car.resetTo(100, lane, 0);
      car.body.setTranslation({ ...car.body.translation(), x }, true);
      car.body.setRotation({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }, true);
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    for (let i = 0; i < Math.round(0.5 / PHYSICS_DT); i++) { // settled on its springs, standing
      for (const car of cars) car.prePhysics({ steer: 0, throttle: 0, brake: 1 }, PHYSICS_DT);
      physics.step(() => {});
      for (const car of cars) car.postPhysics();
    }
    const runs = brains.map((brain, k) => {
      const driver = new PlannerDriver();
      driver.accel = SPEC.ai.accel;
      driver.latAccel = SPEC.ai.latAccel;
      driver.tracker = brain;
      return { car: cars[k], driver, start: cars[k].yaw, rotation: 0, overshoot: 0, awayAt: NaN, since: NaN, out: false };
    });
    for (let i = 0; i < Math.round(RECOVERY_S / PHYSICS_DT); i++) {
      const t = i * PHYSICS_DT;
      for (const r of runs) if (!r.out) r.car.prePhysics(r.driver.drive(selfStateOf(r.car, cap), [], r.car.params), PHYSICS_DT);
      physics.step(() => {});
      for (const r of runs) {
        if (r.out) continue;
        const c = r.car;
        c.postPhysics();
        r.rotation += Math.abs(c.yawRate) * PHYSICS_DT;
        if (Math.sign(c.yaw) === -Math.sign(r.start)) r.overshoot = Math.max(r.overshoot, Math.abs(c.yaw));
        const ok = Math.abs(c.yaw) < AWAY_YAW && c.vLong > AWAY_V;
        if (!ok) r.since = NaN;
        else if (Number.isNaN(r.since)) r.since = t;
        if (!Number.isNaN(r.since) && t - r.since >= AWAY_HOLD) {
          r.awayAt = r.since; // away: done
          r.out = true;
        } else if (r.rotation > DONUT) r.out = true; // round and round: done
        if (r.out) c.body.setEnabled(false);
      }
    }
    runs.forEach((r, k) => {
      cost[k] += (Number.isNaN(r.awayAt) ? NOT_AWAY : r.awayAt) + Math.max(0, r.rotation - Math.abs(r.start)) / Math.PI + r.overshoot / (Math.PI / 2);
    });
  }
  physics.free();
  return cost.map((c) => c / starts.length);
}

/** One brain (null: the plain tracker) racing alone on `seed` for `seconds`, as in the game (traffic gives way to it). */
function raceOnce(b: Brain | null, seed: number, seconds: number) {
  const driver = new PlannerDriver();
  driver.accel = SPEC.ai.accel;
  driver.latAccel = SPEC.ai.latAccel;
  driver.tracker = b;
  const stats = driver.measure();
  const sim = new TrainingSim([driver], seed, { spec: SPEC, speedCap: 300 * KMH, trafficSeesCars: true, resetOnCrash: 60 * KMH, timeLimit: seconds });
  while (!sim.done) sim.step();
  const r = sim.ghosts[0].result;
  sim.dispose();
  return { distance: r.distance, resets: r.resets ?? 0, lags: [...stats.lateralMoving, ...stats.lateralHolding] };
}

/**
 * Every brain (null: the plain tracker) racing from the start on `seed` for RACE_TRAIN_S s, each alone with the same
 * traffic (as the benchmark: none sees another's traffic change), the game's planner and emergency brake: its cost.
 */
export function raceCost(brains: (Brain | null)[], seed: number): number[] {
  return brains.map((b) => {
    const r = raceOnce(b, seed, RACE_TRAIN_S);
    let c = 0;
    for (const lag of r.lags) c += LAG_WEIGHT * lag * lag * 0.25;
    return c - PROGRESS * r.distance + RESET_COST * r.resets;
  });
}

/** A brain (null: the plain tracker) racing `seeds` (the gate's: RACE_SEEDS) for RACE_S s each: metres covered, resets. */
export function race(b: Brain | null, seeds = RACE_SEEDS): { distance: number; resets: number } {
  let distance = 0;
  let resets = 0;
  for (const seed of seeds) {
    const r = raceOnce(b, seed, RACE_S);
    distance += r.distance;
    resets += r.resets;
  }
  return { distance, resets };
}
