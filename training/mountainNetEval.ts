import RAPIER from '@dimforge/rapier3d-compat';
import type { Brain } from '../src/ai/brain';
import { selfStateOf } from '../src/ai/driver';
import { MountainPlannerDriver } from '../src/ai/mountainPlannerDriver';
import { mulberry32 } from '../src/ai/rng';
import { KMH, PHYSICS_DT } from '../src/config';
import { type RaceView, Rivals } from '../src/game/rivals';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { MOUNTAIN, roadEdges, mountainRoad } from '../src/road/mountain';
import { surfaceMesh } from '../src/road/surface';
import { CARS, STREET_RACER } from '../src/vehicles/cars';
import type { CarSpec } from '../src/vehicles/cars/types';
import { PlayerCar } from '../src/vehicles/playerCar';
import { mountainAi, mountainSetup, mountainSetupOf } from '../src/vehicles/mountainSetup';

/**
 * The exams of the mountain driving network's training (mountainNet.train.ts; docs/superpowers/plans/
 * 2026-11-16-mountain-planner-net.md Task 6): a brain on a car of `spec` driving the mountain planner driver on a
 * random mountain road (seed), alone or from the grid with three rivals (the planner driver, no network), for
 * `seconds`. Its cost:
 *   - how far it lags its plan: every 0.25 s, following its line, (its d - the plan made 0.75 s before, there)^2 x 0.25
 *     (against the plan just made from where it is a car slow to follow pays nothing - the highway's lesson);
 *   - WALL_COST a wall contact (a contact this far apart from the last, CONTACT_GAP s, one);
 *   - RESET_COST a put-back (under the road, or stuck STUCK_S s), FELL_COST if NaN (and it ends);
 *   - less METRE_GAIN a metre covered.
 * Other cars' contacts cost nothing: a street race (the user's).
 */

const WALL_COST = 5;
const RESET_COST = 5;
const FELL_COST = 20;
const METRE_GAIN = 0.01;
const CONTACT_GAP = 0.5;
const STUCK_S = 3;
const LAG_AFTER = 0.75;
const SAMPLE = 0.25;
/** A plan's path sampled this far ahead (m), every metre. */
const SNAP_AHEAD = 60;
const BUDGET = 0.9;
const LANE = MOUNTAIN.halfWidth / 2;
const GRID: [number, number][] = [
  [-LANE, -3],
  [LANE, -11],
  [-LANE, -11],
];
const RIVAL_CARS = [STREET_RACER, CARS['muscle-car'] ?? STREET_RACER, CARS.jdm ?? STREET_RACER];

export async function initEval(): Promise<void> {
  await RAPIER.init();
}

export interface RunResult {
  cost: number;
  /** Its summed lag cost, wall contacts (of them following its line), put-backs, metres, finish time (null: not in time). */
  lag: number;
  walls: number;
  lineWalls: number;
  resets: number;
  metres: number;
  time: number | null;
  nan: boolean;
}

