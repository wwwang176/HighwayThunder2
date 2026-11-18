import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { KMH, PHYSICS_DT } from '../src/config';
import { CARS } from '../src/vehicles/cars';
import type { CarParams } from '../src/vehicles/handling';
import { PlayerCar } from '../src/vehicles/playerCar';
import { mountainAi, mountainSetup, mountainSetupOf } from '../src/vehicles/mountainSetup';
import type { AccelTable } from '../src/ai/mountainLine';
import { openGround } from './openGround';
import { mulberry32 } from '../src/ai/rng';
import { randomPerfTuning, tuned } from '../src/vehicles/tuning';
import { TUNE_CAL } from '../src/vehicles/tuneCalibration';
import { MOUNTAIN_GRIP_KNOBS, MOUNTAIN_TUNE_MARKS, mountainTuneFactors } from '../src/vehicles/mountainTuneGrip';

/**
 * Each car's cornering grip as set up for the mountain road (src/vehicles/mountainSetup), against what its AI plans
 * with (CarSpec.ai.latAccel x aiLat - the line's speeds, times its budget): on open flat ground, held at each speed
 * (the throttle and brake on it), the wheel wound on from straight to full lock over RAMP s - the sideways
 * acceleration (the course's turn rate x speed, over 0.3 s) at its most before the car slides past SLIDE° (the tail
 * out: no longer a line it follows), and at its most at all.
 *   CARS=muscle-car npx vitest run --config training/vitest.config.ts training/mountainGrip.train.ts
 */
const CAR_IDS = (process.env.CARS ?? 'street-racer,muscle-car,jdm').split(',');
const RAMP = Number(process.env.RAMP ?? 8);
const SLIDE = Number(process.env.SLIDE ?? 5);
const MARKS = [50, 75, 100, 125, 150, 175, 200, 250];

const tableAt = (t: AccelTable, kmh: number) => {
  if (kmh <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++)
    if (kmh <= t[i][0]) return t[i - 1][1] + ((kmh - t[i - 1][0]) / (t[i][0] - t[i - 1][0])) * (t[i][1] - t[i - 1][1]);
  return t[t.length - 1][1];
};

