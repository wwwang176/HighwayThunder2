import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PlayerCar } from '../src/vehicles/playerCar';
import { CARS } from '../src/vehicles/cars';
import { KMH, PHYSICS_DT } from '../src/config';
import { surfaceGrip } from '../src/road/coords';
import { DRIVER_TUNING, PlannerDriver } from '../src/ai/plannerDriver';
import { trackerFrom } from '../src/ai/netTracker';
import { TrainingSim } from '../src/ai/trainingSim';
import { openGround } from './openGround';

/**
 * Investigation: how far a car leans with the rivals' rubber-band boost (engine and grip x (1 + BOOST), the grip
 * through surfaceGrip, as src/game/rivals.ts). Lean: the body's roll about its nose (deg, + onto its right side).
 * - LEAN_MODE=open (default): held moves on open ground - full lock 1.5 s at 100 / 150 / 200 km/h (the most lean, the
 *   lateral g over its last 0.75 s), a quick lane change at 150 / 200 (steer +0.5 0.3 s, -0.5 0.3 s, then hands off
 *   2.4 s: the most lean, the most after the move, how often it rocks past 1 deg either way).
 * - LEAN_MODE=ai: the AI as the game's rivals (plans by direction of travel) racing in traffic, SEEDS each: the lean
 *   (p50 / p95 / max, share of time past 5 / 8 / 12 deg), how often it rocks (crossings past 2 deg a minute), the
 *   steering (reversals past 0.1 a minute), lateral g p95.
 *   CARS=muscle-car BOOSTS=0,0.25,0.6,0.6/0.1 LEAN_MODE=open npx vitest run --config training/vitest.config.ts training/boostLean.train.ts
 */
const list = (k: string, d: string) => (process.env[k] ?? d).split(',');
const CAR_IDS = list('CARS', 'muscle-car,street-racer,jdm');
/** Each: engine, or engine/grip (0.6/0.1: engine +60 %, grip +10 %; one number: both). */
const BOOSTS = list('BOOSTS', '0,0.25,0.6').map((x) => x.split('/').map(Number));
const MODE = process.env.LEAN_MODE ?? 'open'; // (not MODE: vitest sets that)
const SEEDS = list('SEEDS', '7001,7002,7003').map(Number);
const DEG = 180 / Math.PI;
const RIGHT = new THREE.Vector3();
const QUAT = new THREE.Quaternion();

function lean(car: PlayerCar): number {
  const q = car.body.rotation();
  RIGHT.set(1, 0, 0).applyQuaternion(QUAT.set(q.x, q.y, q.z, q.w));
  return -Math.asin(Math.max(-1, Math.min(1, RIGHT.y))) * DEG;
}

function boost(car: PlayerCar, base: PlayerCar['params'], [b, g = b]: number[]): void {
  const k = 1 + b;
  car.surfaceGrip = (x) => surfaceGrip(x) * (1 + g);
  car.params.power = base.power * k;
  car.params.engineTorque = base.engineTorque * k;
  car.params.maxDriveForce = base.maxDriveForce * k;
}

const q = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN;
};

