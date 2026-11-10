import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CARS } from '../src/vehicles/cars';
import { openGround } from './openGround';
import { PlayerCar } from '../src/vehicles/playerCar';
import { PHYSICS_DT } from '../src/config';

/**
 * Does a car pull to one side starting off, hands off the wheel? Full throttle from standstill, steering 0:
 * its sideways position and heading every 0.5 s. HOLD=2: held on the grid with full throttle that long first.
 *   CAR=street-racer npx vitest run --config training/vitest.config.ts training/startDrift.train.ts
 */
it('start drift', async () => {
  await RAPIER.init();
  const out: string[] = [];
  for (const name of (process.env.CAR ?? Object.keys(CARS).join(',')).split(',')) {
    const spec = CARS[name];
    const physics = openGround();
    physics.timestep = PHYSICS_DT;
    const car = new PlayerCar(physics, null, { spec });
    car.resetTo(0, 1, 0);
    const d0 = car.d;
    const step = (throttle: number) => {
      car.prePhysics({ throttle, brake: 0, steer: 0 }, PHYSICS_DT);
      physics.step(() => {});
      car.postPhysics();
    };
    // Settle on the springs, then (HOLD) the burnout on the line.
    for (let i = 0; i < 0.5 / PHYSICS_DT; i++) step(0);
    const hold = Number(process.env.HOLD ?? 0);
    if (hold) {
      car.holdInPlace(true);
      for (let i = 0; i < hold / PHYSICS_DT; i++) step(1);
      car.holdInPlace(false);
    }
    out.push(`${name}${hold ? ` (held ${hold} s at full throttle)` : ''}: settled d ${(car.d - d0).toFixed(3)} yaw ${(car.yaw * 57.3).toFixed(2)} deg`);
    let t = 0;
    for (let k = 1; k <= 12; k++) {
      while (t < k * 0.5 - 1e-9) {
        step(1);
        t += PHYSICS_DT;
      }
      out.push(`  ${t.toFixed(1)} s: ${(car.speed * 3.6).toFixed(0)} km/h, d ${(car.d - d0).toFixed(3)} m, yaw ${(car.yaw * 57.3).toFixed(2)} deg, vLat ${car.vLat.toFixed(3)}, gear ${car.gearbox.gear}`);
    }
    physics.free();
  }
  process.stdout.write(out.join('\n') + '\n');
});
