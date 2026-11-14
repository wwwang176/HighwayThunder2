import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { bend, Centerline, straight } from '../src/road/centerline';
import { surfaceMesh } from '../src/road/surface';
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
