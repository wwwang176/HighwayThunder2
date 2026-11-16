import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld, railRotation } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { bend, Centerline, straight } from '../src/road/centerline';
import { surfaceMesh } from '../src/road/surface';
import { MOUNTAIN, roadEdges } from '../src/road/mountain';
import { PHYSICS_DT } from '../src/config';

beforeAll(async () => {
  await RAPIER.init();
});

const EDGE = 4.75;
/** A switchback: up one leg, round a hairpin, back down the other 40 m beside it. */
const ROAD = new Centerline([...straight(150), ...bend(20, 180, 10), ...straight(200)], { turnBack: true });
const HAIRPIN = 20 * Math.PI + 10;

describe('the rails on a road that turns back', () => {
  it('a car put on the other leg (a put-back far along the road) meets its own leg\'s rails, not the old one\'s', () => {
    const physics = PhysicsWorld.createSync();
    physics.timestep = PHYSICS_DT;
    physics.setRoad(ROAD, { rails: { left: -EDGE, right: EDGE }, ground: surfaceMesh(ROAD, -50, ROAD.length + 50, EDGE + 1.5) });
    const car = new PlayerCar(physics, null, { entity: { type: 'rival', id: 0 } });
    car.road = ROAD;
    car.resetAt(120, 3.5, 10); // (near its right rail: its slot taken, the rail found from here)
    for (let i = 0; i < 30; i++) {
      car.prePhysics({ throttle: 0, brake: 0, steer: 0 }, PHYSICS_DT);
      physics.step(() => {});
      car.postPhysics();
    }
    // Put back on the other leg, level with where it was (40 m across): its slot's last place is no hint now.
    car.resetAt(150 + HAIRPIN + 30, 3.5, 10);
    let fastest = 0;
    for (let i = 0; i < 120; i++) {
      car.prePhysics({ throttle: 0, brake: 0, steer: 0 }, PHYSICS_DT);
      physics.step(() => {});
      car.postPhysics();
      fastest = Math.max(fastest, car.speed);
    }
    expect(fastest).toBeLessThan(15);
    expect(Math.abs(car.d)).toBeLessThan(EDGE);
    physics.free();
  });
});

describe('railRotation (a rail\'s plane square to the road\'s surface, banked as it is)', () => {
  /** +x (the plane's local normal) turned by q. */
  const turn = (q: { x: number; y: number; z: number; w: number }) => {
    const { x, y, z, w } = q;
    return { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + w * z), z: 2 * (x * z - w * y) };
  };
  for (const [phi, slope, side] of [[0.3, 0.2, -1], [2.1, -0.15, 1], [-1.2, 0.21, 1], [3.0, 0, -1]] as [number, number, 1 | -1][]) {
    it(`its normal in the surface across the road, facing into it (heading ${phi}, slope ${slope}, side ${side})`, () => {
      const n = turn(railRotation(phi, slope, side));
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 9);
      // across the road on its surface: (its horizontal, rising `slope` a metre toward +d) - into the road `side` way
      const h = Math.hypot(n.x, n.z);
      expect(n.x / h).toBeCloseTo(Math.cos(phi), 9);
      expect(-n.z / h).toBeCloseTo(Math.sin(phi), 9);
      expect(n.y / h).toBeCloseTo(side * slope, 9);
    });
  }
});

describe('the rails along a shoulder (roadEdges: the rail as wide as the road is there)', () => {
  const hairpin = new Centerline([...straight(150), ...bend(20, 180, 10), ...straight(150)], { turnBack: true });
  const mid = 150 + 5 + 10 * Math.PI;
  const edges = roadEdges(hairpin);
  const out = edges.at(mid, -1); // (its outside: left of a right turn)

  function run(d: number, outward: number) {
    const physics = PhysicsWorld.createSync();
    physics.timestep = PHYSICS_DT;
    physics.setRoad(hairpin, {
      rails: { left: (s) => -edges.at(s, -1), right: (s) => edges.at(s, 1) },
      ground: surfaceMesh(hairpin, -50, hairpin.length + 50, (s) => [-edges.at(s, -1) - 1.5, edges.at(s, 1) + 1.5]),
    });
    const car = new PlayerCar(physics, null, { entity: { type: 'rival', id: 0 } });
    car.road = hairpin;
    car.resetAt(mid, d, 0);
    const th = hairpin.heading(mid);
    car.body.setLinvel({ x: -Math.cos(th) * outward, y: 0, z: -Math.sin(th) * outward }, true); // (toward its left)
    let least = Infinity;
    for (let i = 0; i < 90; i++) {
      car.prePhysics({ throttle: 0, brake: 1, steer: 0 }, PHYSICS_DT);
      physics.step(() => {});
      car.postPhysics();
      least = Math.min(least, car.d);
    }
    const r = { d: car.d, least, y: car.body.translation().y, floor: hairpin.surfaceHeight(car.s, car.d) };
    physics.free();
    return r;
  }

  it('a car standing on the shoulder stays there, on its banked surface', () => {
    const r = run(-(MOUNTAIN.edge + 1.5), 0);
    expect(r.d).toBeCloseTo(-(MOUNTAIN.edge + 1.5), 0);
    expect(Math.abs(r.y - r.floor)).toBeLessThan(0.8);
  });

  it('a car sliding out across it is stopped at its edge, not at the road\'s old one nor past it', () => {
    const r = run(-(MOUNTAIN.edge + 1.5), 6);
    expect(r.least).toBeLessThan(-(MOUNTAIN.edge + 0.5));
    expect(r.least).toBeGreaterThan(-out - 0.2);
  });
});
