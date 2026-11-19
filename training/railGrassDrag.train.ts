import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar, SURFACE_DRAG } from '../src/vehicles/playerCar';
import { KMH, LEFT_RAIL_X, PHYSICS_DT, RAIL_D } from '../src/config';
import { surfaceGrip } from '../src/road/coords';
import { bend, Centerline, straight, STRAIGHT_ROAD } from '../src/road/centerline';

/**
 * What a scrape along a guardrail and the tyres in grass take off a car's speed (PlayerCar SURFACE_DRAG), each run
 * with the drag off (as before) and on: its speed 1, 2, 3 s in (km/h), how far it leaned over at most (deg), and
 * whether it ended on the road upright.
 *   npx vitest run --config training/vitest.config.ts training/railGrassDrag.train.ts
 */
const LEFT_BEND = new Centerline([...straight(200), ...bend(2000, -40, 200), ...straight(500)]);

interface Run {
  name: string;
  road: Centerline;
  /** Where it starts (s, d), how fast (km/h), the road-relative heading it holds (rad, + toward +d), its throttle. */
  s: number;
  d: number;
  kmh: number;
  aim: number;
  throttle: number;
  seconds: number;
}

const RUNS: Run[] = [
  { name: 'rail, straight, glancing 3°, 200, throttle 0.6', road: STRAIGHT_ROAD, s: 400, d: 6, kmh: 200, aim: 0.05, throttle: 0.6, seconds: 3 },
  { name: 'rail, straight, 10°, 200, throttle 0.6', road: STRAIGHT_ROAD, s: 400, d: 4, kmh: 200, aim: 0.17, throttle: 0.6, seconds: 3 },
  { name: 'rail, straight, 25°, 150, coasting', road: STRAIGHT_ROAD, s: 400, d: 2, kmh: 150, aim: 0.45, throttle: 0, seconds: 3 },
  { name: 'rail, left bend (outside), glancing 3°, 200, throttle 0.6', road: LEFT_BEND, s: 400, d: 6, kmh: 200, aim: 0.05, throttle: 0.6, seconds: 3 },
  { name: 'grass, all four, coasting from 150', road: STRAIGHT_ROAD, s: 400, d: -15, kmh: 150, aim: 0, throttle: 0, seconds: 3 },
  { name: 'grass, all four, full throttle from 100', road: STRAIGHT_ROAD, s: 400, d: -15, kmh: 100, aim: 0, throttle: 1, seconds: 3 },
  { name: 'grass, left two (at the median edge), full throttle from 100', road: STRAIGHT_ROAD, s: 400, d: -10, kmh: 100, aim: 0, throttle: 1, seconds: 3 },
  { name: 'asphalt, coasting from 150 (for comparison)', road: STRAIGHT_ROAD, s: 400, d: 0, kmh: 150, aim: 0, throttle: 0, seconds: 3 },
];

function drive(run: Run): { at: number[]; lean: number; ok: boolean } {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  physics.setRoad(run.road);
  const car = new PlayerCar(physics, null, { entity: { type: 'rival', id: 0 } }); // (its body's colliders: it meets the rails)
  car.road = run.road;
  car.surfaceGrip = surfaceGrip;
  car.resetAt(run.s, run.d, run.kmh * KMH);
  const at: number[] = [];
  let lean = 0;
  const steps = Math.round(run.seconds / PHYSICS_DT);
  for (let i = 1; i <= steps; i++) {
    const ff = (run.road.curvature(car.s) * car.params.wheelbase) / 0.12;
    const steer = Math.max(-1, Math.min(1, ff + 6 * (run.aim - car.yaw) - 0.3 * car.yawRate));
    car.prePhysics({ throttle: run.throttle, brake: 0, steer }, PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
    const r = car.body.rotation();
    const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
    lean = Math.max(lean, (Math.acos(Math.min(1, upY)) * 180) / Math.PI);
    if (i % Math.round(1 / PHYSICS_DT) === 0) {
      const v = car.body.linvel();
      at.push(Math.hypot(v.x, v.z) / KMH);
    }
  }
  const r = car.body.rotation();
  const ok = car.d < RAIL_D && car.d > LEFT_RAIL_X && 1 - 2 * (r.x * r.x + r.z * r.z) > 0.9;
  physics.free();
  return { at, lean, ok };
}

it('rail and grass drag', async () => {
  await RAPIER.init();
  const on = { ...SURFACE_DRAG };
  const out: string[] = [];
  for (const run of RUNS) {
    SURFACE_DRAG.rail = 0;
    SURFACE_DRAG.grass = 0;
    const before = drive(run);
    Object.assign(SURFACE_DRAG, on);
    const after = drive(run);
    const fmt = (r: { at: number[]; lean: number; ok: boolean }) =>
      `${r.at.map((v) => v.toFixed(0)).join(' / ')} km/h, lean ${r.lean.toFixed(1)}°${r.ok ? '' : '  OFF / OVER'}`;
    out.push(`${run.name}\n  off: ${fmt(before)}\n  on:  ${fmt(after)}   (3 s: ${(after.at[2] - before.at[2]).toFixed(1)} km/h)`);
  }
  Object.assign(SURFACE_DRAG, on);
  process.stdout.write(out.join('\n') + '\n');
});
