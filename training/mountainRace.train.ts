import { it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { selfStateOf } from '../src/ai/driver';
import { hairpinRuns, MOUNTAIN_DRIVER, MountainDriver } from '../src/ai/mountainDriver';
import { MountainPlannerDriver } from '../src/ai/mountainPlannerDriver';
import { aimDump } from './aimDump';
import { mulberry32 } from '../src/ai/rng';
import { KMH, PHYSICS_DT } from '../src/config';
import { FINISHED_SPEED, type RaceView, Rivals } from '../src/game/rivals';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { MOUNTAIN, roadEdges, mountainRoad } from '../src/road/mountain';
import { surfaceMesh } from '../src/road/surface';
import { CARS, STREET_RACER } from '../src/vehicles/cars';
import type { CarSpec } from '../src/vehicles/cars/types';
import { PlayerCar } from '../src/vehicles/playerCar';
import { mountainAi, mountainSetup, mountainSetupOf } from '../src/vehicles/mountainSetup';
import { tunedMountainAi } from '../src/vehicles/mountainTuneGrip';
import { randomPerfTuning, tuned } from '../src/vehicles/tuning';
import { TUNE_CAL } from '../src/vehicles/tuneCalibration';

/** SETUP=0: the cars as set up for the highway (else the mountain road's, as the game's). */
const SETUP = process.env.SETUP !== '0';
/** DRIVER=new: every car on the planner driver (MountainPlannerDriver); old (default): the mountain driver. */
const DRIVER = process.env.DRIVER === 'new' ? 'new' : 'old';
type Driver = MountainDriver | MountainPlannerDriver;
const makeDriver = (): Driver => (DRIVER === 'new' ? new MountainPlannerDriver() : new MountainDriver());
/** The mountain driver inside either (its reference, whether it is drifting). */
const coreOf = (d: Driver): MountainDriver => (d instanceof MountainPlannerDriver ? d.inner : d);
/**
 * SOLO=1: each car alone on every seed (no rivals) - its time, its walls, its drifts, and how far off the computed
 * no-traffic path (its reference, refAt) it drove: median and p95 every 0.1 s, drifting left out, and out of a drift
 * till it is first back within SOLO_BACK m of it. SOLO_CARS=street-racer,jdm: those cars alone.
 */
const SOLO = !!process.env.SOLO;
const SOLO_CARS = process.env.SOLO_CARS?.split(',');
/** NET=0: the planner drivers without their cars' trained networks (the driver's own control). */
const NO_NET = process.env.NET === '0';
const SOLO_BACK = 0.3;
/** STALL=1: the player's car held standing (full brake) the first STALL_S s - a player stalling on the grid. */
const STALL = !!process.env.STALL;
const STALL_S = 5;
/** A pair's contacts this far apart (s) are one; within START_S of the start, a start contact. */
const CONTACT_GAP = 0.5;
const START_S = 5;
/** A pass: one car from behind another to ahead within PASS_NEAR m, still ahead PASS_HOLD s on. */
const PASS_NEAR = 10;
const PASS_HOLD = 2;
/** HAIRPINS=1: each car's every hairpin - its slides (past 15°, off under 8°), most, wall contacts, least room either side. */
const HAIRPINS = !!process.env.HAIRPINS;
/**
 * JSON=path (JSON_SEEDS=n, the first n seeds): the road's edges and each car's track every 0.1 s, for a top-down view;
 * a track's row ends with its d, its no-traffic path's d, its brake (the player's; -1 a rival's), its inner driver's mode.
 */
const JSON_OUT = process.env.JSON;
const JSON_SEEDS = Number(process.env.JSON_SEEDS ?? 5);
const dump: Record<string, unknown> = {};
/** (sum, n: its slide summed in it a step, the steps - its slide on average through it; early: its most in its first third) */
interface PinStat { slides: number; on: boolean; most: number; walls: number; inMin: number; outMin: number; sum: number; n: number; early: number }

/**
 * Mountain races without drawing (Task 10 of docs/superpowers/plans/2026-11-15-mountain-road.md): the player's car
 * driven by the mountain driver too, three rivals with theirs, on SEEDS random roads (as the game's: its mesh, its
 * walls, its grid). Per race: each car's time (or how far it got), its wall contacts, its put-backs, how far below the
 * road it ever got, NaN. Asserts: none fell through or went NaN, nine in ten races every car home.
 *   SEEDS=30 npx vitest run --config training/vitest.config.ts training/mountainRace.train.ts
 */
const SEEDS = Number(process.env.SEEDS ?? 30);
/** FIRST (1): the first seed. */
const FIRST = Number(process.env.FIRST ?? 1);
const BUDGET = Number(process.env.BUDGET ?? MOUNTAIN_DRIVER.budget);
/** TUNE=random: the player's car tuned at random each road (its perf knobs, as a rival's in the game); TUNE_AI=0: its line on its tables as built. */
const TUNE_RANDOM = process.env.TUNE === 'random';
const TUNE_AI = process.env.TUNE_AI !== '0';
const LIMIT = 300; // s
const LANE = MOUNTAIN.halfWidth / 2;
const GRID: [number, number][] = [
  [-LANE, -3],
  [LANE, -11],
  [-LANE, -11],
];
/** DEBUG=1: where the cars meet the walls and are put back (the first few of each). */
const DEBUG = !!process.env.DEBUG;
// (DRIFT='{"steer":0.6}': the AI's hairpin drift tuned over MOUNTAIN_DRIVER.drift)
if (process.env.DRIFT) Object.assign(MOUNTAIN_DRIVER.drift, JSON.parse(process.env.DRIFT));
// (PACE='{"gasRamp":3}': MOUNTAIN_DRIVER's own knobs, the same way)
if (process.env.PACE) Object.assign(MOUNTAIN_DRIVER, JSON.parse(process.env.PACE));
const log: string[] = [];
/** TRACE=1 (with DEBUG): the player's last 3 s before each wall it meets just out of a hairpin on its inside, every 0.1 s. */
const TRACE = !!process.env.TRACE;
/** TRACE=all: before every wall it meets. */
const TRACE_ALL = process.env.TRACE === 'all';
type TraceRow = { off: number; t: number; s: number; d: number; plan: number; yaw: number; rate: number; vLat: number; kmh: number; mode: string; base: number; steer: number; thr: number; brk: number };
// (the driver's input before and after its driving network - the bench's own hook on it)
const netSeen = { base: NaN, out: NaN };
if (TRACE) {
  const proto = MountainPlannerDriver.prototype as unknown as { withNet: (self: unknown, input: { steer: number }) => { steer: number } };
  const withNet = proto.withNet;
  proto.withNet = function (this: unknown, self: unknown, input: { steer: number }) {
    const out = withNet.call(this, self, input);
    netSeen.base = input.steer;
    netSeen.out = out.steer;
    return out;
  };
}
const RIVAL_CARS =[STREET_RACER, CARS['muscle-car'] ?? STREET_RACER, CARS.jdm ?? STREET_RACER];

/** How upright a car is (its roof's way up: 1 on its wheels, < 0 on its roof). */
function upY(car: PlayerCar): number {
  const q = car.body.rotation();
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

interface CarStats {
  time: number | null;
  s: number;
  walls: number;
  /** Of them, while following its line (not kicking, drifting, settling out of a drift). */
  lineWalls: number;
  resets: number;
  under: number;
  /** Drifts: its slide past DRIFT_ON (from under DRIFT_OFF), and its most. */
  drifts: number;
  sliding: boolean;
  most: number;
  /** Contacts with other cars (steps). */
  cars: number;
  pins: PinStat[];
}

const DRIFT_ON = (20 * Math.PI) / 180;
const DRIFT_OFF = (10 * Math.PI) / 180;
/** Its slide now (rad, either way). */
const slideOf = (car: PlayerCar) => Math.abs(Math.atan2(car.vLat, Math.max(Math.abs(car.vLong), 1)));
/** A road's hairpins: its runs bent tighter than R 26 one way. */
function hairpinsOf(road: { length: number; curvature(s: number): number }): number {
  let n = 0, inside = false;
  for (let s = 0; s < road.length; s += 1) {
    const tight = Math.abs(road.curvature(s)) > 1 / 26;
    if (tight && !inside) n++;
    inside = tight;
  }
  return n;
}

/** A race's counts of the cars' meeting: contact events, those at the start, passes; and (SOLO) the player's off-path samples. */
interface Meet { contacts: number; startContacts: number; passes: number; dev: number[] }

/**
 * Where the time goes (SOLO, the car racing): the road by part - a hairpin (its tight run), SEG_NEAR m before one
 * (coming to it), SEG_NEAR m after one (out of it), a bend (tighter than R SEG_BEND), a straight - and in each its
 * seconds, and summed over them its speed (m/s), its throttle, full throttle (>= 0.95: 1) and its brake on (1), each
 * times the step (to be added up over many roads, then divided by the seconds).
 */
const SEGS = ['straight', 'bend', 'approach', 'hairpin', 'exit'] as const;
type Seg = (typeof SEGS)[number];
type SegSums = Record<Seg, { t: number; v: number; thr: number; full: number; brk: number }>;
const SEG_NEAR = 60;
/**
 * How hard each wall contact was (SOLO, the car racing): its speed into the wall as it touched (m/s, across the
 * contact's normal, from before the step), and what it lost over the WALL_WATCH s after (its least speed then against
 * its speed before) - a brush or a crash, and stopped (under WALL_STOP m/s).
 */
interface Hit { vn: number; v0: number; least: number; t: number }
const WALL_WATCH = 1;
const WALL_STOP = 5 / 3.6;
const VN_EDGES = [1, 3, 6];
const LOSS_EDGES = [0.1, 0.3, 0.7];
const bucket = (x: number, edges: number[]) => edges.filter((e) => x >= e).length;
const SEG_BEND = 150;
const segSums = (): SegSums => Object.fromEntries(SEGS.map((k) => [k, { t: 0, v: 0, thr: 0, full: 0, brk: 0 }])) as SegSums;

function race(seed: number, playerSpec: CarSpec = STREET_RACER, alone = false): { cars: CarStats[]; nan: boolean; lineMs: number; hairpins: number; runs: { from: number; to: number; dir: number; r: number }[]; meet: Meet; seg: SegSums; hits: Hit[] } {
  const meet: Meet = { contacts: 0, startContacts: 0, passes: 0, dev: [] };
  const seg = segSums();
  const hits: Hit[] = [];
  const pv = { x: 0, z: 0, speed: 0 }; // (the player's going before the step)
  const lastTouch = new Map<number, number>();
  /** Per pair (i < j): who is ahead (+1: i), and a pass waiting to hold (by whom, since when). */
  const order = new Map<number, number>();
  const pending = new Map<number, { by: number; at: number }>();
  let back = true; // (SOLO: back on its path since its last drift)
  const road = mountainRoad(mulberry32(seed));
  const runs = hairpinRuns(road, 26).map((h) => ({ ...h, r: Math.abs(1 / road.curvature((h.from + h.to) / 2)) }));
  const pinOf = (s: number) => runs.findIndex((h) => s >= h.from - 10 && s <= h.to + 60);
  const segOf = (s: number): Seg => {
    if (runs.some((h) => s >= h.from && s <= h.to)) return 'hairpin';
    if (runs.some((h) => s >= h.from - SEG_NEAR && s < h.from)) return 'approach';
    if (runs.some((h) => s > h.to && s <= h.to + SEG_NEAR)) return 'exit';
    return Math.abs(road.curvature(s)) > 1 / SEG_BEND ? 'bend' : 'straight';
  };
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  // (as the game's: its edges along it, a shoulder on a tight bend's outside; SHOULDER=0: none)
  const e = process.env.SHOULDER === '0' ? { at: () => MOUNTAIN.edge } : roadEdges(road);
  physics.setRoad(road, { rails: { left: (s) => -e.at(s, -1), right: (s) => e.at(s, 1) }, ground: surfaceMesh(road, -MOUNTAIN.before, MOUNTAIN.length + MOUNTAIN.after, (s) => [-e.at(s, -1) - 1.5, e.at(s, 1) + 1.5]) });
  const player = new PlayerCar(physics, null, { spec: playerSpec, entity: { type: 'player' } });
  player.road = road;
  // (TUNE=random: the player's perf knobs at random, a road's own - as a rival's in the game)
  const tuning = TUNE_RANDOM ? randomPerfTuning(mulberry32(seed + 7777)) : {};
  if (TUNE_RANDOM) Object.assign(player.params, tuned(player.params, tuning, TUNE_CAL[playerSpec.id]));
  if (SETUP) Object.assign(player.params, mountainSetup(player.params, mountainSetupOf(playerSpec.id))); // (as the game's)
  player.resetAt(-3, LANE, 0);
  const t0 = performance.now();
  const playerAi = makeDriver();
  playerAi.budget = BUDGET;
  const setupAi = mountainAi(playerSpec.ai, mountainSetupOf(playerSpec.id));
  playerAi.setRoad(road, SETUP ? (TUNE_AI ? tunedMountainAi(setupAi, playerSpec.id, tuning) : setupAi) : playerSpec.ai);
  if (NO_NET && playerAi instanceof MountainPlannerDriver) playerAi.net = null;
  const lineMs = performance.now() - t0;
  const rivals = new Rivals<Driver>(physics, null, () => null, alone ? [] : RIVAL_CARS, {
    makeDriver,
    grid: GRID,
    gripBoost: 0,
    edge: (s, side) => e.at(s, side),
    lanes: [LANE, -LANE],
    setup: SETUP ? { params: (p, spec) => mountainSetup(p, mountainSetupOf(spec.id)), ai: (ai, spec) => mountainAi(ai, mountainSetupOf(spec.id)) } : undefined,
  });
  rivals.length = MOUNTAIN.length;
  rivals.setRoad(road);
  for (const r of rivals.list) {
    r.driver.budget = BUDGET;
    if (NO_NET && r.driver instanceof MountainPlannerDriver) r.driver.net = null;
  }
  rivals.place();
  const stats: CarStats[] = Array.from({ length: 4 }, () => ({ time: null, s: 0, walls: 0, lineWalls: 0, resets: 0, under: 0, drifts: 0, sliding: false, most: 0, cars: 0, pins: runs.map(() => ({ slides: 0, on: false, most: 0, walls: 0, inMin: 99, outMin: 99, sum: 0, n: 0, early: 0 })) }));
  let time = 0;
  let nan = false;
  const dumpIt = !!JSON_OUT && seed < FIRST + JSON_SEEDS;
  const tracks: (number | string)[][][] = [[], [], [], []];
  const hitNow = [false, false, false, false];
  let playerStuck = 0;
  const trace: TraceRow[] = [];
  let lastTrace = -9;
  while (time < LIMIT) {
    const view: RaceView = { player, traffic: [], speedCap: 300 * KMH, raceTime: time };
    rivals.drive(PHYSICS_DT, view);
    // (past the line, as the game's: rolling on at FINISHED_SPEED)
    const cap = stats[0].time === null ? player.params.maxSpeed : FINISHED_SPEED;
    netSeen.base = NaN;
    const ownSelf = selfStateOf(player, cap);
    const own = playerAi.drive(ownSelf, rivals.boxes(), player.params);
    if (TRACE) {
      const core = coreOf(playerAi);
      const mp = playerAi instanceof MountainPlannerDriver ? playerAi.mplan : null;
      trace.push({ off: (() => { const at = (core as unknown as { alignTo: number | null }).alignTo; if (at === null) return NaN; const n = road.heading(player.s) + player.yaw; return Math.atan2(Math.sin(n - at), Math.cos(n - at)); })(), t: time, s: player.s, d: player.d, plan: core.pathRefAt(player.s) + (mp ? mp.offsetAt(player.s) : 0), yaw: player.yaw, rate: ownSelf.yawRate, vLat: ownSelf.vLat, kmh: player.speed / KMH, mode: core.mode, base: netSeen.base, steer: own.steer, thr: own.throttle, brk: own.brake });
      if (trace.length > 3 / PHYSICS_DT) trace.shift();
    }
    player.prePhysics(STALL && time < STALL_S ? { throttle: 0, brake: 1, steer: 0 } : own, PHYSICS_DT);
    const lv = player.body.linvel();
    pv.x = lv.x;
    pv.z = lv.z;
    pv.speed = player.speed;
    physics.step((a, b, normal) => {
      if (!normal) return; // (the ground)
      for (const e of [a, b]) {
        const other = e === a ? b : a;
        const k = e.type === 'player' ? 0 : e.type === 'rival' ? e.id + 1 : -1;
        if (k < 0) continue;
        if (other.type === 'player' || other.type === 'rival') {
          stats[k].cars++;
          const k2 = other.type === 'player' ? 0 : other.id + 1;
          if (k < k2) {
            const key = k * 10 + k2;
            const last = lastTouch.get(key);
            if (last === undefined || time - last > CONTACT_GAP) {
              meet.contacts++;
              if (time < START_S) meet.startContacts++;
            }
            lastTouch.set(key, time);
          }
          continue;
        }
        if (other.type !== 'static') continue;
        stats[k].walls++;
        if (k === 0 && alone && stats[0].time === null) hits.push({ vn: Math.abs(pv.x * normal.x + pv.z * normal.z), v0: pv.speed, least: pv.speed, t: time });
        if (!coreOf(k === 0 ? playerAi : rivals.list[k - 1].driver).inDrift()) stats[k].lineWalls++;
        hitNow[k] = true;
        const car = k === 0 ? player : rivals.list[k - 1].car;
        const pi = pinOf(car.s);
        if (pi >= 0) stats[k].pins[pi].walls++;
        // (side: of the hairpin it is in or just out of - inside, its turn's way)
        const side = pi < 0 ? '-' : runs[pi].dir * car.d > 0 ? 'in' : 'out';
        if (TRACE && k === 0 && (TRACE_ALL || (pi >= 0 && side === 'in' && car.s - runs[pi].to > 0 && car.s - runs[pi].to < 80)) && time - lastTrace > 2) {
          lastTrace = time;
          log.push(`  TRACE seed ${seed} pin ${pi} dir ${pi >= 0 ? runs[pi].dir : 0} (+: d of its inside) hit t ${time.toFixed(1)} past ${pi >= 0 ? (car.s - runs[pi].to).toFixed(0) : '-'} m k ${road.curvature(car.s).toFixed(3)} side ${side}`);
          log.push('    t      s      d   plan    yaw  noseOff  rate   vLat  km/h mode     base  steer   thr   brk');
          trace.forEach((r, i) => {
            if (i % 5 !== 0 && i !== trace.length - 1) return;
            const f = (x: number, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : '  -').padStart(6);
            log.push(`  ${f(r.t, 1)} ${f(r.s, 0)} ${f(r.d)} ${f(r.plan)} ${f(r.yaw)} ${f(r.off)} ${f(r.rate)} ${f(r.vLat)} ${f(r.kmh, 0)} ${r.mode.padEnd(7)} ${f(r.base)} ${f(r.steer)} ${f(r.thr)} ${f(r.brk)}`);
          });
        }
        if (DEBUG && stats[k].walls <= 6) log.push(`  wall ${k ? `R${k}` : 'P'} t ${time.toFixed(1)} s ${car.s.toFixed(0)} d ${car.d.toFixed(2)} ${(car.speed / KMH).toFixed(0)} km/h k ${road.curvature(car.s).toFixed(3)} yaw ${car.yaw.toFixed(2)} ${coreOf(k === 0 ? playerAi : rivals.list[k - 1].driver).mode} pin ${pi} side ${side}${pi >= 0 ? ` past ${(car.s - runs[pi].to).toFixed(0)} m` : ''}`);
      }
    });
    const resetsBefore = rivals.list.map((r) => r.resets);
    const poseBefore = rivals.list.map((r) => `yaw ${r.car.yaw.toFixed(2)} up ${upY(r.car).toFixed(2)} ${(r.car.speed / KMH).toFixed(0)} km/h stuck ${r.stuckFor.toFixed(1)} d ${r.car.d.toFixed(2)}`);
    player.postPhysics();
    time += PHYSICS_DT;
    for (const h of hits) if (time - h.t <= WALL_WATCH) h.least = Math.min(h.least, player.speed);
    if (alone && stats[0].time === null && player.s >= 0) {
      const g = seg[segOf(player.s)];
      g.t += PHYSICS_DT;
      g.v += player.speed * PHYSICS_DT;
      g.thr += own.throttle * PHYSICS_DT;
      if (own.throttle >= 0.95) g.full += PHYSICS_DT;
      if (own.brake > 0) g.brk += PHYSICS_DT;
    }
    rivals.after(PHYSICS_DT, view, []);
    if (DEBUG) rivals.list.forEach((r, i) => {
      if (r.resets > resetsBefore[i] && r.resets <= 4) log.push(`  reset R${i + 1} t ${time.toFixed(1)} s ${r.car.s.toFixed(0)} player s ${player.s.toFixed(0)} (was ${poseBefore[i]})`);
    });
    // The player's put-back as the game's (under the road, or stuck).
    playerStuck = player.speed < 2 ? playerStuck + PHYSICS_DT : 0;
    const pt = player.body.translation();
    if (![pt.x, pt.y, pt.z].every(Number.isFinite)) {
      nan = true;
      break;
    }
    stats[0].under = Math.min(stats[0].under, pt.y - road.height(player.s));
    if (pt.y < road.height(player.s) - 5 || (playerStuck > 3 && stats[0].time === null)) { // (finished: it stops on purpose)
      if (DEBUG) log.push(`  reset P t ${time.toFixed(1)} s ${player.s.toFixed(0)} y-h ${(pt.y - road.height(player.s)).toFixed(2)} stuck ${playerStuck.toFixed(1)} yaw ${player.yaw.toFixed(2)} up ${upY(player).toFixed(2)} d ${player.d.toFixed(2)}`);
      player.resetAt(player.s, LANE, 15);
      playerAi.reset();
      stats[0].resets++;
      playerStuck = 0;
    }
    if (stats[0].time === null && player.s >= MOUNTAIN.length) stats[0].time = time;
    // Passes: a pair's order flipped within PASS_NEAR m, held PASS_HOLD s (both still racing).
    const cars = [player, ...rivals.list.map((r) => r.car)];
    const racing = [stats[0].time === null, ...rivals.list.map((r) => r.finishTime === null)];
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const key = i * 10 + j;
        if (!racing[i] || !racing[j]) {
          pending.delete(key);
          continue;
        }
        const ds = cars[i].s - cars[j].s;
        const now = ds >= 0 ? 1 : -1;
        const was = order.get(key);
        order.set(key, now);
        if (was !== undefined && was !== now) {
          if (pending.has(key)) pending.delete(key); // (back again: no pass)
          else if (Math.abs(ds) < PASS_NEAR) pending.set(key, { by: now, at: time });
        }
        const p = pending.get(key);
        if (p && time - p.at >= PASS_HOLD) {
          meet.passes++;
          pending.delete(key);
        }
      }
    }
    // SOLO: how far off its computed no-traffic path (its reference), drifting and coming back from it left out.
    if (alone && stats[0].time === null && Math.round(time / PHYSICS_DT) % Math.round(0.1 / PHYSICS_DT) === 0 && player.s > 0) {
      const core = coreOf(playerAi);
      const off = Math.abs(player.d - core.refAt(player.s));
      if (core.inDrift()) back = false;
      else if (!back && off < SOLO_BACK) back = true;
      if (back && !core.inDrift()) meet.dev.push(off);
    }
    if (dumpIt) {
      const step = Math.round(time / PHYSICS_DT);
      [player, ...rivals.list.map((r) => r.car)].forEach((car, k) => {
        if (hitNow[k]) tracks[k].wallFlag = 1 as never;
        if (step % Math.round(0.1 / PHYSICS_DT) !== 0) return;
        if (car.s > MOUNTAIN.length + 40) return;
        const drv = k === 0 ? playerAi : rivals.list[k - 1].driver;
        const at = car.body.translation();
        const f = road.forwardWorld(car.yaw, car.s);
        const mode = (drv as { mode?: string }).mode ?? 'line';
        const slide = (Math.atan2(car.vLat, Math.max(Math.abs(car.vLong), 1)) * 180) / Math.PI;
        const tr = tracks[k] as unknown as { wallFlag?: number } & (number | string)[][];
        tr.push([+time.toFixed(1), +at.x.toFixed(2), +at.z.toFixed(2), +f.x.toFixed(3), +f.z.toFixed(3), mode, +slide.toFixed(1), +(car as unknown as { steer: number }).steer.toFixed(2), +(car.speed * 3.6).toFixed(0), mode === 'kick' || mode === 'pull' ? 1 : 0, tr.wallFlag ? 'W' : '', +(car as unknown as { throttle: number }).throttle.toFixed(2), +car.s.toFixed(1), aimDump(coreOf(drv), road), +car.d.toFixed(2), +coreOf(drv).refAt(car.s).toFixed(2), k === 0 ? +own.brake.toFixed(2) : -1, coreOf(drv).mode] as (number | string)[]);
        tr.wallFlag = 0;
      });
      hitNow.fill(false);
    }
    [player, ...rivals.list.map((r) => r.car)].forEach((car, k) => {
      const st = stats[k];
      if ((k === 0 ? st.time : rivals.list[k - 1].finishTime) !== null) return;
      const a = slideOf(car);
      st.most = Math.max(st.most, a);
      const pi = pinOf(car.s);
      if (pi >= 0) {
        const ps = st.pins[pi];
        const dir = runs[pi].dir;
        ps.most = Math.max(ps.most, a);
        const h = runs[pi];
        if (car.s >= h.from && car.s <= h.to) {
          ps.sum += a;
          ps.n++;
          if (car.s <= h.from + (h.to - h.from) / 3) ps.early = Math.max(ps.early, a);
        }
        if (!ps.on && a > (15 * Math.PI) / 180) {
          ps.on = true;
          ps.slides++;
        } else if (ps.on && a < (8 * Math.PI) / 180) ps.on = false;
        const half = MOUNTAIN_DRIVER.halfWidth;
        ps.inMin = Math.min(ps.inMin, e.at(car.s, dir) - dir * car.d - half);
        ps.outMin = Math.min(ps.outMin, e.at(car.s, -dir) + dir * car.d - half);
      }
      if (!st.sliding && a > DRIFT_ON) {
        st.sliding = true;
        st.drifts++;
      } else if (st.sliding && a < DRIFT_OFF) st.sliding = false;
    });
    rivals.list.forEach((r, i) => {
      const t = r.car.body.translation();
      if (![t.x, t.y, t.z].every(Number.isFinite)) nan = true;
      const below = t.y - road.height(r.car.s);
      if (DEBUG && below < -1 && stats[i + 1].under >= -1) log.push(`  under R${i + 1} t ${time.toFixed(2)} s ${r.car.s.toFixed(1)} d ${r.car.d.toFixed(2)} y-h ${below.toFixed(2)} ${(r.car.speed / KMH).toFixed(0)} km/h yaw ${r.car.yaw.toFixed(2)} up ${r.car.body.rotation().w.toFixed(2)} finished ${r.finishTime !== null}`);
      stats[i + 1].under = Math.min(stats[i + 1].under, below);
    });
    if (nan) break;
    if (stats[0].time !== null && rivals.list.every((r) => r.finishTime !== null)) break;
  }
  stats[0].s = player.s;
  rivals.list.forEach((r, i) => {
    stats[i + 1].time = r.finishTime;
    stats[i + 1].s = r.car.s;
    stats[i + 1].resets = r.resets;
  });
  if (dumpIt) {
    const line = (side: number) => {
      const pts: number[][] = [];
      for (let x = -20; x <= MOUNTAIN.length + 40; x += 3) {
        const w = road.toWorld(x, side === 0 ? 0 : side * e.at(x, side as 1 | -1));
        pts.push([+w.x.toFixed(1), +w.z.toFixed(1)]);
      }
      return pts;
    };
    dump[seed] = {
      left: line(-1), right: line(1), mid: line(0),
      pins: runs.map((h) => ({ from: +h.from.toFixed(1), to: +h.to.toFixed(1), dir: h.dir, r: +h.r.toFixed(0) })),
      // (each metre: the road's curvature (1/m, + right), its edges' d either side)
      road: Array.from({ length: Math.ceil(MOUNTAIN.length) }, (_, x) => [+road.curvature(x).toFixed(5), +e.at(x, 1).toFixed(2), +e.at(x, -1).toFixed(2)]),
      cars: stats.map((st, k) => ({ pins: st.pins.map((ps) => [ps.slides, +((ps.most * 180) / Math.PI).toFixed(0), ps.walls, +ps.inMin.toFixed(1), +ps.outMin.toFixed(1)]), track: tracks[k] })),
    };
  }
  physics.free();
  return { cars: alone ? stats.slice(0, 1) : stats, nan, lineMs, hairpins: hairpinsOf(road), runs, meet, seg, hits };
}