it('boost lean', async () => {
  await RAPIER.init();
  const out: string[] = [];
  for (const id of CAR_IDS) {
    const spec = CARS[id];
    out.push(`\n== ${id}`);
    for (const b of BOOSTS) {
      if (MODE === 'open') {
        const row: string[] = [];
        for (const kmh of [100, 150, 200]) {
          const physics = openGround();
          physics.timestep = PHYSICS_DT;
          const car = new PlayerCar(physics, null, { spec });
          boost(car, spec.params, b);
          car.params.maxSpeed = kmh * KMH;
          car.resetTo(0, 1, kmh * KMH);
          let most = 0, c0 = 0;
          const n = Math.round(1.5 / PHYSICS_DT);
          const course = () => car.yaw + Math.atan2(car.vLat, Math.max(1, car.vLong));
          for (let i = 1; i <= n; i++) {
            car.prePhysics({ throttle: 1, brake: 0, steer: 1 }, PHYSICS_DT);
            physics.step(() => {});
            car.postPhysics();
            most = Math.max(most, Math.abs(lean(car)));
            if (i === Math.round(n / 2)) c0 = course();
          }
          const g = (Math.abs(course() - c0) / 0.75) * car.vLong / 9.81;
          row.push(`${kmh}: ${most.toFixed(1)} deg ${g.toFixed(2)} g`);
          car.dispose(physics);
          physics.free();
        }
        const lc: string[] = [];
        for (const kmh of [150, 200]) {
          const physics = openGround();
          physics.timestep = PHYSICS_DT;
          const car = new PlayerCar(physics, null, { spec });
          boost(car, spec.params, b);
          car.params.maxSpeed = kmh * KMH;
          car.resetTo(0, 1, kmh * KMH);
          let most = 0, after = 0, cross = 0, side = 0;
          for (let i = 1; i <= Math.round(3 / PHYSICS_DT); i++) {
            const t = i * PHYSICS_DT;
            const steer = t <= 0.3 ? 0.5 : t <= 0.6 ? -0.5 : 0;
            car.prePhysics({ throttle: 1, brake: 0, steer }, PHYSICS_DT);
            physics.step(() => {});
            car.postPhysics();
            const l = lean(car);
            most = Math.max(most, Math.abs(l));
            if (t > 0.6) after = Math.max(after, Math.abs(l));
            if (Math.abs(l) > 1 && Math.sign(l) !== side) {
              if (side) cross++;
              side = Math.sign(l);
            }
          }
          lc.push(`${kmh}: most ${most.toFixed(1)} deg, after ${after.toFixed(1)}, rocks ${cross}`);
          car.dispose(physics);
          physics.free();
        }
        out.push(`boost ${b.join('/')} | full lock ${row.join(' | ')} || lane change ${lc.join(' | ')}`);
      } else {
        DRIVER_TUNING.coursePlanner = true; // (the game's rivals)
        const leans: number[] = [], lats: number[] = [];
        let rockN = 0, revN = 0, minutes = 0, finishes = 0, resets = 0, wrecked = 0;
        for (const seed of SEEDS) {
          const driver = new PlannerDriver();
          driver.accel = spec.ai.accel;
          driver.latAccel = spec.ai.latAccel;
          driver.brake = spec.ai.brake;
          driver.tracker = trackerFrom(spec.ai.tracker);
          driver.recovery = trackerFrom(spec.ai.recovery);
          driver.accelScale = 1 + b[0];
          let lastSteer = 0, steerSide = 0;
          const orig = driver.drive.bind(driver);
          driver.drive = (self, traffic, p) => {
            const input = orig(self, traffic, p);
            if (Math.abs(input.steer) > 0.1 && Math.sign(input.steer) !== steerSide) {
              if (steerSide) revN++;
              steerSide = Math.sign(input.steer);
            }
            lastSteer = input.steer;
            return input;
          };
          const sim = new TrainingSim([driver], seed, { spec, speedCap: 300 / 3.6, trafficSeesCars: true, resetOnCrash: 60 / 3.6, gameContact: true });
          const g = sim.ghosts[0];
          boost(g.car, spec.params, b);
          let side = 0;
          while (!sim.done) {
            sim.step();
            if (!g.alive) break;
            const l = lean(g.car);
            leans.push(Math.abs(l));
            lats.push(Math.abs(g.car.aLat) / 9.81);
            if (Math.abs(l) > 2 && Math.sign(l) !== side) {
              if (side) rockN++;
              side = Math.sign(l);
            }
            if (g.result.finishTime !== null) break;
          }
          void lastSteer;
          minutes += sim.time / 60;
          if (g.result.finishTime !== null) finishes++;
          resets += g.result.resets ?? 0;
          wrecked += g.result.contacts ?? 0;
          sim.physics.free();
        }
        const share = (x: number) => ((100 * leans.filter((l) => l > x).length) / leans.length).toFixed(1);
        out.push(
          `boost ${b.join('/')} | lean p50 ${q(leans, 0.5).toFixed(1)} p95 ${q(leans, 0.95).toFixed(1)} max ${Math.max(...leans).toFixed(1)} deg, past 5 / 8 / 12: ${share(5)} / ${share(8)} / ${share(12)} %` +
            ` | rocks ${(rockN / minutes).toFixed(1)} /min | steer reversals ${(revN / minutes).toFixed(1)} /min | lat g p95 ${q(lats, 0.95).toFixed(2)}` +
            ` | finished ${finishes}/${SEEDS.length}, resets ${resets}, vehicles wrecked ${wrecked}`,
        );
      }
    }
  }
  process.stdout.write(out.join('\n') + '\n');
}, 24 * 3600_000);