/** One run: `brain` (null: none) driving a `spec` car on road `seed` for `seconds`, alone or with rivals. */
export function runOnce(brain: Brain | null, spec: CarSpec, seed: number, seconds: number, rivalsToo: boolean): RunResult {
  const road = mountainRoad(mulberry32(seed));
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const e = roadEdges(road);
  physics.setRoad(road, { rails: { left: (s) => -e.at(s, -1), right: (s) => e.at(s, 1) }, ground: surfaceMesh(road, -MOUNTAIN.before, MOUNTAIN.length + MOUNTAIN.after, (s) => [-e.at(s, -1) - 1.5, e.at(s, 1) + 1.5]) });
  const car = new PlayerCar(physics, null, { spec, entity: { type: 'player' } });
  car.road = road;
  Object.assign(car.params, mountainSetup(car.params, mountainSetupOf(spec.id)));
  car.resetAt(-3, LANE, 0);
  const driver = new MountainPlannerDriver();
  driver.budget = BUDGET;
  driver.setRoad(road, mountainAi(spec.ai, mountainSetupOf(spec.id)));
  driver.net = brain;
  const rivals = new Rivals<MountainPlannerDriver>(physics, null, () => null, rivalsToo ? RIVAL_CARS : [], {
    makeDriver: () => new MountainPlannerDriver(),
    grid: GRID,
    gripBoost: 0,
    edge: (s, side) => e.at(s, side),
    lanes: [LANE, -LANE],
    setup: { params: (p, sp) => mountainSetup(p, mountainSetupOf(sp.id)), ai: (ai, sp) => mountainAi(ai, mountainSetupOf(sp.id)) },
  });
  rivals.length = MOUNTAIN.length;
  rivals.setRoad(road);
  for (const r of rivals.list) {
    r.driver.budget = BUDGET;
    r.driver.net = null; // (the brain's car's alone: its rivals as they are without one)
  }
  rivals.place();

  const res: RunResult = { cost: 0, lag: 0, walls: 0, lineWalls: 0, resets: 0, metres: 0, time: null, nan: false };
  const snaps: { t: number; s0: number; d: Float32Array }[] = [];
  let lastWall = -Infinity;
  let stuck = 0;
  let time = 0;
  let nextSample = 0;
  const steps = Math.round(seconds / PHYSICS_DT);
  for (let step = 0; step < steps; step++) {
    const view: RaceView = { player: car, traffic: [], speedCap: 300 * KMH, raceTime: time };
    rivals.drive(PHYSICS_DT, view);
    car.prePhysics(driver.drive(selfStateOf(car, car.params.maxSpeed), rivals.boxes(), car.params), PHYSICS_DT);
    physics.step((a, b, normal) => {
      if (!normal) return;
      const mine = a.type === 'player' ? b : b.type === 'player' ? a : null;
      if (!mine || mine.type !== 'static') return;
      if (time - lastWall > CONTACT_GAP) {
        res.walls++;
        if (!driver.inner.inDrift()) res.lineWalls++;
      }
      lastWall = time;
    });
    car.postPhysics();
    time += PHYSICS_DT;
    rivals.after(PHYSICS_DT, view, []);
    const p = car.body.translation();
    if (![p.x, p.y, p.z].every(Number.isFinite)) {
      res.nan = true;
      break;
    }
    // (put back as the game's: under the road, or stuck)
    stuck = car.speed < 2 ? stuck + PHYSICS_DT : 0;
    if (p.y < road.height(car.s) - 5 || stuck > STUCK_S) {
      car.resetAt(car.s, LANE, 15);
      driver.reset(LANE);
      res.resets++;
      stuck = 0;
      snaps.length = 0;
    }
    if (res.time === null && car.s >= MOUNTAIN.length) {
      res.time = time;
      break;
    }
    if (time < nextSample) continue;
    nextSample += SAMPLE;
    if (driver.inner.inDrift()) {
      snaps.length = 0; // (a drift: its plans before it are no measure after)
      continue;
    }
    // Its lag against the plan made LAG_AFTER s before (sampled then along its path), and this plan's sample.
    const old = snaps.find((x) => time - x.t >= LAG_AFTER - 1e-6);
    if (old) {
      const k = Math.round(car.s - old.s0);
      if (k >= 0 && k < old.d.length) res.lag += SAMPLE * (car.d - old.d[k]) ** 2;
    }
    while (snaps.length && time - snaps[0].t >= LAG_AFTER - 1e-6 && snaps.length > 1 && time - snaps[1].t >= LAG_AFTER - 1e-6) snaps.shift();
    const plan = driver.mplan;
    if (plan) {
      const d = new Float32Array(SNAP_AHEAD + 1);
      for (let i = 0; i <= SNAP_AHEAD; i++) d[i] = driver.inner.pathRefAt(car.s + i) + plan.offsetAt(car.s + i);
      snaps.push({ t: time, s0: car.s, d });
    }
  }
  res.metres = Math.max(0, car.s + 3);
  physics.free();
  res.cost = res.lag + WALL_COST * res.walls + RESET_COST * res.resets + (res.nan ? FELL_COST : 0) - METRE_GAIN * res.metres;
  return res;
}

/** Several runs summed (each brain's exam): `seeds` alone and `raceSeeds` from the grid with rivals. */
export function examine(brain: Brain | null, spec: CarSpec, seeds: number[], soloS: number, raceSeeds: number[], raceS: number): RunResult {
  const sum: RunResult = { cost: 0, lag: 0, walls: 0, lineWalls: 0, resets: 0, metres: 0, time: null, nan: false };
  const add = (r: RunResult) => {
    sum.cost += r.cost;
    sum.lag += r.lag;
    sum.walls += r.walls;
    sum.lineWalls += r.lineWalls;
    sum.resets += r.resets;
    sum.metres += r.metres;
    sum.time = r.time === null || sum.time === null ? (sum.time ?? r.time) : sum.time + r.time;
    sum.nan ||= r.nan;
  };
  for (const s of seeds) add(runOnce(brain, spec, s, soloS, false));
  for (const s of raceSeeds) add(runOnce(brain, spec, s, raceS, true));
  return sum;
}