/** The q quantile of xs (sorted copy). */
function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const a = xs.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}

it.runIf(SOLO)('mountain solo runs: each car alone, off its path, walls, time', async () => {
  await RAPIER.init();
  const out: string[] = [`driver ${DRIVER}`];
  let nans = 0;
  let fell = 0;
  let home = 0;
  let runs = 0;
  for (const spec of RIVAL_CARS) {
    if (SOLO_CARS && !SOLO_CARS.includes(spec.id)) continue;
    const dev: number[] = [];
    let walls = 0;
    let lineWalls = 0;
    let time = 0;
    let done = 0;
    const pinT = { n: 0, twice: 0, none: 0, most: 0, through: 0, into: 0 };
    const segAll = segSums();
    const vnN = [0, 0, 0, 0];
    const lossN = [0, 0, 0, 0];
    let stops = 0;
    for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
      const r = race(seed, spec, true);
      for (const h of r.hits) {
        vnN[bucket(h.vn, VN_EDGES)]++;
        lossN[bucket(h.v0 > 0.5 ? 1 - h.least / h.v0 : 0, LOSS_EDGES)]++;
        if (h.least < WALL_STOP) stops++;
      }
      for (const k of SEGS) for (const f of ['t', 'v', 'thr', 'full', 'brk'] as const) segAll[k][f] += r.seg[k][f];
      runs++;
      const c = r.cars[0];
      if (r.nan) nans++;
      if (c.under < -2) fell++;
      if (c.time !== null) {
        home++;
        done++;
        time += c.time;
      }
      walls += c.walls;
      lineWalls += c.lineWalls;
      dev.push(...r.meet.dev);
      for (const ps of c.pins) {
        pinT.n++;
        if (ps.slides > 1) pinT.twice++;
        if (ps.slides === 0) pinT.none++;
        pinT.most += ps.most;
        pinT.through += ps.n ? ps.sum / ps.n : 0;
        if (ps.early >= (20 * Math.PI) / 180) pinT.into++;
      }
      out.push(`  ${spec.id} seed ${seed}: ${c.time !== null ? c.time.toFixed(2) + ' s' : `DNF@${c.s.toFixed(0)}`} walls ${c.walls} (line ${c.lineWalls}) off p50 ${quantile(r.meet.dev, 0.5).toFixed(3)} p95 ${quantile(r.meet.dev, 0.95).toFixed(3)} m`);
      out.push(...log.splice(0));
    }
    out.push(
      `${spec.id}: home ${done}/${SEEDS}, time avg ${(time / Math.max(1, done)).toFixed(2)} s, walls ${walls} (following its line ${lineWalls}), off its path p50 ${quantile(dev, 0.5).toFixed(3)} p95 ${quantile(dev, 0.95).toFixed(3)} m (${dev.length} samples), ` +
        `hairpins ${pinT.n}: slid twice+ ${pinT.twice}, not past 15° ${pinT.none}, most avg ${((pinT.most / Math.max(1, pinT.n)) * 180 / Math.PI).toFixed(1)}°, through avg ${((pinT.through / Math.max(1, pinT.n)) * 180 / Math.PI).toFixed(1)}°, slid past 20° in its first third ${pinT.into}`,
    );
    // (summed over its races, to be added up across runs: seconds, then speed/throttle/full/brake times the seconds)
    out.push(`${spec.id} segs races ${SEEDS}: ` + SEGS.map((k) => `${k} ${['t', 'v', 'thr', 'full', 'brk'].map((f) => segAll[k][f as 't'].toFixed(2)).join(' ')}`).join(' | '));
    // (its wall contacts by how hard: into the wall under 1, 1-3, 3-6, over 6 m/s; speed lost under 10, 10-30, 30-70,
    // over 70 %; stopped)
    out.push(`${spec.id} hits: vn ${vnN.join(' ')} | loss ${lossN.join(' ')} | stopped ${stops}`);
  }
  process.stdout.write(out.join('\n') + '\n');
  // (one car's: SOLO_CARS one car - each seed's dump the last car's run on it)
  if (JSON_OUT) (await import('fs')).writeFileSync(JSON_OUT, JSON.stringify(dump));
  expect(nans).toBe(0);
  expect(fell).toBe(0);
  expect(home).toBeGreaterThanOrEqual(Math.ceil(runs * 0.9));
});

