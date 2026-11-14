import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';

beforeAll(async () => {
  await RAPIER.init();
});

describe('PlayerCar.applyMass', () => {
  it('its body takes its params\' mass and centre of mass anew (they were only read when it was built)', () => {
    const physics = PhysicsWorld.createSync();
    const car = new PlayerCar(physics, null, { entity: { type: 'rival', id: 0 } });
    physics.step(() => {}); // (its mass worked out in a step)
    const built = car.body.localCom().y;
    expect(built).toBeCloseTo(car.params.comY, 6);
    car.params.comY -= 0.15;
    car.applyMass();
    physics.step(() => {});
    expect(car.body.localCom().y).toBeCloseTo(built - 0.15, 6);
    expect(car.body.mass()).toBeCloseTo(car.params.mass, 3);
    physics.free();
  });
});