function pad(params: CarParams, kmh: number, side: 1 | -1) {
  const physics = openGround();
  physics.timestep = PHYSICS_DT;
  const car = new PlayerCar(physics, null, { entity: { type: 'rival', id: 0 } });
  Object.assign(car.params, params);
  car.applyMass();
  car.resetTo(0, 1, kmh * KMH);
  const course = () => car.yaw + Math.atan2(car.vLat, Math.max(1, car.vLong));
  const hist: number[] = [];
  const win = Math.round(0.3 / PHYSICS_DT);
  let held = 0, most = 0, steerAt = 0;
  let slid = false;
  // (a second straight first: settled at its speed)
  const steps = Math.round((1 + RAMP) / PHYSICS_DT);
  for (let i = 0; i < steps; i++) {
    const t = i * PHYSICS_DT;
    const steer = side * Math.max(0, Math.min(1, (t - 1) / RAMP));
    const err = kmh * KMH - car.speed;
    car.prePhysics({ throttle: Math.max(0, Math.min(1, err / 2)), brake: Math.max(0, Math.min(1, -err / 4)), steer }, PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
    // (unwrapped: round and round past ±π)
    const c = course();
    const last = hist.length ? hist[hist.length - 1] : c;
    hist.push(last + Math.atan2(Math.sin(c - last), Math.cos(c - last)));
    if (hist.length <= win) continue;
    const rate = Math.abs(hist[hist.length - 1] - hist[hist.length - 1 - win]) / (win * PHYSICS_DT);
    const a = rate * Math.hypot(car.vLong, car.vLat);
    const slide = (Math.abs(Math.atan2(car.vLat, Math.max(1, Math.abs(car.vLong)))) * 180) / Math.PI;
    // (its speed held within 5 %: past that it is running out of grip to hold it - braking or bogging - not cornering)
    const onSpeed = Math.abs(car.speed - kmh * KMH) < 0.05 * kmh * KMH;
    if (slide > SLIDE) slid = true;
    if (!slid && onSpeed && a > held) {
      held = a;
      steerAt = Math.abs(steer);
    }
    if (onSpeed) most = Math.max(most, a);
  }
  physics.free();
  return { held, most, steerAt };
}

/** Full brake from 15 km/h over `kmh` (from cruising, as the AI brakes), straight on: the mean over the 30 km/h it takes to lose (m/s²). */
function stopAt(params: CarParams, kmh: number) {
  const physics = openGround();
  physics.timestep = PHYSICS_DT;
  const car = new PlayerCar(physics, null, { entity: { type: 'rival', id: 0 } });
  Object.assign(car.params, params);
  car.applyMass();
  car.resetTo(0, 1, (kmh + 15) * KMH);
  const step = (throttle: number, brake: number) => {
    const steer = Math.max(-1, Math.min(1, -(car.d - 1) * 0.05 - car.yaw));
    car.prePhysics({ throttle, brake, steer }, PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
  };
  for (let i = 0; i < 0.3 / PHYSICS_DT; i++) step(0.3, 0);
  const v0 = car.speed;
  let t = 0;
  while (v0 - car.speed < 30 * KMH && t < 10) {
    step(0, 1);
    t += PHYSICS_DT;
  }
  physics.free();
  return (v0 - car.speed) / t;
}

/** Its cornering held (m/s², the less of either way) and its full brake at each of `marks` (the last measured on past its top). */
function measure(p: CarParams, marks: number[]) {
  const lat: number[] = [], brake: number[] = [];
  for (const kmh of marks) {
    if (kmh * KMH > p.maxSpeed * 0.97 && lat.length) {
      lat.push(lat[lat.length - 1]);
      brake.push(brake[brake.length - 1]);
      continue;
    }
    lat.push(Math.min(pad(p, kmh, 1).held, pad(p, kmh, -1).held));
    brake.push(stopAt(p, kmh));
  }
  return { lat, brake };
}

/**
 * TUNE=1: each car's grip-changing perf knobs (a rival's at random each race: randomPerfTuning) at each level, as set up
 * for the mountain road - its cornering and braking over as built at each of MOUNTAIN_TUNE_MARKS, written to
 * src/vehicles/mountainTuneGripData.ts; and a few tunings at random measured whole against the knobs' product.
 */
it.runIf(!!process.env.TUNE)('mountain grip by tuning', async () => {
  await RAPIER.init();
  const data: Record<string, Record<string, Record<string, { lat: number[]; brake: number[] }>>> = {};
  const out: string[] = [];
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  for (const id of CAR_IDS) {
    const spec = CARS[id];
    const setup = mountainSetupOf(id);
    const base = measure(mountainSetup(spec.params, setup), MOUNTAIN_TUNE_MARKS);
    data[id] = {};
    for (const key of MOUNTAIN_GRIP_KNOBS) {
      data[id][key] = {};
      for (const level of [-2, -1, 1, 2]) {
        const m = measure(mountainSetup(tuned(spec.params, { [key]: level }, TUNE_CAL[id]), setup), MOUNTAIN_TUNE_MARKS);
        data[id][key][level] = { lat: m.lat.map((a, i) => r3(a / base.lat[i])), brake: m.brake.map((a, i) => r3(a / base.brake[i])) };
        out.push(`${id} ${key} ${level}: lat ${data[id][key][level].lat.join(' ')} | brake ${data[id][key][level].brake.join(' ')}`);
      }
    }
    // (the knobs together: their product against the whole measured)
    const rand = mulberry32(7);
    let worst = 0, sum = 0, n = 0;
    for (let k = 0; k < 6; k++) {
      const tuning = randomPerfTuning(rand);
      const m = measure(mountainSetup(tuned(spec.params, tuning, TUNE_CAL[id]), setup), MOUNTAIN_TUNE_MARKS);
      const f = mountainTuneFactors(id, tuning, data);
      MOUNTAIN_TUNE_MARKS.forEach((_, i) => {
        for (const [got, want] of [[m.lat[i] / base.lat[i], f.lat[i]], [m.brake[i] / base.brake[i], f.brake[i]]]) {
          const e = Math.abs(got / want - 1);
          worst = Math.max(worst, e);
          sum += e;
          n++;
        }
      });
    }
    out.push(`${id}: 6 tunings at random, measured whole against the knobs' product - off by ${((100 * sum) / n).toFixed(1)} % on average, ${(100 * worst).toFixed(1)} % at worst`);
  }
  process.stdout.write(out.join('\n') + '\n');
  const fs = await import('fs');
  fs.writeFileSync(
    new URL('../src/vehicles/mountainTuneGripData.ts', import.meta.url),
    `// Generated by training/mountainGrip.train.ts (TUNE=1): each car's cornering (lat) and full brake as tuned over as\n// built, at each of MOUNTAIN_TUNE_MARKS, as set up for the mountain road.\nimport type { MountainTuneGrip } from './mountainTuneGrip';\n\nexport const MOUNTAIN_TUNE_GRIP: MountainTuneGrip = ${JSON.stringify(data)};\n`,
  );
});

it.runIf(!process.env.TUNE)('mountain grip', async () => {
  await RAPIER.init();
  const out: string[] = [`(sideways m/s²: held = most before ${SLIDE}° of slide, at its speed; the wheel 0 -> 1 over ${RAMP} s)`];
  for (const id of CAR_IDS) {
    const spec = CARS[id];
    const setup = mountainSetupOf(id);
    const p = mountainSetup(spec.params, setup);
    const plan = mountainAi(spec.ai, setup);
    out.push(`${id} (its plan's tables: ${spec.ai.mountain ? 'measured, CarSpec.ai.mountain' : `the highway's x aiLat ${setup.aiLat}, brakes x longGrip ${setup.longGrip}`}):`);
    const lat: [number, number][] = [];
    const brake: [number, number][] = [];
    for (const kmh of MARKS) {
      if (kmh * KMH > p.maxSpeed * 0.97) continue;
      const r = [pad(p, kmh, 1), pad(p, kmh, -1)];
      const held = Math.min(r[0].held, r[1].held);
      const most = Math.min(r[0].most, r[1].most);
      const b = stopAt(p, kmh);
      lat.push([kmh, Math.round(held * 10) / 10]);
      brake.push([kmh, Math.round(b * 10) / 10]);
      out.push(
        `  ${String(kmh).padStart(3)} km/h  held ${held.toFixed(1)} (wheel ${Math.max(r[0].steerAt, r[1].steerAt).toFixed(2)})  most ${most.toFixed(1)}  ` +
          `plan ${tableAt(plan.latAccel, kmh).toFixed(1)} (x${(held / tableAt(plan.latAccel, kmh)).toFixed(2)})  ` +
          `brake ${b.toFixed(1)} plan ${tableAt(plan.brake, kmh).toFixed(1)} (x${(b / tableAt(plan.brake, kmh)).toFixed(2)})`,
      );
    }
    // (paste-ready: the slowest's below it too)
    const rows = (t: [number, number][]) => [[0, t[0][1]], ...t].map(([k, a]) => `[${k}, ${a}]`).join(', ');
    out.push(`  mountain: { latAccel: [${rows(lat)}], brake: [${rows(brake)}] },`);
  }
  process.stdout.write(out.join('\n') + '\n');
});
