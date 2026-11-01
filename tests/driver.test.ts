import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Brain, createBrain } from '../src/ai/brain';
import { AiDriver, selfStateOf, speedPedals } from '../src/ai/driver';
import { BRAIN_LAYERS } from '../src/ai/evolution';
import { mulberry32 } from '../src/ai/rng';
import type { TrafficBox } from '../src/ai/sensors';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { laneCenter } from '../src/road/coords';
import { PlayerCar } from '../src/vehicles/playerCar';
import { PHYSICS_DT } from '../src/config';

beforeAll(async () => {
  await RAPIER.init();
});

const self = { s: 0, d: laneCenter(1), yaw: 0, vLong: 20, vLat: 0, yawRate: 0, speedCap: 83.3 };
const ROW = 16 + 1;

/** A network that ignores its inputs: lane output and target speed (fraction of the cap) set by the output biases. */
function constant(lane: number, speed = 0.5): Brain {
  const b = createBrain(BRAIN_LAYERS, mulberry32(1));
  b.weights.fill(0);
  const n = b.weights.length;
  b.weights[n - 2 * ROW + 16] = lane;
  b.weights[n - 1 * ROW + 16] = Math.atanh(speed * 2 - 1);
  return b;
}

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

describe('AiDriver', () => {
  it('a blank network keeps its lane and aims for half its top speed', () => {
    const b = createBrain(BRAIN_LAYERS, mulberry32(1));
    b.weights.fill(0);
    const ai = new AiDriver(b);
    const input = ai.drive(self, []); // 20 m/s, cap 83.3: target 41.7
    expect(input.steer).toBeCloseTo(0, 5);
    expect(input.throttle).toBe(1);
    expect(input.brake).toBe(0);
    expect(ai.targetLane).toBe(1);
    expect(ai.drive({ ...self, vLong: 60 }, []).brake).toBe(1);
  });

  it('the speed output is a target speed from standing to 300 km/h, never over the cap', () => {
    expect(new AiDriver(constant(0, 1)).drive({ ...self, vLong: 80 }, []).throttle).toBeGreaterThan(0);
    expect(new AiDriver(constant(0, 0)).drive({ ...self, vLong: 3 }, []).brake).toBeGreaterThan(0);
    // The same network drives the same whatever the cap (150 km/h wanted), the cap only limits it.
    const blank = () => new AiDriver(constant(0, 0.5));
    expect(blank().drive({ ...self, vLong: 40, speedCap: 83.3 }, []).throttle).toBeGreaterThan(0);
    expect(blank().drive({ ...self, vLong: 40, speedCap: 60 }, []).throttle).toBeGreaterThan(0);
    expect(blank().drive({ ...self, vLong: 30, speedCap: 30 }, []).throttle).toBe(0);
  });

  it('the lane output picks a neighbouring lane; small outputs keep the lane', () => {
    const keep = new AiDriver(constant(0.1));
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
    expect(ai.changingLanes).toBe(true);
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

  it('adaptive cruise: never runs into what is ahead in its lane, whatever speed the network wants', () => {
    const fast = { ...self, vLong: 30 }; // wants 150 km/h (41.7 m/s)
    const slowAhead = (lane: number, gap: number): TrafficBox => ({ s: 2.2 + gap + 2.25, dMin: laneCenter(lane) - 0.9, dMax: laneCenter(lane) + 0.9, v: 15, length: 4.5 });
    const blocked = new AiDriver(constant(0, 0.5)).drive(fast, [slowAhead(1, 25)]);
    expect(blocked.throttle).toBe(0);
    expect(blocked.brake).toBeGreaterThan(0.3);
    expect(new AiDriver(constant(0, 0.5)).drive(fast, [slowAhead(2, 25)]).throttle).toBe(1); // next lane: not in the way
    expect(new AiDriver(constant(0, 0.5)).drive(fast, [slowAhead(1, 290)]).throttle).toBe(1); // far: no need yet
    // Moving into lane 2: what is ahead there counts too.
    expect(new AiDriver(constant(1, 0.5)).drive(fast, [slowAhead(2, 25)]).brake).toBeGreaterThan(0.3);
  });

  it('outputs stay in range', () => {
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
