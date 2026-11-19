import RAPIER from '@dimforge/rapier3d-compat';
import type { Brain } from '../src/ai/brain';
import { selfStateOf } from '../src/ai/driver';
import { hairpinRuns, MOUNTAIN_DRIVER } from '../src/ai/mountainDriver';
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
 *   - less METRE_GAIN a metre covered (0.01: 3 % slower cost ~1, against tens for its lag - it learned to slow down).
 * Other cars' contacts cost nothing: a street race (the user's).
 * The drift network's (mode 'drift': the brain round the hairpins after the kick, the car's own driving network on its
 * line): its slide, not its speed (the user's: bigger looks better, no more walls; sliding into it scores too) - less
 * ANGLE_GAIN a degree of each hairpin's slide on average through it, and ENTRY_BONUS degrees' worth more for one slid
 * past ENTRY_SLIDE in its first ENTRY_SHARE; DRIFT_WALL_COST a wall contact, the put-backs as above, less
 * DRIFT_METRE_GAIN a metre. (On each hairpin's most slide alone it learned to slide late: its slide going in halved,
 * its handbrake on three times as long there - the muscle car slid late into a tenth of its hairpins.)
 */

const ANGLE_GAIN = 0.1;
const ENTRY_BONUS = 10;
const ENTRY_SLIDE = 20;
const ENTRY_SHARE = 1 / 3;
const DRIFT_WALL_COST = 10;
const DRIFT_METRE_GAIN = 0.005;
// (the driving network's: WALL_COST, METRE_GAIN and LAG_GAIN - its lag's weight - from the environment, to weigh a wall
// against time: at ~33 m/s a wall is worth WALL_COST / METRE_GAIN / 33 s - 5 / 0.05: ~3 s, and its lag's tens against
// little for time, it learned to slow down)
const WALL_COST = Number(process.env.WALL_COST ?? 5);
// (PACE='{"brakeRamp":1}': the driver's own knobs, as the bench's - set in every worker)
if (process.env.PACE) Object.assign(MOUNTAIN_DRIVER, JSON.parse(process.env.PACE));
const RESET_COST = 5;
const FELL_COST = 20;
const METRE_GAIN = Number(process.env.METRE_GAIN ?? 0.05);
const LAG_GAIN = Number(process.env.LAG_GAIN ?? 1);
/**
 * HIT_GRADE=1: a wall contact costs WALL_COST x (HIT_BRUSH + HIT_LOSS x the share of its speed it lost over the
 * HIT_WATCH s after) - a brush (5 % lost: 0.4) next to nothing, a knock (20 %: 1) as before, a crash (50 %: 2.2) more;
 * else WALL_COST each. (Each the same, it lifted for brushes too: two thirds of its contacts lost under 10 %, none stopped.)
 */
const HIT_GRADE = process.env.HIT_GRADE === '1';
const HIT_BRUSH = 0.2;
const HIT_LOSS = 4;
const HIT_WATCH = 1;
/** A wall contact just out of a drift (MountainDriver.outOfDrift: the straight after a hairpin - turned in on the throttle) costs
 * EXIT_GAIN times as much (EXIT_GAIN; 1: as any). The driving network on full throttle there brushed the inside
 * 20 times in 27 - each a brush, next to nothing graded: it did not mind them. */
const EXIT_GAIN = Number(process.env.EXIT_GAIN ?? 1);
/**
 * RUN_M (m; the driving network's exams): each run to a distance, not for a time - RUN_M for a 60 s one (in
 * proportion for another; one of WHOLE_S or more: the whole road), at most twice its time - and its speed as its time
 * out of the hairpins (their tight runs: the drift network's) plus PIN_W of its time in them, TIME_GAIN a second (and
 * a metre short of its distance as 0.2 s). (Run for a time, the way it got: a hairpin a second slower took a second
 * off the straights' running, its gain there lost in it; its time in them all left out, it might hurl itself into them
 * - PIN_W of it kept.) 0: for a time, METRE_GAIN a metre.
 */
const RUN_M = Number(process.env.RUN_M ?? 0);
const TIME_GAIN = Number(process.env.TIME_GAIN ?? 5);
const PIN_W = Number(process.env.PIN_W ?? 0.2);
const WHOLE_S = 120;
const SHORT_S_PER_M = 0.2;
const CONTACT_GAP = 0.5;
const STUCK_S = 3;
const LAG_AFTER = 0.75;
const SAMPLE = 0.25;
/** A plan's path sampled this far ahead (m), every metre. */
const SNAP_AHEAD = 60;
/** (BUDGET: its line's share of the grip, MOUNTAIN_DRIVER.budget - the game's at every difficulty) */
const BUDGET = Number(process.env.BUDGET ?? MOUNTAIN_DRIVER.budget);
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
  /** Its wall contacts graded by the speed each cost it (HIT_BRUSH + HIT_LOSS x the share lost). */
  hit: number;
  /** Of its wall contacts, those settling out of a drift. */
  exitWalls: number;
  /** Its seconds out of the hairpins and in them (RUN_M: to its distance; else in its time). */
  lineTime: number;
  pinTime: number;
  resets: number;
  metres: number;
  time: number | null;
  nan: boolean;
  /** Each hairpin's most slide (deg) summed, and the hairpins it went into... */
  angle: number;
  pins: number;
  /** ...each one's slide on average through it (deg) summed, and those it slid past ENTRY_SLIDE in its first ENTRY_SHARE. */
  mean: number;
  entered: number;
}

