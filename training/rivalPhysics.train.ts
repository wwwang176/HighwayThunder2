// Whole-system check: rival / player / ghost bodies really collide (or not) in the physics world.
//   npx vitest run --config training/vitest.config.ts training/rivalPhysics.train.ts
import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { EntityRef, PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { KMH, PHYSICS_DT } from '../src/config';

beforeAll(async () => {
  await RAPIER.init();
});

/** Car `a` runs into the back of car `b` (same lane, 20 m apart, 60 vs 20 km/h): the contacts reported. */
function rearEnd(a: (p: PhysicsWorld) => PlayerCar, b: (p: PhysicsWorld) => PlayerCar): string[] {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const back = a(physics);
  const front = b(physics);
  back.resetTo(0, 1, 60 * KMH);
  front.resetTo(20, 1, 20 * KMH);
  const seen = new Set<string>();
  const name = (e: EntityRef) => (e.type === 'rival' ? `rival${e.id}` : e.type);
  for (let i = 0; i < 4 / PHYSICS_DT; i++) {
    back.prePhysics({ steer: 0, throttle: 0.6, brake: 0 }, PHYSICS_DT);
    front.prePhysics({ steer: 0, throttle: 0, brake: 0 }, PHYSICS_DT);
    physics.step((x, y) => seen.add([name(x), name(y)].sort().join('-')));
    back.postPhysics();
    front.postPhysics();
  }
  physics.free();
  return [...seen];
}

describe('rival cars in the physics world', () => {
  it('two rivals hit each other', () => {
    const seen = rearEnd(
      (p) => new PlayerCar(p, null, { entity: { type: 'rival', id: 1 } }),
      (p) => new PlayerCar(p, null, { entity: { type: 'rival', id: 2 } }),
    );
    expect(seen).toContain('rival1-rival2');
  });

  it('a rival and the player hit each other', () => {
    const seen = rearEnd(
      (p) => new PlayerCar(p, null, { entity: { type: 'rival', id: 1 } }),
      (p) => new PlayerCar(p, null, { entity: { type: 'player' } }),
    );
    expect(seen).toContain('player-rival1');
  });

  it('training ghosts still pass through everything', () => {
    const seen = rearEnd(
      (p) => new PlayerCar(p, null),
      (p) => new PlayerCar(p, null),
    );
    expect(seen).toEqual([]);
  });
});
