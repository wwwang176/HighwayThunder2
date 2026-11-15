import { it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { selfStateOf } from '../src/ai/driver';
import { MountainDriver } from '../src/ai/mountainDriver';
import { mulberry32 } from '../src/ai/rng';
import { KMH, PHYSICS_DT } from '../src/config';
import { FINISHED_SPEED, type RaceView, Rivals } from '../src/game/rivals';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { MOUNTAIN, roadEdges, mountainRoad } from '../src/road/mountain';
import { surfaceMesh } from '../src/road/surface';
import { CARS, STREET_RACER } from '../src/vehicles/cars';
import { PlayerCar } from '../src/vehicles/playerCar';
import { mountainAi, mountainSetup, mountainSetupOf } from '../src/vehicles/mountainSetup';

/** SETUP=0: the cars as set up for the highway (else the mountain road's, as the game's). */
const SETUP = process.env.SETUP !== '0';

/**
 * Mountain races without drawing (Task 10 of docs/superpowers/plans/2026-11-15-mountain-road.md): the player's car
 * driven by the mountain driver too, three rivals with theirs, on SEEDS random roads (as the game's: its mesh, its
 * walls, its grid). Per race: each car's time (or how far it got), its wall contacts, its put-backs, how far below the
 * road it ever got, NaN. Asserts: none fell through or went NaN, nine in ten races every car home.
 *   SEEDS=30 BUDGET=0.9 npx vitest run --config training/vitest.config.ts training/mountainRace.train.ts
 */
const SEEDS = Number(process.env.SEEDS ?? 30);
/** FIRST (1): the first seed. */
const FIRST = Number(process.env.FIRST ?? 1);
const BUDGET = Number(process.env.BUDGET ?? 0.9);
const LIMIT = 300; // s
const LANE = MOUNTAIN.halfWidth / 2;
const GRID: [number, number][] = [
  [-LANE, -3],
  [LANE, -11],
  [-LANE, -11],
];
/** DEBUG=1: where the cars meet the walls and are put back (the first few of each). */
const DEBUG = !!process.env.DEBUG;
const log: string[] = [];
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
  resets: number;
  under: number;
}

function race(seed: number): { cars: CarStats[]; nan: boolean; lineMs: number } {
  const road = mountainRoad(mulberry32(seed));
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  // (as the game's: its edges along it, a shoulder on a tight bend's outside; SHOULDER=0: none)
  const e = process.env.SHOULDER === '0' ? { at: () => MOUNTAIN.edge } : roadEdges(road);
  physics.setRoad(road, { rails: { left: (s) => -e.at(s, -1), right: (s) => e.at(s, 1) }, ground: surfaceMesh(road, -MOUNTAIN.before, MOUNTAIN.length + MOUNTAIN.after, (s) => [-e.at(s, -1) - 1.5, e.at(s, 1) + 1.5]) });
  const player = new PlayerCar(physics, null, { entity: { type: 'player' } });
  player.road = road;
  if (SETUP) Object.assign(player.params, mountainSetup(player.params, mountainSetupOf(STREET_RACER.id))); // (as the game's)
  player.resetAt(-3, LANE, 0);
  const t0 = performance.now();
  const playerAi = new MountainDriver();
  playerAi.budget = BUDGET;
  playerAi.setRoad(road, SETUP ? mountainAi(STREET_RACER.ai, mountainSetupOf(STREET_RACER.id)) : STREET_RACER.ai);
  const lineMs = performance.now() - t0;
  const rivals = new Rivals<MountainDriver>(physics, null, () => null, RIVAL_CARS, {
    makeDriver: () => new MountainDriver(),
    grid: GRID,
    gripBoost: 0,
    edge: (s, side) => e.at(s, side),
    lanes: [LANE, -LANE],
    setup: SETUP ? { params: (p, spec) => mountainSetup(p, mountainSetupOf(spec.id)), ai: (ai, spec) => mountainAi(ai, mountainSetupOf(spec.id)) } : undefined,
  });
  rivals.length = MOUNTAIN.length;
  rivals.setRoad(road);
  for (const r of rivals.list) r.driver.budget = BUDGET;
  rivals.place();
  const stats: CarStats[] = Array.from({ length: 4 }, () => ({ time: null, s: 0, walls: 0, resets: 0, under: 0 }));
  let time = 0;
  let nan = false;
  let playerStuck = 0;
  while (time < LIMIT) {
    const view: RaceView = { player, traffic: [], speedCap: 300 * KMH, raceTime: time };
    rivals.drive(PHYSICS_DT, view);
    // (past the line, as the game's: rolling on at FINISHED_SPEED)
    const cap = stats[0].time === null ? player.params.maxSpeed : FINISHED_SPEED;
    player.prePhysics(playerAi.drive(selfStateOf(player, cap), rivals.boxes(), player.params), PHYSICS_DT);
    physics.step((a, b, normal) => {
      if (!normal) return; // (the ground)
      for (const e of [a, b]) {
        const other = e === a ? b : a;
        if (other.type !== 'static') continue;
        const k = e.type === 'player' ? 0 : e.type === 'rival' ? e.id + 1 : -1;
        if (k < 0) continue;
        stats[k].walls++;
        const car = k === 0 ? player : rivals.list[k - 1].car;
        if (DEBUG && stats[k].walls <= 6) log.push(`  wall ${k ? `R${k}` : 'P'} t ${time.toFixed(1)} s ${car.s.toFixed(0)} d ${car.d.toFixed(2)} ${(car.speed / KMH).toFixed(0)} km/h k ${road.curvature(car.s).toFixed(3)} yaw ${car.yaw.toFixed(2)}`);
      }
    });
    const resetsBefore = rivals.list.map((r) => r.resets);
    const poseBefore = rivals.list.map((r) => `yaw ${r.car.yaw.toFixed(2)} up ${upY(r.car).toFixed(2)} ${(r.car.speed / KMH).toFixed(0)} km/h stuck ${r.stuckFor.toFixed(1)} d ${r.car.d.toFixed(2)}`);
    player.postPhysics();
    time += PHYSICS_DT;
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
  physics.free();
  return { cars: stats, nan, lineMs };
}

it('mountain races', async () => {
  await RAPIER.init();
  const out: string[] = [];
  let allHome = 0;
  let fell = 0;
  let nans = 0;
  const totals = { walls: 0, resets: 0 };
  for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
    const r = race(seed);
    const home = r.cars.every((c) => c.time !== null);
    if (home) allHome++;
    if (r.nan) nans++;
    if (r.cars.some((c) => c.under < -2)) fell++;
    for (const c of r.cars) {
      totals.walls += c.walls;
      totals.resets += c.resets;
    }
    out.push(
      `seed ${String(seed).padStart(2)} (line ${r.lineMs.toFixed(0)} ms): ` +
        r.cars.map((c, i) => `${i ? `R${i}` : 'P'} ${c.time !== null ? c.time.toFixed(1) + ' s' : `DNF@${c.s.toFixed(0)}`} w${c.walls} r${c.resets}${c.under < -2 ? ` UNDER ${c.under.toFixed(1)}` : ''}`).join(' | ') +
        (r.nan ? '  NaN!' : ''),
    );
    out.push(...log.splice(0));
  }
  out.push(`all home ${allHome}/${SEEDS}, fell through ${fell}, NaN ${nans}, wall contacts ${totals.walls}, put-backs ${totals.resets}`);
  process.stdout.write(out.join('\n') + '\n');
  expect(nans).toBe(0);
  expect(fell).toBe(0);
  expect(allHome).toBeGreaterThanOrEqual(Math.ceil(SEEDS * 0.9));
});
