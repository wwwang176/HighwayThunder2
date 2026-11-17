import { it } from 'vitest';
import { writeFileSync } from 'fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { bend, Centerline, straight } from '../src/road/centerline';
import { surfaceMesh } from '../src/road/surface';
import { MOUNTAIN, roadEdges } from '../src/road/mountain';
import { MOUNTAIN_DRIVER, MountainDriver, hairpinRuns } from '../src/ai/mountainDriver';
import { mountainAi, mountainSetup, mountainSetupOf } from '../src/vehicles/mountainSetup';
import { CARS, STREET_RACER } from '../src/vehicles/cars';
/** CAR=muscle-car / jdm: that car (else the street racer). */
const SPEC = (process.env.CAR && CARS[process.env.CAR]) || STREET_RACER;
import { selfStateOf } from '../src/ai/driver';
import { PHYSICS_DT } from '../src/config';
import { aimDump } from './aimDump';

/**
 * The mountain driver's drift round flat test hairpins (the player judges by the tracks, not totals:
 *   CAR=muscle-car DRIFT='{...}' TRACE='one R15' OUT=out.txt JSON=tracks.json npx vitest run --config training/vitest.config.ts training/mountainDriftTrack.train.ts):
 * the car's track round hairpins - one, and a switchback (two, the other way after a straight), right
 * and left first, R 15/20/25, gaps 30/80 m - every 0.05 s (TRACE=name), and per run what the player judges by: per
 * hairpin its slide episodes (past 15°), its danger/catch steps, its least room to either wall, the wheel's sign flips
 * (past ±0.3) in the 3 s after it, its wall touches.
 */
const HALF_W = 0.93;
function layouts(): Record<string, Centerline> {
  const out: Record<string, Centerline> = {};
  for (const r of (process.env.RADII ?? '15,20,25').split(',').map(Number)) {
    for (const dir of [1, -1]) {
      const way = dir > 0 ? 'R' : 'L';
      out[`one ${way}${r}`] = new Centerline([...straight(300), ...bend(r, dir * 180, 12), ...straight(250)], { turnBack: true, bank: MOUNTAIN.bank });
      for (const gap of process.env.ONLY_ONE ? [] : [30, 80]) {
        out[`two ${way}${r} gap ${gap}`] = new Centerline([...straight(300), ...bend(r, dir * 180, 12), ...straight(gap), ...bend(r, -dir * 180, 12), ...straight(250)], {
          turnBack: true,
          bank: MOUNTAIN.bank,
        });
      }
    }
  }
  return out;
}

