import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { KMH, PHYSICS_DT } from '../src/config';
import { MOUNTAIN, mountainRoad } from '../src/road/mountain';
import { surfaceMesh } from '../src/road/surface';
import { mulberry32 } from '../src/ai/rng';
import { steerRange } from '../src/vehicles/handling';
import { speedPedals } from '../src/ai/driver';
import type { Centerline } from '../src/road/centerline';

/**
 * A car on the mountain road's surface mesh (Task 4/5 of docs/superpowers/plans/2026-11-15-mountain-road.md):
 *  - cruise: driven along it by a plain controller (at most 80 km/h, slowing for the bends) for 120 s - wheels on the
 *    ground, the body's height over the road, how far it got, NaN;
 *  - wall: let go straight on at 60 km/h before a hairpin - into the wall or the rail: how far past it, the hardest
 *    slow-down along the road (a seam's snag would spike), on the road after;
 *  - brake: from 100 km/h to a stop on a climb and on a descent (the same grade): the distances.
 *   npx vitest run --config training/vitest.config.ts training/mountainPhysics.train.ts
 * SEED (1): the road.
 */
const SEED = Number(process.env.SEED ?? 1);

function world(road: Centerline): PhysicsWorld {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const mesh = surfaceMesh(road, -MOUNTAIN.before, MOUNTAIN.length + MOUNTAIN.after, MOUNTAIN.edge + 1.5);
  physics.setRoad(road, { rails: { left: -MOUNTAIN.edge, right: MOUNTAIN.edge }, ground: mesh });
  return physics;
}

/** Steering toward d `aimD` along the road (its bends steered for). */
function steerFor(car: PlayerCar, road: Centerline, aimD: number): number {
  const range = steerRange(car.vLong, car.params);
  const ff = Math.atan(car.params.wheelbase * road.curvature(car.s + 2)) / range;
  const aimYaw = Math.max(-0.3, Math.min(0.3, 0.15 * (aimD - car.d)));
  return Math.max(-1, Math.min(1, ff + 3 * (aimYaw - car.yaw) - 0.25 * car.yawRate));
}

/** At most `top` (m/s), slowing for the sharpest bend within the next 40 m (0.6 g). */
function speedFor(car: PlayerCar, road: Centerline, top: number): number {
  let k = 0;
  for (let a = 0; a <= 40; a += 4) k = Math.max(k, Math.abs(road.curvature(car.s + a)));
  return k > 0 ? Math.min(top, Math.sqrt((0.6 * 9.81) / k)) : top;
}

function hairpinApex(road: Centerline): number {
  for (let s = 300; s < road.length; s += 1) if (Math.abs(road.curvature(s)) > 1 / 25.5) return s;
  throw new Error('no hairpin');
}

