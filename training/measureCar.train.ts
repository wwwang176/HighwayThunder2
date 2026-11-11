import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CARS } from '../src/vehicles/cars';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { openGround } from './openGround';
import { PlayerCar } from '../src/vehicles/playerCar';
import { laneCenter } from '../src/road/coords';
import { KMH, PHYSICS_DT } from '../src/config';

/**
 * Measures a car type's numbers for its CarSpec.ai (what the AI plans with):
 * full-throttle acceleration and full-brake deceleration every 50 km/h.
 *   CAR=street-racer npx vitest run --config training/vitest.config.ts training/measureCar.train.ts
 */
it('measure car', async () => {
  await RAPIER.init();
  const spec = CARS[process.env.CAR ?? 'street-racer'];
  if (!spec) throw new Error(`no car "${process.env.CAR}" (have: ${Object.keys(CARS).join(', ')})`);
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const car = new PlayerCar(physics, null, { spec });
  car.params.maxSpeed = Math.min(300 * KMH, spec.params.maxSpeed); // its own limiter: no acceleration past what it can reach
  const step = (throttle: number, brake: number) => {
    // Hold the lane centre (a straight run, not a drift into the rail).
    const steer = Math.max(-1, Math.min(1, -(car.d - laneCenter(1)) * 0.05 - car.yaw));
    car.prePhysics({ throttle, brake, steer }, PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
  };

  car.resetTo(0, 1, 0);
  const accel: [number, number][] = [];
  const marks = [0, 50, 100, 150, 200, 250, 300];
  let t = 0;
  // Acceleration around each mark: speed gained over the half second around it.
  for (const mark of marks) {
    while (car.speed < (mark - 5) * KMH && t < 120) {
      step(1, 0);
      t += PHYSICS_DT;
    }
    if (car.speed < (mark - 5) * KMH) break; // never got there
    const v0 = car.speed;
    for (let i = 0; i < 0.5 / PHYSICS_DT; i++) step(1, 0);
    t += 0.5;
    accel.push([mark, Math.round(((car.speed - v0) / 0.5) * 10) / 10]);
  }

  // Full-brake deceleration around each mark: from 15 km/h above it, the pedal down from cruising (as the AI brakes),
  // the mean over the 30 km/h it takes to lose. (The 0 km/h point is the 50 one.)
  const brake: [number, number][] = [];
  for (const mark of marks.slice(1)) {
    car.resetTo(1000 + mark * 5, 1, (mark + 15) * KMH);
    for (let i = 0; i < 0.3 / PHYSICS_DT; i++) step(0.3, 0);
    const v0 = car.speed;
    let t = 0;
    while (v0 - car.speed < 30 * KMH && t < 10) {
      step(0, 1);
      t += PHYSICS_DT;
    }
    brake.push([mark, Math.round(((v0 - car.speed) / t) * 10) / 10]);
  }
  brake.unshift([0, brake[0][1]]);
  physics.free();

  // Cornering grip: full steering at each speed for 1.5 s on open ground; the sideways acceleration
  // held over the last 0.75 s (how fast the direction of travel turns, times speed).
  const latAccel: [number, number][] = [];
  for (const mark of marks.slice(1)) {
    const ground = openGround();
    ground.timestep = PHYSICS_DT;
    const c = new PlayerCar(ground, null, { spec });
    c.params.maxSpeed = mark * KMH;
    c.resetTo(0, 1, mark * KMH);
    const course = () => c.yaw + Math.atan2(c.vLat, Math.max(1, c.vLong));
    const steps = Math.round(1.5 / PHYSICS_DT);
    let c0 = 0;
    let speedSum = 0;
    let n = 0;
    for (let i = 0; i < steps; i++) {
      c.prePhysics({ throttle: 1, brake: 0, steer: 1 }, PHYSICS_DT);
      ground.step(() => {});
      c.postPhysics();
      if (i === Math.round(steps / 2)) c0 = course();
      if (i > steps / 2) {
        speedSum += Math.hypot(c.vLong, c.vLat);
        n++;
      }
    }
    latAccel.push([mark, Math.round((Math.abs(course() - c0) / (n * PHYSICS_DT)) * (speedSum / n) * 10) / 10]);
    ground.free();
  }

  const table = (rows: [number, number][]) => rows.map(([k, a]) => `      [${k}, ${a}],`).join('\n');
  process.stdout.write(
    `${spec.id}: paste into its CarSpec\n  ai: {\n    accel: [\n${table(accel)}\n    ],\n    brake: [\n${table(brake)}\n    ],\n    latAccel: [\n${table(latAccel)}\n    ],\n  },\n`,
  );
});
