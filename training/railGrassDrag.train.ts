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
const LEFT_BEND =new Centerline([...straight(200), ...bend(2000, -40, 200), ...straight(500)]);

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
  /** Put this far (m) above the ground to start: in the air till it lands (its speed as it lands, km/h, shown). */
  lift?: number;
  /** Start already turned to `aim`, going that way (else: along the road, turning to it). */
  turned?: boolean;
}

const RUNS: Run[] = [
  { name: 'rail, straight, glancing 3°, 200, throttle 0.6', road: STRAIGHT_ROAD, s: 400, d: 6, kmh: 200, aim: 0.05, throttle: 0.6, seconds: 3 },
  { name: 'rail, straight, 10°, 200, throttle 0.6', road: STRAIGHT_ROAD, s: 400, d: 4, kmh: 200, aim: 0.17, throttle: 0.6, seconds: 3 },
  { name: 'rail, straight, 25°, 150, coasting', road: STRAIGHT_ROAD, s: 400, d: 2, kmh: 150, aim: 0.45, throttle: 0, seconds: 3 },
  { name: 'rail, straight, 45°, 150, coasting', road: STRAIGHT_ROAD, s: 400, d: 2, kmh: 150, aim: 0.785, throttle: 0, seconds: 3 },
  { name: 'rail, straight, head-on 90° (sent straight at it), 100, coasting', road: STRAIGHT_ROAD, s: 400, d: 2, kmh: 100, aim: 1.571, throttle: 0, seconds: 3, turned: true },
  { name: 'rail, straight, 60° (sent at it so), 100, coasting', road: STRAIGHT_ROAD, s: 400, d: 2, kmh: 100, aim: 1.047, throttle: 0, seconds: 3, turned: true },
  { name: 'rail, straight, glancing 3°, 60, throttle 0.6', road: STRAIGHT_ROAD, s: 400, d: 8, kmh: 60, aim: 0.05, throttle: 0.6, seconds: 3 },
  { name: 'rail, straight, 10°, 60, throttle 0.6', road: STRAIGHT_ROAD, s: 400, d: 7, kmh: 60, aim: 0.17, throttle: 0.6, seconds: 3 },
  { name: 'rail, straight, 10°, 90, throttle 0.6', road: STRAIGHT_ROAD, s: 400, d: 6, kmh: 90, aim: 0.17, throttle: 0.6, seconds: 3 },
  { name: 'rail, straight, 25°, 80, coasting', road: STRAIGHT_ROAD, s: 400, d: 5, kmh: 80, aim: 0.45, throttle: 0, seconds: 3 },
  { name: 'rail, left bend (outside), glancing 3°, 200, throttle 0.6', road: LEFT_BEND, s: 400, d: 6, kmh: 200, aim: 0.05, throttle: 0.6, seconds: 3 },
  { name: 'grass, all four, coasting from 150', road: STRAIGHT_ROAD, s: 400, d: -15, kmh: 150, aim: 0, throttle: 0, seconds: 3 },
  { name: 'grass, all four, full throttle from 100', road: STRAIGHT_ROAD, s: 400, d: -15, kmh: 100, aim: 0, throttle: 1, seconds: 3 },
  { name: 'grass, left two (at the median edge), full throttle from 100', road: STRAIGHT_ROAD, s: 400, d: -10, kmh: 100, aim: 0, throttle: 1, seconds: 3 },
  { name: 'asphalt, coasting from 150 (for comparison)', road: STRAIGHT_ROAD, s: 400, d: 0, kmh: 150, aim: 0, throttle: 0, seconds: 3 },
  { name: 'asphalt by the grass (its left wheels 0.2 m off it), coasting from 150', road: STRAIGHT_ROAD, s: 400, d: -9, kmh: 150, aim: 0, throttle: 0, seconds: 3 },
  { name: 'over the grass in the air (dropped from 1.5 m), coasting from 150', road: STRAIGHT_ROAD, s: 400, d: -15, kmh: 150, aim: 0, throttle: 0, seconds: 3, lift: 1.5 },
];