it('mountain physics', async () => {
  await RAPIER.init();
  const road = mountainRoad(mulberry32(SEED));
  const out: string[] = [`road seed ${SEED}: height ${Math.min(...sample(road, (s) => road.height(s))).toFixed(0)}..${Math.max(...sample(road, (s) => road.height(s))).toFixed(0)} m, min R ${road.minRadius.toFixed(1)}`];

  // Cruise.
  {
    const physics = world(road);
    const car = new PlayerCar(physics, null, { entity: { type: 'rival', id: 0 } });
    car.road = road;
    car.resetAt(5, 1.9, 0);
    let contact = 0, all = 0, hiOff = 0, loOff = 0, nan = false, spike = 0, lastV = 0;
    const steps = Math.round(120 / PHYSICS_DT);
    for (let i = 0; i < steps && car.s < road.length; i++) {
      const p = speedPedals(speedFor(car, road, 80 * KMH), car.vLong);
      car.prePhysics({ ...p, steer: steerFor(car, road, 1.9) }, PHYSICS_DT);
      physics.step(() => {});
      car.postPhysics();
      const t = car.body.translation();
      if (![t.x, t.y, t.z].every(Number.isFinite)) { nan = true; break; }
      const off = t.y - road.height(car.s);
      hiOff = Math.max(hiOff, off);
      loOff = Math.min(loOff, off);
      for (const w of car.wheels) { all++; if (w.inContact) contact++; }
      spike = Math.max(spike, (lastV - car.vLong) / PHYSICS_DT / 9.81);
      lastV = car.vLong;
    }
    out.push(`cruise: reached s ${car.s.toFixed(0)} of ${road.length.toFixed(0)}, wheels on the ground ${((100 * contact) / all).toFixed(1)} %, body over the road ${loOff.toFixed(2)}..${hiOff.toFixed(2)} m, hardest slow-down ${spike.toFixed(2)} g, d ${car.d.toFixed(2)}${nan ? '  NaN!' : ''}`);
    physics.free();
  }

  // Into the wall / rail at a hairpin.
  {
    const apex = hairpinApex(road);
    for (const kmh of [60, 100]) {
      const physics = world(road);
      const car = new PlayerCar(physics, null, { entity: { type: 'rival', id: 0 } });
      car.road = road;
      car.resetAt(apex - 45, 0, kmh * KMH);
      let past = 0, spike = 0, lastV = kmh * KMH, nan = false, under = 0;
      for (let i = 0; i < Math.round(4 / PHYSICS_DT); i++) {
        car.prePhysics({ throttle: 0.3, brake: 0, steer: 0 }, PHYSICS_DT);
        physics.step(() => {});
        car.postPhysics();
        const t = car.body.translation();
        if (![t.x, t.y, t.z].every(Number.isFinite)) { nan = true; break; }
        const fp = car.footprint();
        past = Math.max(past, fp.dMax - MOUNTAIN.edge, -MOUNTAIN.edge - fp.dMin);
        spike = Math.max(spike, (lastV - car.speed) / PHYSICS_DT / 9.81);
        lastV = car.speed;
        under = Math.min(under, t.y - road.height(car.s));
      }
      out.push(`wall at ${kmh} km/h (hairpin at s ${apex.toFixed(0)}, R ${(1 / Math.abs(road.curvature(apex))).toFixed(1)}): past the edge ${past.toFixed(2)} m, hardest slow-down ${spike.toFixed(1)} g, lowest body ${under.toFixed(2)} m over the road, ended at d ${car.d.toFixed(2)} ${(car.speed / KMH).toFixed(0)} km/h${nan ? '  NaN!' : ''}`);
      physics.free();
    }
  }

  // Braking on a climb and on a descent.
  {
    const steep = steepest(road);
    for (const [name, s0] of [['climb', steep.up], ['descent', steep.down]] as const) {
      const physics = world(road);
      const car = new PlayerCar(physics, null, { entity: { type: 'rival', id: 0 } });
      car.road = road;
      car.resetAt(s0 - 40, 1.9, 100 * KMH);
      for (let i = 0; i < Math.round(0.5 / PHYSICS_DT); i++) {
        car.prePhysics({ throttle: 0.5, brake: 0, steer: steerFor(car, road, 1.9) }, PHYSICS_DT);
        physics.step(() => {});
        car.postPhysics();
      }
      const from = car.s;
      const v0 = car.speed;
      const g = road.grade(car.s);
      for (let i = 0; i < Math.round(8 / PHYSICS_DT) && car.speed > 0.5; i++) {
        car.prePhysics({ throttle: 0, brake: 1, steer: steerFor(car, road, 1.9) }, PHYSICS_DT);
        physics.step(() => {});
        car.postPhysics();
      }
      out.push(`brake on the ${name} (grade ${(g * 100).toFixed(1)} %): from ${(v0 / KMH).toFixed(0)} km/h stopped in ${(car.s - from).toFixed(1)} m`);
      physics.free();
    }
  }
  process.stdout.write(out.join('\n') + '\n');
});

function sample(road: Centerline, f: (s: number) => number): number[] {
  const out: number[] = [];
  for (let s = 0; s <= road.length; s += 10) out.push(f(s));
  return out;
}

/** Where it climbs and falls the steepest along a straight-ish stretch (s). */
function steepest(road: Centerline): { up: number; down: number } {
  let up = 0, down = 0, gu = 0, gd = 0;
  for (let s = 100; s < road.length - 100; s += 5) {
    let flat = true;
    for (let a = -40; a <= 60; a += 5) if (Math.abs(road.curvature(s + a)) > 1 / 300) flat = false;
    if (!flat) continue;
    const g = road.grade(s);
    if (g > gu) { gu = g; up = s; }
    if (g < gd) { gd = g; down = s; }
  }
  return { up, down };
}
