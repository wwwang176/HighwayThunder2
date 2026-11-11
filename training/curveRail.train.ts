import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { KMH, LEFT_RAIL_X, PHYSICS_DT, RAIL_D } from '../src/config';
import { bend, Centerline, straight, STRAIGHT_ROAD } from '../src/road/centerline';

/**
 * The curved road's guardrails (a plane per car near one: PhysicsWorld's rail slots): cars driven into them on a
 * bend, inside and outside, glancing and steep, two at once far apart. For each: how far past the rail the car got
 * (m; its box), the hardest slow-down along the road in a step (g: a snag on a seam would show as a spike), the
 * contact normals' largest share along the road (a plane's push is across it: ~0), and whether it ended on the road.
 *   npx vitest run --config training/vitest.config.ts training/curveRail.train.ts
 */
const RIGHT_BEND = new Centerline([...straight(200), ...bend(2000, 40, 200), ...straight(500)]);
const LEFT_BEND = new Centerline([...straight(200), ...bend(2000, -40, 200), ...straight(500)]);

interface Run {
  name: string;
  road: Centerline;
  /** Where each car starts (s, lane), how fast (km/h), the road-relative heading it holds (rad, + toward +d), for how long (s). */
  cars: { s: number; lane: number; kmh: number; aim: number }[];
  seconds: number;
}

const RUNS: Run[] = [
  { name: 'right bend, right rail (inside), glancing 3°, 250', road: RIGHT_BEND, cars: [{ s: 400, lane: 3, kmh: 250, aim: 0.05 }], seconds: 6 },
  { name: 'left bend, right rail (outside), glancing 3°, 250', road: LEFT_BEND, cars: [{ s: 400, lane: 3, kmh: 250, aim: 0.05 }], seconds: 6 },
  { name: 'right bend, right rail, steep 25°, 200', road: RIGHT_BEND, cars: [{ s: 600, lane: 2, kmh: 200, aim: 0.45 }], seconds: 3 },
  { name: 'left bend, left rail (inside), glancing 6°, 220', road: LEFT_BEND, cars: [{ s: 300, lane: 0, kmh: 220, aim: -0.1 }], seconds: 9 },
  // The straight road's fixed planes, for comparison.
  { name: 'straight, right rail, glancing 3°, 250', road: STRAIGHT_ROAD, cars: [{ s: 400, lane: 3, kmh: 250, aim: 0.05 }], seconds: 6 },
  { name: 'straight, right rail, steep 25°, 200', road: STRAIGHT_ROAD, cars: [{ s: 600, lane: 2, kmh: 200, aim: 0.45 }], seconds: 3 },
  {
    name: 'right bend, two cars 300 m apart on the right rail',
    road: RIGHT_BEND,
    cars: [
      { s: 400, lane: 3, kmh: 220, aim: 0.05 },
      { s: 700, lane: 3, kmh: 220, aim: 0.05 },
    ],
    seconds: 6,
  },
];

it('curved rails', async () => {
  await RAPIER.init();
  const out: string[] = [];
  for (const run of RUNS) {
    const physics = PhysicsWorld.createSync();
    physics.timestep = PHYSICS_DT;
    physics.setRoad(run.road);
    const cars = run.cars.map((c, k) => {
      const car = new PlayerCar(physics, null, { entity: { type: 'rival', id: k } }); // (with its body's colliders: not a ghost)
      car.road = run.road;
      car.params.maxSpeed = c.kmh * KMH;
      car.resetTo(c.s, c.lane, c.kmh * KMH);
      return { car, aim: c.aim, past: -Infinity, snag: 0, along: 0, lastV: c.kmh * KMH };
    });
    const steps = Math.round(run.seconds / PHYSICS_DT);
    for (let i = 0; i < steps; i++) {
      for (const c of cars) {
        const car = c.car;
        // Hold the heading against the road (steer > 0 turns toward +d), the road's bend steered for.
        const ff = (run.road.curvature(car.s) * car.params.wheelbase) / 0.12; // (about: full lock ~0.12 rad at speed)
        const steer = Math.max(-1, Math.min(1, ff + 6 * (c.aim - car.yaw) - 0.3 * car.yawRate));
        car.prePhysics({ throttle: 0.6, brake: 0, steer }, PHYSICS_DT);
      }
      physics.step(() => {});
      physics.touches((t) => {
        if (Math.abs(t.normal.y) > 0.7) return; // (the ground)
        for (const c of cars) {
          const p = c.car.body.translation();
          if (Math.hypot(t.mid.x - p.x, t.mid.z - p.z) > 6) continue;
          const f = run.road.forwardWorld(0, c.car.s);
          const len = Math.hypot(t.normal.x, t.normal.z);
          if (len > 1e-6) c.along = Math.max(c.along, Math.abs((t.normal.x * f.x + t.normal.z * f.z) / len));
        }
      });
      for (const c of cars) {
        const car = c.car;
        car.postPhysics();
        const fp = car.footprint();
        c.past = Math.max(c.past, fp.dMax - RAIL_D, LEFT_RAIL_X - fp.dMin);
        const v = car.vLong;
        c.snag = Math.max(c.snag, (c.lastV - v) / PHYSICS_DT / 9.81);
        c.lastV = v;
      }
    }
    for (const [k, c] of cars.entries()) {
      const onRoad = c.car.d < RAIL_D && c.car.d > LEFT_RAIL_X;
      out.push(
        `${run.name}${cars.length > 1 ? ` #${k + 1}` : ''}: past the rail ${c.past.toFixed(3)} m, hardest slow-down ${c.snag.toFixed(2)} g, ` +
          `normal along the road ${(c.along * 100).toFixed(1)} %, at s ${c.car.s.toFixed(0)} d ${c.car.d.toFixed(2)} yaw ${(c.car.yaw * 57.3).toFixed(1)}°, ` +
          `${(c.car.vLong / KMH).toFixed(0)} km/h${onRoad ? '' : '  OFF THE ROAD'}`,
      );
    }
    physics.free();
  }
  process.stdout.write(out.join('\n') + '\n');
});