function drive(run: Run): { at: number[]; lean: number; ok: boolean; landed: number | null } {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  physics.setRoad(run.road);
  const car = new PlayerCar(physics, null, { entity: { type: 'rival', id: 0 } }); // (its body's colliders: it meets the rails)
  car.road = run.road;
  car.surfaceGrip = surfaceGrip;
  car.resetAt(run.s, run.d, run.kmh * KMH);
  if (run.lift) {
    const t = car.body.translation();
    car.body.setTranslation({ x: t.x, y: t.y + run.lift, z: t.z }, true);
  }
  if (run.turned) {
    // (turned about up by -aim: + aim toward +d, the body's yaw the other way round; its velocity with it)
    const a = -run.aim;
    const q = car.body.rotation();
    const s = Math.sin(a / 2), c = Math.cos(a / 2);
    car.body.setRotation({ x: c * q.x + s * q.z, y: c * q.y + s * q.w, z: c * q.z - s * q.x, w: c * q.w - s * q.y }, true);
    const v = car.body.linvel();
    car.body.setLinvel({ x: v.x * Math.cos(a) + v.z * Math.sin(a), y: v.y, z: -v.x * Math.sin(a) + v.z * Math.cos(a) }, true);
  }
  const at: number[] = [];
  let lean = 0;
  let landed: number | null = null;
  let air = run.kmh;
  const steps = Math.round(run.seconds / PHYSICS_DT);
  for (let i = 1; i <= steps; i++) {
    const ff = (run.road.curvature(car.s) * car.params.wheelbase) / 0.12;
    const steer = Math.max(-1, Math.min(1, ff + 6 * (run.aim - car.yaw) - 0.3 * car.yawRate));
    car.prePhysics({ throttle: run.throttle, brake: 0, steer }, PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
    // (its speed the step before a wheel first touched: all the way down in the air)
    const v0 = car.body.linvel();
    if (run.lift && landed === null && car.wheels.some((w) => w.inContact)) landed = air;
    air = Math.hypot(v0.x, v0.z) / KMH;
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
  return { at, lean, ok, landed };
}

it('rail and grass drag', async () => {
  await RAPIER.init();
  const on = { ...SURFACE_DRAG };
  const out: string[] = [];
  // (each run with the drag off, then at each scale of SURFACE_DRAG's own: x1 is the game's)
  // (and RAIL_LOWS: each railLow tried in turn; ONLY: the runs whose names have it)
  const scales = (process.env.DRAG_SCALES ?? '1').split(',').map(Number);
  const lows = process.env.RAIL_LOWS ? process.env.RAIL_LOWS.split(',').map(Number) : [on.railLow];
  if (process.env.RAIL_FULL) on.railFullKmh = Number(process.env.RAIL_FULL);
  SURFACE_DRAG.railFullKmh = on.railFullKmh;
  for (const run of RUNS.filter((r) => !process.env.ONLY || r.name.includes(process.env.ONLY))) {
    SURFACE_DRAG.rail = 0;
    SURFACE_DRAG.railLow = 0;
    SURFACE_DRAG.grass = 0;
    const before = drive(run);
    const fmt = (r: { at: number[]; lean: number; ok: boolean; landed: number | null }) =>
      `${r.landed !== null ? `landing at ${r.landed.toFixed(2)}, then ` : ''}${r.at.map((v) => v.toFixed(0)).join(' / ')} km/h, lean ${r.lean.toFixed(1)}°${r.ok ? '' : '  OFF / OVER'}`;
    const lines = [`${run.name}\n  off:  ${fmt(before)}`];
    for (const k of scales) {
      for (const low of lows) {
        SURFACE_DRAG.rail = on.rail * k;
        SURFACE_DRAG.railLow = low * k;
        SURFACE_DRAG.grass = on.grass * k;
        const after = drive(run);
        lines.push(`  x${k}${lows.length > 1 ? ` low ${low}` : ''}: ${fmt(after)}   (3 s: ${(after.at[2] - before.at[2]).toFixed(1)} km/h)`);
      }
    }
    out.push(lines.join('\n'));
  }
  Object.assign(SURFACE_DRAG, on);
  process.stdout.write(out.join('\n') + '\n');
});
