import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Brain, createBrain } from '../src/ai/brain';
import { AiDriver, selfStateOf } from '../src/ai/driver';
import { BRAIN_LAYERS } from '../src/ai/evolution';
import { mulberry32 } from '../src/ai/rng';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { laneCenter } from '../src/road/coords';
import { PlayerCar } from '../src/vehicles/playerCar';
import { PHYSICS_DT } from '../src/config';

beforeAll(async () => {
  await RAPIER.init();
});

const self = { s: 0, d: laneCenter(1), yaw: 0, vLong: 20, vLat: 0, yawRate: 0, speedCap: 83.3 };
const ROW = 16 + 1;

/** A network that ignores its inputs: lane choice and throttle set by the output biases. */
function constant(lane: number, throttle = 0.5): Brain {
  const b = createBrain(BRAIN_LAYERS, mulberry32(1));
  b.weights.fill(0);
  const n = b.weights.length;
  b.weights[n - 3 * ROW + 16] = lane;
  b.weights[n - 2 * ROW + 16] = Math.atanh(throttle * 2 - 1);
  b.weights[n - 1 * ROW + 16] = -3; // no brake
  return b;
}

describe('AiDriver', () => {
  it('a blank network keeps its lane at half throttle', () => {
    const b = createBrain(BRAIN_LAYERS, mulberry32(1));
    b.weights.fill(0);
    const ai = new AiDriver(b);
    const input = ai.drive(self, []);
    expect(input.steer).toBeCloseTo(0, 5);
    expect(input.throttle).toBeCloseTo(0.5);
    expect(input.brake).toBe(0);
    expect(ai.targetLane).toBe(1);
  });

  it('the lane output picks a neighbouring lane; small outputs keep the lane', () => {
    const keep = new AiDriver(constant(0.3));
    keep.drive(self, []);
    expect(keep.targetLane).toBe(1);
    const right = new AiDriver(constant(2));
    expect(right.drive(self, []).steer).toBeGreaterThan(0);
    expect(right.targetLane).toBe(2);
    const left = new AiDriver(constant(-2));
    expect(left.drive(self, []).steer).toBeLessThan(0);
    expect(left.targetLane).toBe(0);
  });

  it('one lane at a time: no new choice until the change is done, none past the edge', () => {
    const ai = new AiDriver(constant(2));
    ai.drive(self, []);
    for (let i = 0; i < 60; i++) ai.drive(self, []); // half a second, car not moved
    expect(ai.targetLane).toBe(2);
    const edge = new AiDriver(constant(2));
    edge.drive({ ...self, d: laneCenter(3) }, []);
    expect(edge.targetLane).toBe(3);
  });

  it('follows the car to wherever it was put (reset, respawn, AI switched on)', () => {
    const ai = new AiDriver(constant(0));
    ai.drive(self, []);
    ai.drive({ ...self, d: laneCenter(3) }, []);
    expect(ai.targetLane).toBe(3);
    ai.reset(laneCenter(0));
    expect(ai.targetLane).toBe(0);
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