/** JSON=path: per layout, its road's edges and the car's track (x, z, nose, mode...) every 0.1 s, for a top-down view. */
const dump: Record<string, unknown> = {};
function run(name: string, road: Centerline, trace: boolean): string[] {
  const e = roadEdges(road);
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  physics.setRoad(road, { rails: { left: (s) => -e.at(s, -1), right: (s) => e.at(s, 1) }, ground: surfaceMesh(road, -50, road.length + 50, (s) => [-e.at(s, -1) - 1.5, e.at(s, 1) + 1.5]) });
  const car = new PlayerCar(physics, null, { spec: SPEC, entity: { type: 'player' } });
  car.road = road;
  Object.assign(car.params, mountainSetup(car.params, mountainSetupOf(SPEC.id)));
  car.resetAt(100, 0, 60 / 3.6);
  const ai = new MountainDriver();
  ai.budget = 0.9;
  ai.setRoad(road, mountainAi(SPEC.ai, mountainSetupOf(SPEC.id)));
  const pins = hairpinRuns(road, MOUNTAIN_DRIVER.drift.tight);
  const from = pins[0].from - 50, to = pins[pins.length - 1].to + 100;
  const lines: string[] = [];
  if (trace) lines.push(`=== ${name}`, '   t      s      d   km/h  slide  yawRd  steer thr brk HB mode    wall');
  // per hairpin: from 20 m before it to 3 s after it ends
  const stats = pins.map(() => ({ episodes: 0, sliding: false, most: 0, danger: 0, catch: 0, inRoom: Infinity, outRoom: Infinity, flips: 0, lastSign: 0, walls: 0, end: Infinity, kickV: NaN, driftV: [] as number[] }));
  let hit = '';
  const track: (number | string)[][] = [];
  let wallHit = '';
  for (let t = 0; t < 40; t += PHYSICS_DT) {
    const input = ai.drive(selfStateOf(car, 300 / 3.6), [], car.params);
    car.prePhysics(input, PHYSICS_DT);
    physics.step((a, b, n) => {
      if (n && (a.type === 'static' || b.type === 'static')) hit = car.d > 0 ? 'R' : 'L';
    });
    car.postPhysics();
    const slide = (Math.atan2(car.vLat, Math.max(Math.abs(car.vLong), 1)) * 180) / Math.PI;
    pins.forEach((p, i) => {
      const st = stats[i];
      if (car.s >= p.to && st.end === Infinity) st.end = t;
      const inIt = car.s >= p.from - 20 && (car.s <= p.to || t < st.end + 3);
      if (!inIt) return;
      // (the next hairpin's own from there)
      if (i + 1 < pins.length && car.s >= pins[i + 1].from - 20) return;
      const a = Math.abs(slide);
      st.most = Math.max(st.most, a);
      if (!st.sliding && a > 15) {
        st.sliding = true;
        st.episodes++;
      } else if (st.sliding && a < 8) st.sliding = false;
      if (ai.mode === 'kick' && Number.isNaN(st.kickV)) st.kickV = car.speed * 3.6;
      if (ai.mode === 'drift') st.driftV.push(car.speed * 3.6);
      if (ai.mode === 'danger') st.danger++;
      if (ai.mode === 'catch') st.catch++;
      const inside = p.dir > 0 ? e.at(car.s, 1) - car.d : e.at(car.s, -1) + car.d;
      const outside = p.dir > 0 ? e.at(car.s, -1) + car.d : e.at(car.s, 1) - car.d;
      st.inRoom = Math.min(st.inRoom, inside - HALF_W);
      st.outRoom = Math.min(st.outRoom, outside - HALF_W);
      if (t > st.end) {
        const sign = input.steer > 0.3 ? 1 : input.steer < -0.3 ? -1 : 0;
        if (sign !== 0 && st.lastSign !== 0 && sign !== st.lastSign) st.flips++;
        if (sign !== 0) st.lastSign = sign;
      }
      if (hit) st.walls++;
    });
    if (trace && car.s > from && car.s < to && (Math.round(t / PHYSICS_DT) % Math.round(0.05 / PHYSICS_DT) === 0 || hit)) {
      lines.push(
        `${t.toFixed(2).padStart(5)} ${car.s.toFixed(1).padStart(6)} ${car.d.toFixed(2).padStart(6)} ${(car.speed * 3.6).toFixed(0).padStart(5)} ${slide.toFixed(0).padStart(6)} ${((car.yaw * 180) / Math.PI).toFixed(0).padStart(6)} ${input.steer.toFixed(2).padStart(6)} ${input.throttle.toFixed(1)} ${input.brake.toFixed(1)} ${input.handbrake ? 'HB' : '  '} ${ai.mode.padEnd(7)} ${hit}`,
      );
    }
    if (hit) wallHit = hit;
    if (process.env.JSON && car.s > from - 30 && car.s < to && Math.round(t / PHYSICS_DT) % Math.round(0.1 / PHYSICS_DT) === 0) {
      const at = car.body.translation();
      const f = road.forwardWorld(car.yaw, car.s);
      track.push([+t.toFixed(2), +at.x.toFixed(2), +at.z.toFixed(2), +f.x.toFixed(3), +f.z.toFixed(3), ai.mode, +slide.toFixed(1), +input.steer.toFixed(2), +(car.speed * 3.6).toFixed(0), input.handbrake ? 1 : 0, wallHit, +input.throttle.toFixed(2), +car.s.toFixed(1), aimDump(ai, road)] as (number | string)[]);
      wallHit = '';
    }
    hit = '';
    if (car.s > to) break;
  }
  physics.free();
  const summary = stats
    .map((st, i) => `#${i + 1} kick ${st.kickV.toFixed(0)} drift ${st.driftV.length ? (st.driftV.reduce((a, b) => a + b, 0) / st.driftV.length).toFixed(0) : '-'} km/h, ${st.episodes} slide${st.episodes === 1 ? '' : 's'} (most ${st.most.toFixed(0)}°) danger ${st.danger} catch ${st.catch} room in ${st.inRoom.toFixed(1)} out ${st.outRoom.toFixed(1)} m, flips ${st.flips}, walls ${st.walls}`)
    .join(' | ');
  if (process.env.JSON) {
    const line = (d: (x: number) => number) => {
      const pts: number[][] = [];
      for (let x = from - 30; x <= to; x += 2) {
        const w = road.toWorld(x, d(x));
        pts.push([+w.x.toFixed(2), +w.z.toFixed(2)]);
      }
      return pts;
    };
    dump[name] = { summary, left: line((x) => -e.at(x, -1)), right: line((x) => e.at(x, 1)), mid: line(() => 0), track };
  }
  return [`${name.padEnd(18)} ${summary}`, ...lines];
}

it('drift tracks', async () => {
  await RAPIER.init();
  if (process.env.DRIFT) Object.assign(MOUNTAIN_DRIVER.drift, JSON.parse(process.env.DRIFT));
  const want = process.env.TRACE ?? '';
  const out: string[] = [];
  const traces: string[] = [];
  for (const [name, road] of Object.entries(layouts())) {
    const r = run(name, road, name === want);
    out.push(r[0]);
    traces.push(...r.slice(1));
  }
  writeFileSync(process.env.OUT ?? 'zz.txt', [...out, '', ...traces].join('\n'));
  if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify(dump));
}, 600_000);
