import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_DT } from '../src/config';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { SKIDPAD, skidpadRoad } from '../src/road/skidpad';
import { surfaceMesh } from '../src/road/surface';
import { CARS } from '../src/vehicles/cars';
import { PlayerCar } from '../src/vehicles/playerCar';
import { mountainSetup, mountainSetupOf } from '../src/vehicles/mountainSetup';
import type { DriveInput } from '../src/vehicles/handling';

/**
 * The player's arcade drift (DriftAssist.arcade) on each car, on the practice ground (?skidpad, flat): up to ENTRY km/h
 * straight, the handbrake a moment on full lock, then each hold (throttle, steering) for HOLD s - its slide every
 * second and its speed. The cars' masses, inertias, grip and power differ: the same torques settle each its own way.
 *   npx vitest run --config training/vitest.config.ts training/arcadeDrift.train.ts
 */
const ENTRY = Number(process.env.ENTRY ?? 100);
const HOLD = Number(process.env.HOLD ?? 4);
const HOLDS: [string, number, number][] = [
  ['full lock, full throttle', 1, 1],
  ['half lock, full throttle', 1, 0.5],
  ['full lock, off the gas', 0, 1],
];

function run(id: string, throttle: number, steer: number): string {
  const road = skidpadRoad();
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  physics.setRoad(road, { rails: { left: () => -SKIDPAD.half, right: () => SKIDPAD.half }, ground: surfaceMesh(road, -100, SKIDPAD.length + 100, () => [-SKIDPAD.half - 40, SKIDPAD.half + 40]) });
  const car = new PlayerCar(physics, null, { spec: CARS[id], entity: { type: 'player' } });
  car.road = road;
  Object.assign(car.params, mountainSetup(car.params, mountainSetupOf(id)));
  car.resetAt(100, 0, 0);
  const step = (input: DriveInput) => {
    car.prePhysics(input, PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
  };
  let t = 0;
  while (car.speed * 3.6 < ENTRY && t < 20) {
    step({ throttle: 1, brake: 0, steer: 0 });
    t += PHYSICS_DT;
  }
  for (let i = 0; i < 0.25 / PHYSICS_DT; i++) step({ throttle: 0, brake: 0, steer: 1, handbrake: true });
  const out: string[] = [];
  for (let i = 1; i <= HOLD / PHYSICS_DT; i++) {
    step({ throttle, brake: 0, steer });
    if (i % Math.round(1 / PHYSICS_DT) === 0) {
      const slide = Math.abs(Math.atan2(car.vLat, Math.max(Math.abs(car.vLong), 1))) * (180 / Math.PI);
      out.push(`${Math.round(slide)}°/${Math.round(car.speed * 3.6)}`);
    }
  }
  physics.free();
  return out.join('  ');
}

/** LANE=1: a keyboard lane change at speed (the key held `tap` s one way, then the other) - the wheel's most, the slide's. */
function lane(id: string, kmh: number, tap: number): string {
  const road = skidpadRoad();
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  physics.setRoad(road, { rails: { left: () => -SKIDPAD.half, right: () => SKIDPAD.half }, ground: surfaceMesh(road, -100, SKIDPAD.length + 100, () => [-SKIDPAD.half - 40, SKIDPAD.half + 40]) });
  const car = new PlayerCar(physics, null, { spec: CARS[id], entity: { type: 'player' } });
  car.road = road;
  Object.assign(car.params, mountainSetup(car.params, mountainSetupOf(id)));
  // (GRIP=1: no drift at all - the slide a lane change makes on grip alone)
  if (process.env.GRIP && car.params.drift) car.params.drift = { ...car.params.drift, from: 1, full: 2 };
  car.resetAt(-80, 0, 0);
  const step = (input: DriveInput) => {
    car.prePhysics(input, PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
  };
  let t = 0;
  while (car.speed * 3.6 < kmh && t < 30) {
    step({ throttle: 1, brake: 0, steer: 0 });
    t += PHYSICS_DT;
  }
  let wheel = 0, most = 0;
  const plan: [number, number][] = [[1, tap], [0, 0.3], [-1, tap], [0, 1.5]];
  for (const [steer, time] of plan) {
    for (let i = 0; i < time / PHYSICS_DT; i++) {
      step({ throttle: 1, brake: 0, steer });
      wheel = Math.max(wheel, Math.abs((car as unknown as { steer: number }).steer));
      most = Math.max(most, Math.abs(Math.atan2(car.vLat, Math.max(Math.abs(car.vLong), 1))) * (180 / Math.PI));
    }
  }
  physics.free();
  return `${id.padEnd(12)} ${kmh} km/h tap ${tap}s: wheel ${wheel.toFixed(2)} slide ${most.toFixed(1)}°`;
}

/** BEND=1: a long bend - the key held (the wheel `steer`) 3 s at `kmh`, half throttle: the slide each 0.5 s, and in or not. */
function bend(id: string, kmh: number, steer: number): string {
  const road = skidpadRoad();
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  physics.setRoad(road, { rails: { left: () => -SKIDPAD.half, right: () => SKIDPAD.half }, ground: surfaceMesh(road, -100, SKIDPAD.length + 100, () => [-SKIDPAD.half - 40, SKIDPAD.half + 40]) });
  const car = new PlayerCar(physics, null, { spec: CARS[id], entity: { type: 'player' } });
  car.road = road;
  Object.assign(car.params, mountainSetup(car.params, mountainSetupOf(id)));
  if (process.env.GRIP && car.params.drift) car.params.drift = { ...car.params.drift, from: 1, full: 2 };
  car.resetAt(-80, 0, 0);
  const step = (input: DriveInput) => {
    car.prePhysics(input, PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
  };
  let t = 0;
  while (car.speed * 3.6 < kmh && t < 30) {
    step({ throttle: 1, brake: 0, steer: 0 });
    t += PHYSICS_DT;
  }
  const out: string[] = [];
  for (let i = 1; i <= 3 / PHYSICS_DT; i++) {
    step({ throttle: 0.5, brake: 0, steer });
    if (i % Math.round(0.5 / PHYSICS_DT) === 0) {
      const slide = Math.abs(Math.atan2(car.vLat, Math.max(Math.abs(car.vLong), 1))) * (180 / Math.PI);
      out.push(`${slide.toFixed(1)}°${car.drifting > 0.5 ? '*' : ''}/${Math.round(car.speed * 3.6)}`);
    }
  }
  physics.free();
  return `${id.padEnd(12)} ${kmh} km/h wheel ${steer}: ${out.join('  ')}`;
}

it.runIf(process.env.BEND)('a long bend', async () => {
  await RAPIER.init();
  const lines: string[] = [];
  for (const id of ['street-racer', 'muscle-car', 'jdm']) for (const kmh of [80, 130]) for (const steer of [0.6, 1]) lines.push(bend(id, kmh, steer));
  process.stdout.write(lines.join('\n') + '\n');
});

it.runIf(process.env.LANE)('a lane change at speed', async () => {
  await RAPIER.init();
  const lines: string[] = [];
  for (const id of ['street-racer', 'muscle-car', 'jdm']) for (const kmh of [100, 160]) for (const tap of [0.1, 0.2, 0.3]) lines.push(lane(id, kmh, tap));
  process.stdout.write(lines.join('\n') + '\n');
});

it.skipIf(process.env.LANE || process.env.BEND)('arcade drift on each car', async () => {
  await RAPIER.init();
  const lines: string[] = [];
  for (const id of ['street-racer', 'muscle-car', 'jdm']) {
    for (const [name, throttle, steer] of HOLDS) lines.push(`${id.padEnd(12)} ${name.padEnd(26)} ${run(id, throttle, steer)}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
});
