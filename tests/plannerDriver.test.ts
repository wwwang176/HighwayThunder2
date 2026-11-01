import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { selfStateOf } from '../src/ai/driver';
import { touching } from '../src/ai/fitness';
import { planAt, plan, Plan, PlanEgo, PreviousPlan } from '../src/ai/planner';
import { PlannerDriver, PlanSource } from '../src/ai/plannerDriver';
import type { TrafficBox } from '../src/ai/sensors';
import { KMH, PHYSICS_DT } from '../src/config';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { laneAt, laneCenter } from '../src/road/coords';
import { PlayerCar } from '../src/vehicles/playerCar';

beforeAll(async () => {
  await RAPIER.init();
});

const box = (s: number, lane: number, kmh: number, length = 4.5, width = 1.85): TrafficBox => ({
  id: lane * 100 + s,
  s,
  dMin: laneCenter(lane) - width / 2,
  dMax: laneCenter(lane) + width / 2,
  v: kmh * KMH,
  length,
});

/** The player car driven by a PlannerDriver for `seconds` through boxes moving at their own speeds. */
function drive(kmh: number, lane: number, boxes: TrafficBox[], seconds: number) {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const car = new PlayerCar(physics, null);
  car.params.maxSpeed = 300 * KMH;
  car.resetTo(0, lane, kmh * KMH);
  const ai = new PlannerDriver();
  let touched = 0;
  let maxD = -Infinity;
  for (let i = 0; i < Math.round(seconds / PHYSICS_DT); i++) {
    car.prePhysics(ai.drive(selfStateOf(car, 300 * KMH), boxes, car.params), PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
    for (const b of boxes) b.s += b.v * PHYSICS_DT;
    if (touching(car.s, car.d, car.yaw, boxes).length) touched++;
    maxD = Math.max(maxD, car.d);
  }
  physics.free();
  return { car, touched, maxD };
}

describe('planAt', () => {
  it('interpolates between plan points', () => {
    const p = plan({ s: 0, d: laneCenter(1), v: 20, speedCap: 300 * KMH }, []);
    const a = planAt(p, 0.25);
    expect(a.s).toBeGreaterThan(p.points[0].s);
    expect(a.s).toBeLessThan(p.points[1].s);
    expect(planAt(p, 99).s).toBe(p.points[p.points.length - 1].s);
  });
});

/** A PlanSource that answers a few steps late, like a Web Worker. */
class LateSource implements PlanSource {
  private queue: { due: number; stamp: number; plan: Plan }[] = [];
  private steps = 0;
  requests = 0;
  constructor(private readonly delaySteps: number) {}
  get busy() {
    return this.queue.length > 0;
  }
  request(stamp: number, ego: PlanEgo, traffic: TrafficBox[], previous: PreviousPlan | null): void {
    this.requests++;
    this.queue.push({ due: this.steps + this.delaySteps, stamp, plan: plan(ego, traffic, previous) });
  }
  take() {
    this.steps++;
    if (!this.queue.length || this.queue[0].due > this.steps) return null;
    return this.queue.shift()!;
  }
}

describe('PlannerDriver with plans worked out elsewhere', () => {
  it('follows plans that arrive a few steps late as if they had not', () => {
    const physics = PhysicsWorld.createSync();
    physics.timestep = PHYSICS_DT;
    const car = new PlayerCar(physics, null);
    car.params.maxSpeed = 300 * KMH;
    car.resetTo(0, 1, 150 * KMH);
    const source = new LateSource(4);
    const ai = new PlannerDriver(source);
    const boxes = [box(40, 1, 80)];
    let touched = 0;
    for (let i = 0; i < Math.round(8 / PHYSICS_DT); i++) {
      car.prePhysics(ai.drive(selfStateOf(car, 300 * KMH), boxes, car.params), PHYSICS_DT);
      physics.step(() => {});
      car.postPhysics();
      for (const b of boxes) b.s += b.v * PHYSICS_DT;
      if (touching(car.s, car.d, car.yaw, boxes).length) touched++;
    }
    expect(touched).toBe(0);
    expect(car.s).toBeGreaterThan(boxes[0].s + 10);
    expect(source.requests).toBeGreaterThan(20); // replanning all along, one request at a time
    physics.free();
  });

  it('drops an answer for the car as it was before a reset', () => {
    const source = new LateSource(3);
    const ai = new PlannerDriver(source);
    const self = { s: 0, d: laneCenter(1), yaw: 0, vLong: 30, vLat: 0, yawRate: 0, speedCap: 80 };
    ai.drive(self, []);
    ai.reset();
    ai.drive({ ...self, s: 500, d: laneCenter(3) }, []);
    ai.drive({ ...self, s: 500, d: laneCenter(3) }, []);
    expect(ai.plan === null || ai.plan.points[0].s === 500).toBe(true);
  });
});

describe('PlannerDriver', () => {
  it('empty road: flat out, holding its lane', () => {
    const { car, touched, maxD } = drive(100, 1, [], 6);
    expect(touched).toBe(0);
    expect(car.speed).toBeGreaterThan(140 * KMH);
    expect(maxD).toBeLessThan(laneCenter(1) + 0.3);
  });

  it('slips round a slow car without touching it', () => {
    const boxes = [box(40, 1, 80)];
    const { car, touched } = drive(150, 1, boxes, 8);
    expect(touched).toBe(0);
    expect(car.s).toBeGreaterThan(boxes[0].s + 10);
  });

  it('cuts across three lanes on a diagonal when only the far lane is free', () => {
    const boxes = [box(25, 3, 70, 8.5, 2.4), box(35, 2, 75), box(35, 1, 75)];
    const { car, touched } = drive(110, 3, boxes, 8);
    expect(touched).toBe(0);
    expect(laneAt(car.d)).toBe(0);
    expect(car.s).toBeGreaterThan(Math.max(...boxes.map((b) => b.s)));
  });

  it('four abreast and staying that way: rides the bumper of the fastest, never into it', () => {
    const boxes = [box(30, 0, 100), box(30, 1, 100), box(30, 2, 110), box(30, 3, 100)];
    for (const t of [...boxes]) boxes.push({ ...t, id: (t.id ?? 0) + 1, s: t.s + 12 });
    const { car, touched } = drive(130, 1, boxes, 8);
    expect(touched).toBe(0);
    expect(laneAt(car.d)).toBe(2);
    // Right behind it: under 20 m centre to centre (~13 m bumper to bumper, 0.4 s at 110 km/h; the
    // plan keeps ~5 m, the car lags its speed changes a little).
    expect(boxes[2].s - car.s).toBeLessThan(20);
  });
});
