import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { KMH, PHYSICS_DT } from '../src/config';
import { CARS } from '../src/vehicles/cars';
import type { CarParams } from '../src/vehicles/handling';
import { bend, Centerline, straight } from '../src/road/centerline';
import { surfaceMesh } from '../src/road/surface';
import { MOUNTAIN } from '../src/road/mountain';
import { MountainDriver } from '../src/ai/mountainDriver';
import { selfStateOf } from '../src/ai/driver';
import { MOUNTAIN_SETUP, mountainSetup, mountainSetupOf, type MountainSetup } from '../src/vehicles/mountainSetup';

/**
 * The cars as set up for the highway against the mountain road's setup (src/vehicles/mountainSetup):
 *  - full lock and 60 % at 45 and 60 km/h on open ground: the radius each holds (the same for both: the front tyres
 *    saturated - pushing on, not turning), the front tyres' slip;
 *  - a hairpin (R 18, 180°) driven by the mountain driver at budget 1 from 100 km/h: its time from 80 m before to
 *    80 m after, the hardest slide (rear slip angle), wall contacts.
 *   SETUP_JSON='{"arbFront":0.5}' npx vitest run --config training/vitest.config.ts training/mountainSetup.train.ts
 */
const OVERRIDE: Partial<MountainSetup> = JSON.parse(process.env.SETUP_JSON ?? '{}');
const CAR_IDS = (process.env.CARS ?? 'street-racer,muscle-car,jdm').split(',');

function lock(params: CarParams, kmh: number, input: number) {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  physics.removeRails();
  const car = new PlayerCar(physics, null, { entity: { type: 'rival', id: 0 } });
  Object.assign(car.params, params);
  car.resetTo(0, 1, kmh * KMH);
  let steer = 0;
  const xs: number[] = [], zs: number[] = [];
  let slip = 0;
  for (let i = 0; i < Math.round(7 / PHYSICS_DT); i++) {
    steer = Math.min(input, steer + car.params.steerRise * PHYSICS_DT);
    const err = kmh * KMH - car.speed;
    car.prePhysics({ throttle: Math.max(0, Math.min(1, err / 2)), brake: Math.max(0, Math.min(1, -err / 4)), steer }, PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
    if (i * PHYSICS_DT > 3.5) {
      const t = car.body.translation();
      xs.push(t.x);
      zs.push(t.z);
      slip = Math.max(slip, Math.abs(car.wheels[0].alpha), Math.abs(car.wheels[1].alpha));
    }
  }
  physics.free();
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  return { r: span / 2, slip: (slip * 180) / Math.PI };
}

const HAIRPIN = new Centerline([...straight(250), ...bend(18, 180, 10), ...straight(250)], { turnBack: true });

function hairpin(params: CarParams, ai: (typeof CARS)[string]['ai']) {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  physics.setRoad(HAIRPIN, { rails: { left: -MOUNTAIN.edge, right: MOUNTAIN.edge }, ground: surfaceMesh(HAIRPIN, -50, HAIRPIN.length + 100, MOUNTAIN.edge + 1.5) });
  const car = new PlayerCar(physics, null, { entity: { type: 'rival', id: 0 } });
  Object.assign(car.params, params);
  car.road = HAIRPIN;
  const driver = new MountainDriver();
  driver.budget = 1;
  driver.setRoad(HAIRPIN, ai);
  car.resetAt(100, 0, 100 * KMH);
  const from = 250 - 80;
  const to = 250 + 18 * Math.PI + 10 + 80;
  let t0 = NaN, t = 0, walls = 0, tail = 0;
  for (let i = 0; i < Math.round(30 / PHYSICS_DT) && car.s < to; i++) {
    car.prePhysics(driver.drive(selfStateOf(car, car.params.maxSpeed), [], car.params), PHYSICS_DT);
    physics.step((a, b, n) => {
      if (n && (a.type === 'static' || b.type === 'static')) walls++;
    });
    car.postPhysics();
    t += PHYSICS_DT;
    if (Number.isNaN(t0) && car.s >= from) t0 = t;
    if (!Number.isNaN(t0)) tail = Math.max(tail, Math.abs(car.wheels[2].alpha), Math.abs(car.wheels[3].alpha));
  }
  physics.free();
  return { time: car.s >= to ? t - t0 : NaN, walls, tail: (tail * 180) / Math.PI };
}

it('mountain setup', async () => {
  await RAPIER.init();
  const out: string[] = [`setup ${JSON.stringify({ ...MOUNTAIN_SETUP, ...OVERRIDE })} (each car's own over it: MOUNTAIN_SETUP_BY_CAR)`];
  for (const id of CAR_IDS) {
    const spec = CARS[id];
    const setup = { ...mountainSetupOf(id), ...OVERRIDE };
    for (const [name, p] of [['highway', spec.params], ['mountain', mountainSetup(spec.params, setup)]] as const) {
      const row: string[] = [];
      for (const kmh of [45, 60]) {
        const full = lock(p, kmh, 1);
        const part = lock(p, kmh, 0.6);
        row.push(`${kmh}: R ${full.r.toFixed(1)}/${part.r.toFixed(1)} m (front slip ${full.slip.toFixed(0)}°)`);
      }
      const h = hairpin(p, spec.ai);
      out.push(`${id.padEnd(12)} ${name.padEnd(8)} ${row.join('  ')}  hairpin ${h.time.toFixed(2)} s, tail ${h.tail.toFixed(0)}°, walls ${h.walls}`);
    }
  }
  process.stdout.write(out.join('\n') + '\n');
});
