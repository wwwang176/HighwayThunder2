import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CARS } from '../src/vehicles/cars';
import { PlayerCar } from '../src/vehicles/playerCar';
import { KMH, PHYSICS_DT } from '../src/config';
import { openGround } from './openGround';

/** The front axle's share of the tyres' load standing, and braking hard from 200 km/h (its most), each car; and its brake bias. */
it('brake load', async () => {
  await RAPIER.init();
  for (const id of Object.keys(CARS)) {
    const physics = openGround();
    physics.timestep = PHYSICS_DT;
    const c = new PlayerCar(physics, null, { spec: CARS[id] });
    const share = () => {
      const w = c.chassis.wheels;
      const front = w[0].load + w[1].load, all = w.reduce((a, x) => a + x.load, 0);
      return all > 0 ? front / all : NaN;
    };
    c.resetTo(500, 1, 200 * KMH);
    for (let i = 0; i < 0.5 / PHYSICS_DT; i++) {
      c.prePhysics({ throttle: 0, brake: 0, steer: 0 }, PHYSICS_DT);
      physics.step(() => {});
      c.postPhysics();
    }
    const cruise = share();
    let most = 0;
    for (let i = 0; i < 4 / PHYSICS_DT && c.speed > 2; i++) {
      c.prePhysics({ throttle: 0, brake: 1, steer: 0 }, PHYSICS_DT);
      physics.step(() => {});
      c.postPhysics();
      most = Math.max(most, share());
    }
    process.stdout.write(`${id}: front load ${(cruise * 100).toFixed(0)} % cruising, up to ${(most * 100).toFixed(0)} % braking hard; brake bias ${(c.params.brakeFrontBias * 100).toFixed(0)} % front\n`);
    physics.free();
  }
});
