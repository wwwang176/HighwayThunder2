import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CARS } from '../src/vehicles/cars';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { laneCenter } from '../src/road/coords';
import { KMH, PHYSICS_DT } from '../src/config';

/**
 * Measures a car type's numbers for its CarSpec.ai (what the AI plans with):
 * full-throttle acceleration every 50 km/h, and full-brake deceleration.
 *   CAR=street-racer npx vitest run --config training/vitest.config.ts training/measureCar.train.ts
 */
it('measure car', async () => {
  await RAPIER.init();
  const spec = CARS[process.env.CAR ?? 'street-racer'];
  if (!spec) throw new Error(`no car "${process.env.CAR}" (have: ${Object.keys(CARS).join(', ')})`);
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const car = new PlayerCar(physics, null, { spec });
  car.params.maxSpeed = 300 * KMH;
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

  let brake = Infinity;
  for (const from of [100, 200]) {
    car.resetTo(1000 + from * 5, 1, from * KMH);
    const v0 = car.speed;
    for (let i = 0; i < 1 / PHYSICS_DT; i++) step(0, 1);
    brake = Math.min(brake, v0 - car.speed);
  }
  physics.free();

  process.stdout.write(
    `${spec.id}: paste into its CarSpec\n  ai: {\n    accel: [\n${accel.map(([k, a]) => `      [${k}, ${a}],`).join('\n')}\n    ],\n    brake: ${brake.toFixed(1)},\n  },\n`,
  );
});
