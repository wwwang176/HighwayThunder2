import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { selfStateOf, speedPedals } from '../src/ai/driver';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { PHYSICS_DT } from '../src/config';

beforeAll(async () => {
  await RAPIER.init();
});

describe('speedPedals', () => {
  it('full throttle well below the target, coasting just above it, braking well above', () => {
    expect(speedPedals(30, 20)).toEqual({ throttle: 1, brake: 0 });
    expect(speedPedals(30, 29).throttle).toBeGreaterThan(0);
    expect(speedPedals(30, 29).brake).toBe(0);
    expect(speedPedals(30, 30.5)).toEqual({ throttle: 0, brake: 0 }); // no brake for a little over: it cuts the engine
    expect(speedPedals(30, 40)).toEqual({ throttle: 0, brake: 1 });
    expect(speedPedals(30, 33).brake).toBeGreaterThan(0);
  });
});

describe('ghost PlayerCar', () => {
  it('builds without a scene and drives on the road', () => {
    const physics = PhysicsWorld.createSync();
    physics.timestep = PHYSICS_DT;
    const car = new PlayerCar(physics, null);
    car.resetTo(0, 1, 0);
    for (let i = 0; i < 240; i++) {
      car.prePhysics({ throttle: 0.6, brake: 0, steer: 0 }, PHYSICS_DT);
      physics.step(() => {});
      car.postPhysics();
    }
    expect(car.s).toBeGreaterThan(3);
    expect(car.body.translation().y).toBeGreaterThan(0.3);
    const st = selfStateOf(car, 50);
    expect(st.speedCap).toBe(50);
    expect(st.vLong).toBeGreaterThan(1);
    physics.free();
  });

  it('two ghosts drive through each other', () => {
    const physics = PhysicsWorld.createSync();
    physics.timestep = PHYSICS_DT;
    const a = new PlayerCar(physics, null);
    const b = new PlayerCar(physics, null);
    a.resetTo(0, 1, 10);
    b.resetTo(0, 1, 10);
    for (let i = 0; i < 120; i++) {
      for (const c of [a, b]) c.prePhysics({ throttle: 0.5, brake: 0, steer: 0 }, PHYSICS_DT);
      physics.step(() => {});
      for (const c of [a, b]) c.postPhysics();
    }
    expect(Math.abs(a.d - b.d)).toBeLessThan(0.05);
    expect(Math.abs(a.s - b.s)).toBeLessThan(0.05);
    physics.free();
  });
});
