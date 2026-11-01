import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { LaneController } from '../src/ai/laneController';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { laneCenter } from '../src/road/coords';
import { PlayerCar } from '../src/vehicles/playerCar';
import { KMH, PHYSICS_DT } from '../src/config';

beforeAll(async () => {
  await RAPIER.init();
});

/** Car at a steady speed in `lane`; returns a stepper that lets the controller steer. */
function rig(kmh: number, lane: number) {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const car = new PlayerCar(physics, null);
  car.params.maxSpeed = kmh * KMH;
  car.resetTo(0, lane, kmh * KMH);
  const lc = new LaneController(lane);
  const step = (seconds: number, watch?: () => void) => {
    for (let i = 0, n = Math.round(seconds / PHYSICS_DT); i < n; i++) {
      lc.update(PHYSICS_DT);
      const steer = lc.steer(car.d, car.yaw, car.vLong, car.vLat, car.params);
      car.prePhysics({ steer, throttle: 1, brake: 0 }, PHYSICS_DT);
      physics.step(() => {});
      car.postPhysics();
      watch?.();
    }
  };
  return { physics, car, lc, step };
}

describe('LaneController', () => {
  it('holds the lane centre on a straight road', () => {
    const { physics, car, step } = rig(150, 1);
    let worst = 0;
    step(5, () => (worst = Math.max(worst, Math.abs(car.d - laneCenter(1)))));
    expect(worst).toBeLessThan(0.3);
    physics.free();
  });

  for (const kmh of [60, 150, 300]) {
    it(`changes one lane cleanly at ${kmh} km/h`, () => {
      const { physics, car, lc, step } = rig(kmh, 1);
      step(1);
      expect(lc.start(2, car.d)).toBe(true);
      expect(lc.changing).toBe(true);
      let over = 0;
      let maxSideways = 0;
      step(3, () => {
        over = Math.max(over, car.d - laneCenter(2));
        maxSideways = Math.max(maxSideways, Math.abs(car.vLong * Math.sin(car.yaw) + car.vLat));
      });
      expect(lc.changing).toBe(false);
      expect(Math.abs(car.d - laneCenter(2))).toBeLessThan(0.3);
      expect(over).toBeLessThan(0.25); // overshoot past the new lane's centre
      expect(maxSideways).toBeLessThan(5); // m/s across the road: a lane change, not a swerve
      // Settled: stays there.
      let worst = 0;
      step(3, () => (worst = Math.max(worst, Math.abs(car.d - laneCenter(2)))));
      expect(worst).toBeLessThan(0.3);
      physics.free();
    });
  }

  it('changes to the left as well', () => {
    const { physics, car, lc, step } = rig(150, 2);
    step(1);
    lc.start(1, car.d);
    step(4);
    expect(Math.abs(car.d - laneCenter(1))).toBeLessThan(0.3);
    physics.free();
  });

  it('refuses lanes that do not exist and a new change while one is under way', () => {
    const lc = new LaneController(0);
    expect(lc.start(-1, laneCenter(0))).toBe(false);
    expect(new LaneController(3).start(4, laneCenter(3))).toBe(false);
    expect(lc.fromLane).toBe(0);
    expect(lc.start(1, laneCenter(0))).toBe(true);
    expect(lc.start(2, laneCenter(0))).toBe(false);
    expect(lc.targetLane).toBe(1);
    expect(lc.fromLane).toBe(0); // the lane it is leaving
    lc.update(5);
    expect(lc.fromLane).toBe(1); // done: the lane it holds
  });

  it('re-syncs to the lane the car is in after it was moved (reset, respawn)', () => {
    const lc = new LaneController(0);
    lc.sync(laneCenter(3));
    expect(lc.targetLane).toBe(3);
    expect(lc.changing).toBe(false);
  });
});