it.runIf(!SOLO)('mountain races', async () => {
  await RAPIER.init();
  const out: string[] = [];
  let allHome = 0;
  let fell = 0;
  let nans = 0;
  const totals = { walls: 0, resets: 0, drifts: 0, hairpins: 0, cars: 0, contacts: 0, startContacts: 0, passes: 0 };
  const pinT = { n: 0, walled: 0, twice: 0, none: 0, small: 0, tight: 0 };
  for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
    const r = race(seed);
    totals.contacts += r.meet.contacts;
    totals.startContacts += r.meet.startContacts;
    totals.passes += r.meet.passes;
    const home = r.cars.every((c) => c.time !== null);
    if (home) allHome++;
    if (r.nan) nans++;
    if (r.cars.some((c) => c.under < -2)) fell++;
    for (const c of r.cars) {
      totals.walls += c.walls;
      totals.resets += c.resets;
      totals.drifts += c.drifts;
      totals.cars += c.cars;
      for (const ps of c.pins) {
        pinT.n++;
        if (ps.walls) pinT.walled++;
        if (ps.slides > 1) pinT.twice++;
        if (ps.slides === 0) pinT.none++;
        if (ps.most < (15 * Math.PI) / 180) pinT.small++;
        if (Math.min(ps.inMin, ps.outMin) < 0.3) pinT.tight++;
      }
    }
    totals.hairpins += r.hairpins * r.cars.length;
    out.push(
      `seed ${String(seed).padStart(2)} (${r.hairpins} hairpins, line ${r.lineMs.toFixed(0)} ms): ` +
        r.cars.map((c, i) => `${i ? `R${i}` : 'P'} ${c.time !== null ? c.time.toFixed(1) + ' s' : `DNF@${c.s.toFixed(0)}`} w${c.walls} r${c.resets} d${c.drifts}/${((c.most * 180) / Math.PI).toFixed(0)}°${c.under < -2 ? ` UNDER ${c.under.toFixed(1)}` : ''}`).join(' | ') +
        ` | passes ${r.meet.passes}, touches ${r.meet.contacts} (start ${r.meet.startContacts})` +
        (r.nan ? '  NaN!' : ''),
    );
    if (HAIRPINS) r.cars.forEach((c, i) => out.push(`  ${i ? `R${i}` : 'P '} ` + c.pins.map((ps, j) => `#${j} R${r.runs[j].r.toFixed(0)}${r.runs[j].dir > 0 ? 'r' : 'l'} ${ps.slides}x${((ps.most * 180) / Math.PI).toFixed(0)}° w${ps.walls} ${ps.inMin.toFixed(1)}/${ps.outMin.toFixed(1)}`).join('  ')));
    out.push(...log.splice(0));
  }
  out.push(`all home ${allHome}/${SEEDS}, fell through ${fell}, NaN ${nans}, wall contacts ${totals.walls}, put-backs ${totals.resets}, drifts ${totals.drifts} (hairpins ${totals.hairpins}), car contacts ${totals.cars} steps / ${totals.contacts} events (at the start ${totals.startContacts}), passes ${totals.passes} (driver ${DRIVER}${STALL ? ", player stalled" : ""})`);
  out.push(`hairpins (all cars) ${pinT.n}: with walls ${pinT.walled}, slid twice+ ${pinT.twice}, not past 15° ${pinT.none}, room under 0.3 m ${pinT.tight}`);
  process.stdout.write(out.join('\n') + '\n');
  if (JSON_OUT) (await import('fs')).writeFileSync(JSON_OUT, JSON.stringify(dump));
  expect(nans).toBe(0);
  expect(fell).toBe(0);
  expect(allHome).toBeGreaterThanOrEqual(Math.ceil(SEEDS * 0.9));
});
