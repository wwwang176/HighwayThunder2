import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { STREET_RACER } from '../src/vehicles/cars';
import { KMH, PHYSICS_DT } from '../src/config';

/**
 * How hard the car corners: at a steady speed, full steering for 1.5 s; the
 * lateral acceleration (g) it holds over the last 0.75 s (how fast the
 * direction of travel turns, times speed), and whether it spun.
 *   CORNER_JSON='{"x2":{"downforceK":3.2}}' npx vitest run --config training/vitest.config.ts training/cornering.train.ts
 */
it('cornering', async () => {
  await RAPIER.init();
  const variants: Record<string, Record<string, number>> = process.env.CORNER_JSON
    ? JSON.parse(process.env.CORNER_JSON) // { name: { param: value } }
    : { now: {}, 'downforce x2': { downforceK: 3.2 }, 'downforce x3': { downforceK: 4.8 } };
  const out: string[] = [];
  for (const [name, change] of Object.entries(variants)) {
    const row: string[] = [];
    for (const kmh of [100, 200, 280]) {
      const physics = PhysicsWorld.createSync();
      physics.timestep = PHYSICS_DT;
      // Settings go in before the car is built: the centre of mass is fixed then.
      const car = new PlayerCar(physics, null, { spec: { ...STREET_RACER, params: { ...STREET_RACER.params, ...change } } });
      car.params.maxSpeed = kmh * KMH;
      car.resetTo(0, 1, kmh * KMH);
      const course = () => car.yaw + Math.atan2(car.vLat, Math.max(1, car.vLong));
      let c0 = 0;
      let speedSum = 0;
      let n = 0;
      let slipMax = 0;
      const steps = Math.round(1.5 / PHYSICS_DT);
      for (let i = 0; i < steps; i++) {
        car.prePhysics({ throttle: 1, brake: 0, steer: 1 }, PHYSICS_DT);
        physics.step(() => {});
        car.postPhysics();
        if (i === Math.round(steps / 2)) c0 = course();
        if (i > steps / 2) {
          speedSum += Math.hypot(car.vLong, car.vLat);
          n++;
        }
        slipMax = Math.max(slipMax, Math.abs(Math.atan2(car.vLat, Math.max(1, car.vLong))));
      }
      const lat = (Math.abs(course() - c0) / (n * PHYSICS_DT)) * (speedSum / n);
      row.push(`${kmh}: ${(lat / 9.81).toFixed(2)} g, slip ${(slipMax * 57.3).toFixed(0)}°${slipMax > 0.35 ? ' SPUN' : ''}`);
      physics.free();
    }
    out.push(`${name.padEnd(14)} ${row.join(' | ')}`);
  }
  process.stdout.write(out.join('\n') + '\n');
});

/**
 * How quickly it answers the wheel at speed: full steering from straight ahead at 200 km/h,
 * then (after HOLD s) straight again - the sideways distance moved after 0.25 / 0.5 / 0.75 / 1 s,
 * the time to move one lane (3.75 m), and the heading left when it settles (a lane change, not a turn).
 *   TURN_JSON='{"quick":{"steerRise":12}}' npx vitest run --config training/vitest.config.ts training/cornering.train.ts -t turnIn
 */
it('turnIn', async () => {
  await RAPIER.init();
  const variants: Record<string, Record<string, number>> = process.env.TURN_JSON ? JSON.parse(process.env.TURN_JSON) : { now: {} };
  const kmh = Number(process.env.KMH ?? 200);
  const out: string[] = [];
  for (const [name, change] of Object.entries(variants)) {
    const physics = PhysicsWorld.createSync();
    physics.timestep = PHYSICS_DT;
    const car = new PlayerCar(physics, null, { spec: { ...STREET_RACER, params: { ...STREET_RACER.params, ...change } } });
    car.params.maxSpeed = kmh * KMH;
    car.resetTo(0, 1, kmh * KMH);
    const d0 = car.d;
    const marks: string[] = [];
    let laneAt = NaN;
    let slipMax = 0;
    for (let i = 1; i <= Math.round(1.5 / PHYSICS_DT); i++) {
      const t = i * PHYSICS_DT;
      car.prePhysics({ throttle: 1, brake: 0, steer: t < 1 ? 1 : 0 }, PHYSICS_DT);
      physics.step(() => {});
      car.postPhysics();
      const moved = Math.abs(car.d - d0);
      slipMax = Math.max(slipMax, Math.abs(Math.atan2(car.vLat, Math.max(1, car.vLong))));
      if ([0.25, 0.5, 0.75, 1].some((x) => Math.abs(t - x) < PHYSICS_DT / 2)) marks.push(`${t.toFixed(2)}s ${moved.toFixed(2)} m`);
      if (isNaN(laneAt) && moved >= 3.75) laneAt = t;
    }
    out.push(`${name.padEnd(14)} ${marks.join(' | ')} | lane in ${laneAt.toFixed(2)} s | slip max ${(slipMax * 57.3).toFixed(0)}°`);
    physics.free();
  }
  process.stdout.write(out.join('\n') + '\n');
});
