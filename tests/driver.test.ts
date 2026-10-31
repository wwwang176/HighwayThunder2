import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createBrain } from '../src/ai/brain';
import { AiDriver, selfStateOf } from '../src/ai/driver';
import { BRAIN_LAYERS } from '../src/ai/evolution';
import { mulberry32 } from '../src/ai/rng';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { PHYSICS_DT } from '../src/config';

beforeAll(async () => {
  await RAPIER.init();
});

const self = { s: 0, d: 0, yaw: 0, vLong: 20, vLat: 0, yawRate: 0, speedCap: 83.3 };

describe('AiDriver', () => {
  it('a blank network holds the wheel straight at half throttle', () => {
    const b = createBrain(BRAIN_LAYERS, mulberry32(1));
    b.weights.fill(0);
    const input = new AiDriver(b).drive(self, []);
    expect(input.steer).toBe(0);
    expect(input.throttle).toBeCloseTo(0.5);
    expect(input.brake).toBe(0);
  });

  it('a slightly positive brake output does not brake (and so does not cut the engine)', () => {
    const b = createBrain(BRAIN_LAYERS, mulberry32(1));
    b.weights.fill(0);
    const n = b.weights.length;
    b.weights[n - 1] = 0.1; // brake output ~0.1
    b.weights[n - 1 - (16 + 1)] = 2; // throttle output ~0.96
    const input = new AiDriver(b).drive(self, []);
    expect(input.brake).toBe(0);
    expect(input.throttle).toBeGreaterThan(0.9);
  });

  it('outputs stay in range and braking hard lifts off the throttle', () => {
    const b = createBrain(BRAIN_LAYERS, mulberry32(2));
    b.weights.fill(0);
    const n = b.weights.length;
    b.weights[n - 1] = 5; // brake bias
    b.weights[n - 1 - (16 + 1)] = 5; // throttle bias
    const input = new AiDriver(b).drive(self, []);
    expect(input.brake).toBeGreaterThan(0.5);
    expect(input.throttle).toBe(0);
    const r = new AiDriver(createBrain(BRAIN_LAYERS, mulberry32(3))).drive(self, []);
    expect(Math.abs(r.steer)).toBeLessThanOrEqual(1);
    expect(r.throttle).toBeGreaterThanOrEqual(0);
    expect(r.throttle).toBeLessThanOrEqual(1);
    expect(r.brake).toBeGreaterThanOrEqual(0);
    expect(r.brake).toBeLessThanOrEqual(1);
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
