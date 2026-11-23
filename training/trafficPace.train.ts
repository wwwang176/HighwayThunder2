import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { KMH } from '../src/config';
import { surfaceGrip } from '../src/road/coords';
import { PlannerDriver } from '../src/ai/plannerDriver';
import { trackerFrom } from '../src/ai/netTracker';
import { TrainingSim } from '../src/ai/trainingSim';
import { CARS } from '../src/vehicles/cars';

/**
 * How much the traffic slows a rival: the AI (as the game's rivals, the rubber band at its most: engine +60 %, grip
 * +10 %, its car's own top speed) racing the course in traffic, SEEDS each - its mean speed once it first reaches 90 %
 * of its top speed, the share of that time at 95 % of it or more, and the time it takes a km against at its top speed
 * all the way (as if it saw no traffic and went straight through it).
 *   CARS=muscle-car npx vitest run --config training/vitest.config.ts training/trafficPace.train.ts
 */
const list = (k: string, d: string) => (process.env[k] ?? d).split(',');
const CAR_IDS = list('CARS', 'muscle-car,street-racer,jdm');
const SEEDS = list('SEEDS', '7001,7002,7003').map(Number);
const ENGINE = Number(process.env.ENGINE ?? 0.6);
const GRIP = Number(process.env.GRIP ?? 0.1);

it('traffic pace', async () => {
  await RAPIER.init();
  const out: string[] = [];
  for (const id of CAR_IDS) {
    const spec = CARS[id];
    const top = spec.params.maxSpeed;
    const rows: string[] = [];
    let allDist = 0, allTime = 0, allFast = 0;
    for (const seed of SEEDS) {
      const driver = new PlannerDriver();
      driver.accel = spec.ai.accel;
      driver.latAccel = spec.ai.latAccel;
      driver.brake = spec.ai.brake;
      driver.tracker = trackerFrom(spec.ai.tracker);
      driver.accelScale = 1 + ENGINE;
      const sim = new TrainingSim([driver], seed, { spec, speedCap: top, trafficSeesCars: true, resetOnCrash: 60 / 3.6, gameContact: true });
      const g = sim.ghosts[0];
      const c = g.car;
      c.surfaceGrip = (x) => surfaceGrip(x) * (1 + GRIP);
      c.params.power = spec.params.power * (1 + ENGINE);
      c.params.engineTorque = spec.params.engineTorque * (1 + ENGINE);
      let on = false, s0 = 0, t0 = 0, fast = 0, steps = 0;
      while (!sim.done) {
        sim.step();
        if (!g.alive) break;
        if (!on && c.speed >= 0.9 * top) {
          on = true;
          s0 = c.s;
          t0 = sim.time;
        }
        if (on) {
          steps++;
          if (c.speed >= 0.95 * top) fast++;
        }
        if (g.result.finishTime !== null) break;
      }
      const dist = c.s - s0, time = sim.time - t0;
      allDist += dist;
      allTime += time;
      allFast += fast / Math.max(1, steps);
      rows.push(`${seed}: ${((dist / time) / KMH).toFixed(0)} km/h (from ${s0.toFixed(0)} m), resets ${g.result.resets ?? 0}`);
      sim.physics.free();
    }
    const mean = allDist / allTime;
    const perKm = 1000 / mean - 1000 / top;
    out.push(
      `${id}: top ${(top / KMH).toFixed(0)} km/h | in traffic ${(mean / KMH).toFixed(0)} km/h (${((100 * mean) / top).toFixed(0)} % of top), at 95 % of top or more ${((100 * allFast) / SEEDS.length).toFixed(0)} % of the time` +
        ` | going straight at top: ${perKm.toFixed(1)} s a km sooner, ${((top - mean) * 60).toFixed(0)} m a minute further | ${rows.join('; ')}`,
    );
    process.stdout.write(out[out.length - 1] + '\n');
  }
  process.stdout.write(out.join('\n') + '\n');
}, 24 * 3600_000);