/** The drift network's slide score a hairpin (deg): its slide on average through them, ENTRY_BONUS more for one slid into. */
export function slideScore(r: RunResult): number {
  return (r.mean + ENTRY_BONUS * r.entered) / Math.max(1, r.pins);
}

/** Which network the brain is: the driving network on its line, or the drift network round the hairpins. */
export type NetMode = 'line' | 'drift';

/** One run: `brain` (null: none) driving a `spec` car on road `seed` for `seconds`, alone or with rivals. */
export function runOnce(brain: Brain | null, spec: CarSpec, seed: number, seconds: number, rivalsToo: boolean, mode: NetMode = 'line'): RunResult {
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
  if (mode === 'drift') driver.driftNet = brain;
  else driver.net = brain;
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
    r.driver.driftNet = null;
  }
  rivals.place();

  const res: RunResult = { cost: 0, lag: 0, walls: 0, lineWalls: 0, hit: 0, exitWalls: 0, lineTime: 0, pinTime: 0, resets: 0, metres: 0, time: null, nan: false, angle: 0, pins: 0, mean: 0, entered: 0 };
  const runs = hairpinRuns(road, 26);
  const most = runs.map(() => -1); // (each hairpin's most slide, deg; -1: not there yet)
  const through = runs.map(() => ({ sum: 0, n: 0, early: 0 })); // (in it: its slide summed a step, the steps, its most in its first ENTRY_SHARE)
  const snaps: { t: number; s0: number; d: Float32Array }[] = [];
  let lastWall = -Infinity;
  let stuck = 0;
  let time = 0;
  let nextSample = 0;
  const byDistance = mode === 'line' && RUN_M > 0;
  const whole = seconds >= WHOLE_S;
  const target = byDistance ? (whole ? MOUNTAIN.length : (RUN_M * seconds) / 60) : Infinity;
  const steps = Math.round((byDistance && !whole ? 2 * seconds : seconds) / PHYSICS_DT);
  const inPin = (s: number) => runs.some((h) => s >= h.from && s <= h.to);
  const hits: { v0: number; least: number; t: number; exit: boolean }[] = [];
  for (let step = 0; step < steps; step++) {
    const view: RaceView = { player: car, traffic: [], speedCap: 300 * KMH, raceTime: time };
    rivals.drive(PHYSICS_DT, view);
    car.prePhysics(driver.drive(selfStateOf(car, car.params.maxSpeed), rivals.boxes(), car.params), PHYSICS_DT);
    const v0 = car.speed;
    physics.step((a, b, normal) => {
      if (!normal) return;
      const mine = a.type === 'player' ? b : b.type === 'player' ? a : null;
      if (!mine || mine.type !== 'static') return;
      if (time - lastWall > CONTACT_GAP) {
        res.walls++;
        if (!driver.inner.inDrift()) res.lineWalls++;
        const exit = driver.inner.outOfDrift(); // (settling, or - drift.settle 0 - back on its line its first recover s)
        if (exit) res.exitWalls++;
        hits.push({ v0, least: v0, t: time, exit });
      }
      lastWall = time;
    });
    car.postPhysics();
    time += PHYSICS_DT;
    for (const h of hits) if (time - h.t <= HIT_WATCH) h.least = Math.min(h.least, car.speed);
    if (car.s >= 0 && car.s < target) {
      if (inPin(car.s)) res.pinTime += PHYSICS_DT;
      else res.lineTime += PHYSICS_DT;
    }
    const pi = runs.findIndex((h) => car.s >= h.from && car.s <= h.to + 15);
    if (pi >= 0) {
      const h = runs[pi];
      const slideNow = (Math.abs(Math.atan2(car.vLat, Math.max(Math.abs(car.vLong), 1))) * 180) / Math.PI;
      most[pi] = Math.max(most[pi], slideNow);
      if (car.s <= h.to) {
        const t = through[pi];
        t.sum += slideNow;
        t.n++;
        if (car.s <= h.from + ENTRY_SHARE * (h.to - h.from)) t.early = Math.max(t.early, slideNow);
      }
    }
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
    if (car.s >= target) break; // (its distance run)
    if (time < nextSample) continue;
    nextSample += SAMPLE;
    if (driver.inner.inDrift()) {
      snaps.length = 0; // (a drift: its plans before it are no measure after)
      continue;
    }
    // Its lag against the plan made LAG_AFTER s before: that plan's offsets (sampled then along its path) on its path
    // now - out of a drift the path itself eases back to the line, and sampled with its path the plan made the car pay
    // for easing back as it means to. The latest plan at least LAG_AFTER s old (the older ones dropped first).
    while (snaps.length > 1 && time - snaps[1].t >= LAG_AFTER - 1e-6) snaps.shift();
    const old = snaps.length && time - snaps[0].t >= LAG_AFTER - 1e-6 ? snaps[0] : null;
    if (old) {
      const k = Math.round(car.s - old.s0);
      if (k >= 0 && k < old.d.length) res.lag += SAMPLE * (car.d - (driver.inner.pathRefAt(car.s) + old.d[k])) ** 2;
    }
    const plan = driver.mplan;
    if (plan) {
      const d = new Float32Array(SNAP_AHEAD + 1);
      for (let i = 0; i <= SNAP_AHEAD; i++) d[i] = plan.offsetAt(car.s + i);
      snaps.push({ t: time, s0: car.s, d });
    }
  }
  res.metres = Math.max(0, car.s + 3);
  physics.free();
  most.forEach((m, i) => {
    if (m < 0) return;
    res.angle += m;
    res.pins++;
    const t = through[i];
    res.mean += t.n ? t.sum / t.n : 0;
    if (t.early >= ENTRY_SLIDE) res.entered++;
  });
  const fell = RESET_COST * res.resets + (res.nan ? FELL_COST : 0);
  res.hit = hits.reduce((a, h) => a + (h.exit ? EXIT_GAIN : 1) * (HIT_BRUSH + HIT_LOSS * (h.v0 > 0.5 ? Math.max(0, 1 - h.least / h.v0) : 0)), 0);
  const speed = byDistance
    ? TIME_GAIN * (res.lineTime + PIN_W * res.pinTime + SHORT_S_PER_M * Math.max(0, target - Math.max(0, car.s)))
    : -METRE_GAIN * res.metres;
  res.cost = mode === 'drift'
    ? DRIFT_WALL_COST * res.walls + fell - ANGLE_GAIN * (res.mean + ENTRY_BONUS * res.entered) - DRIFT_METRE_GAIN * res.metres
    : LAG_GAIN * res.lag + WALL_COST * (HIT_GRADE ? res.hit : res.walls) + fell + speed;
  return res;
}

/** Several runs summed (each brain's exam): `seeds` alone and `raceSeeds` from the grid with rivals. */
export function examine(brain: Brain | null, spec: CarSpec, seeds: number[], soloS: number, raceSeeds: number[], raceS: number, mode: NetMode = 'line'): RunResult {
  const sum: RunResult = { cost: 0, lag: 0, walls: 0, lineWalls: 0, hit: 0, exitWalls: 0, lineTime: 0, pinTime: 0, resets: 0, metres: 0, time: null, nan: false, angle: 0, pins: 0, mean: 0, entered: 0 };
  let notHome = false;
  const add = (r: RunResult) => {
    sum.cost += r.cost;
    sum.lag += r.lag;
    sum.walls += r.walls;
    sum.lineWalls += r.lineWalls;
    sum.hit += r.hit;
    sum.exitWalls += r.exitWalls;
    sum.lineTime += r.lineTime;
    sum.pinTime += r.pinTime;
    sum.resets += r.resets;
    sum.metres += r.metres;
    // (one run not home in time: the whole not - it summed the others and looked faster)
    notHome ||= r.time === null;
    sum.time = notHome ? null : (sum.time ?? 0) + r.time!;
    sum.nan ||= r.nan;
    sum.angle += r.angle;
    sum.pins += r.pins;
    sum.mean += r.mean;
    sum.entered += r.entered;
  };
  for (const s of seeds) add(runOnce(brain, spec, s, soloS, false, mode));
  for (const s of raceSeeds) add(runOnce(brain, spec, s, raceS, true, mode));
  return sum;
}
