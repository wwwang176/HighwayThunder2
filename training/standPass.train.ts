import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { LANE_COUNT, PHYSICS_DT } from '../src/config';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { CARS } from '../src/vehicles/cars';
import { selfStateOf } from '../src/ai/driver';
import { COURSE_STATS, coursePlan } from '../src/ai/coursePlanner';
import { planPedals, DRIVER_TUNING } from '../src/ai/plannerDriver';
if (process.env.DRIVER_JSON) Object.assign(DRIVER_TUNING, JSON.parse(process.env.DRIVER_JSON));
import { makeDriver } from './drivers';
import type { TrafficBox } from '../src/ai/sensors';
import { depthInto } from '../src/ai/bodies';

/**
 * (Scratch) Standing behind a standing car: does the AI get round it? The car stopped in the middle lane, a stopped
 * car (seen only) GAPS m ahead bumper to bumper, OFFS m to the side; RUN_S s. Away: its front past the other's rear,
 * clear of it sideways. Why not: no plan out (the first plan's end), the plan off the pedal, the emergency brake.
 *   npx vitest run --config training/vitest.config.ts training/standPass.train.ts
 */
const GAPS = (process.env.GAPS ?? '0.5,1,1.5,2,2.5,3,4,5,6,8').split(',').map(Number);
const OFFS = (process.env.OFFS ?? '0,0.9').split(',').map(Number);
const RUN_S = 6;
const OW = 1.9, OL = 4.4;

it.runIf(process.env.OPEN)('open loop: full lock from a standstill', async () => {
  await RAPIER.init();
  const lines: string[] = [];
  for (const [id, spec] of Object.entries(CARS)) {
    for (const thr of [0.3, 0.6, 1]) {
      const physics = PhysicsWorld.createSync();
      physics.timestep = PHYSICS_DT;
      const car = new PlayerCar(physics, null, { spec });
      car.resetTo(100, Math.floor(LANE_COUNT / 2), 0);
      for (let i = 0; i < Math.round(0.5 / PHYSICS_DT); i++) { car.prePhysics({ steer: 0, throttle: 0, brake: 1 }, PHYSICS_DT); physics.step(() => {}); car.postPhysics(); }
      const s0 = car.s, d0 = car.d;
      const R = (spec.params.wheelbase / Math.tan(spec.params.maxSteer)) / 0.8;
      const marks = [1, 2, 3, 4, 5], got: string[] = [];
      let k = 0;
      for (let i = 0; i < Math.round(4 / PHYSICS_DT) && k < marks.length; i++) {
        car.prePhysics({ steer: 1, throttle: thr, brake: 0 }, PHYSICS_DT); physics.step(() => {}); car.postPhysics();
        const x = car.s - s0;
        if (x >= marks[k]) { const ideal = x < R ? R - Math.sqrt(R * R - x * x) : R; got.push(`s${marks[k]}: d ${Math.abs(car.d - d0).toFixed(2)} (plan ${ideal.toFixed(2)}) yaw ${Math.abs(car.yaw * 57.3).toFixed(0)} v ${car.vLong.toFixed(1)} wheel ${(car.wheel ?? NaN).toFixed(2)}`); k++; }
      }
      physics.free();
      lines.push(`${id.padEnd(12)} thr ${thr}: ${got.join(' | ')}`);
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
}, 600_000);

it.skipIf(process.env.OPEN)('stand pass', async () => {
  await RAPIER.init();
  const cars = process.env.CAR ? [process.env.CAR] : Object.keys(CARS);
  const lines: string[] = [];
  const ways: unknown[] = [];
  for (const id of cars) {
    const spec = CARS[id];
    for (const off of OFFS) for (const gap of GAPS) {
      const physics = PhysicsWorld.createSync();
      physics.timestep = PHYSICS_DT;
      const car = new PlayerCar(physics, null, { spec });
      car.resetTo(100, Math.floor(LANE_COUNT / 2), 0);
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      for (let i = 0; i < Math.round(0.5 / PHYSICS_DT); i++) {
        car.prePhysics({ steer: 0, throttle: 0, brake: 1 }, PHYSICS_DT);
        physics.step(() => {});
        car.postPhysics();
      }
      const hl = car.params.length / 2, hw = car.params.width / 2;
      const os = car.s + hl + gap + OL / 2, od = car.d + off;
      const other: TrafficBox = { s: os, dMin: od - OW / 2, dMax: od + OW / 2, v: 0, length: OL, id: 9, body: { yaw: 0, halfLength: OL / 2, halfWidth: OW / 2 } };
      // the first plan, as the planner makes it from here
      const self0 = selfStateOf(car, spec.params.maxSpeed);
      const fb0 = COURSE_STATS.fallback, rel0 = COURSE_STATS.relaxed;
      const driver = makeDriver(spec);
      let emerg = 0, planOff = 0, awayAt = NaN, minSide = Infinity, maxYaw = 0, firstEnd = NaN, firstMaxD = 0;
      // WAYS=<out.json>: every run's way (t, s, d from where it stood, yaw, m/s, steer, brake, emergency; every 1/20 s)
      // and the plans it took up (their first 3 s), for the showcase replays.
      const s0 = car.s, d0 = car.d;
      const frames: number[][] = [], plans: { t: number; pts: number[][] }[] = [];
      let lastPlan: unknown = null;
      for (let i = 0; i < Math.round(RUN_S / PHYSICS_DT); i++) {
        const t = i * PHYSICS_DT;
        const self = selfStateOf(car, spec.params.maxSpeed);
        const o0 = driver.overrides;
        const input = driver.drive(self, [other], car.params);
        if (process.env.WAYS) {
          if (i % Math.max(1, Math.round(0.05 / PHYSICS_DT)) === 0) frames.push([+t.toFixed(3), +(car.s - s0).toFixed(3), +(car.d - d0).toFixed(3), +car.yaw.toFixed(4), +car.vLong.toFixed(2), +input.steer.toFixed(2), +input.brake.toFixed(2), driver.overrides > o0 ? 1 : 0]);
          if (driver.plan && driver.plan !== lastPlan) {
            lastPlan = driver.plan;
            plans.push({ t: +t.toFixed(3), pts: driver.plan.points.filter((p) => p.t <= 3.01).map((p) => [+(p.s - s0).toFixed(2), +(p.d - d0).toFixed(2)]) });
          }
        }
        if (Number.isNaN(firstEnd) && driver.plan) {
          firstEnd = driver.plan.points[driver.plan.points.length - 1].s - car.s;
          firstMaxD = Math.max(...driver.plan.points.map((p) => Math.abs(p.d - car.d)));
        }
        if (process.env.TRACE === `${id}:${off}:${gap}` && i % Math.round(0.1 / PHYSICS_DT) === 0) {
          const pts = driver.plan ? driver.plan.points.filter((p) => p.t <= 2.01).map((p) => `${p.t.toFixed(2)}:${(p.s - car.s).toFixed(1)},${(p.d - car.d).toFixed(2)},${p.v.toFixed(1)}`).join(' ') : '';
          process.stdout.write(`  t${t.toFixed(1)} ds ${(os - OL / 2 - car.s - hl).toFixed(2)} d ${(car.d - od).toFixed(2)} yaw ${(car.yaw * 57.3).toFixed(1)} v ${car.vLong.toFixed(2)} wheel ${(car.wheel ?? NaN).toFixed(2)} | in steer ${input.steer.toFixed(2)} thr ${input.throttle.toFixed(2)} brk ${input.brake.toFixed(2)} ${driver.overrides > o0 ? 'EMERG' : ''}\n     plan ${pts}\n`);
        }
        if (driver.overrides > o0) emerg += PHYSICS_DT;
        // NOEB=1: the emergency brake's override undone (the plan's pedals)
        if (process.env.NOEB && driver.overrides > o0 && driver.plan) Object.assign(input, planPedals(driver.plan, driver.planAge, self.vLong, spec.ai.accel, spec.ai.brake));
        else if (driver.plan && planPedals(driver.plan, driver.planAge, self.vLong, spec.ai.accel).throttle === 0) planOff += PHYSICS_DT;
        car.prePhysics(input, PHYSICS_DT);
        physics.step(() => {});
        car.postPhysics();
        maxYaw = Math.max(maxYaw, Math.abs(car.yaw));
        // body to body, as they lie (- : into it - the other car is seen only, not hit)
        const reachS = hl * Math.cos(car.yaw) + hw * Math.abs(Math.sin(car.yaw));
        minSide = Math.min(minSide, -depthInto(car.s, car.d, car.yaw, hl, hw, other, 0));
        if (Number.isNaN(awayAt) && car.s - reachS > os + OL / 2) awayAt = t;
      }
      physics.free();
      void self0; void coursePlan;
      if (process.env.WAYS) ways.push({ car: id, off, gap, away: Number.isNaN(awayAt) ? null : +awayAt.toFixed(2), emergency: +emerg.toFixed(2), closest: +minSide.toFixed(3), hl, hw, other: { s: +(os - s0).toFixed(3), d: +(od - d0).toFixed(3), hl: OL / 2, hw: OW / 2 }, frames, plans });
      lines.push(`${id.padEnd(12)} off ${off.toFixed(1)} gap ${gap.toFixed(1)}: ${Number.isNaN(awayAt) ? 'STUCK   ' : `away ${awayAt.toFixed(1)}s`} | 1st plan end +${firstEnd.toFixed(1)} m, out ${firstMaxD.toFixed(1)} m | emergency ${emerg.toFixed(1)}s, plan off pedal ${planOff.toFixed(1)}s | fallback ${COURSE_STATS.fallback - fb0} relaxed ${COURSE_STATS.relaxed - rel0} | side min ${Number.isFinite(minSide) ? minSide.toFixed(2) : '-'} yaw max ${(maxYaw * 57.3).toFixed(0)}`);
    }
  }
  if (process.env.WAYS) writeFileSync(process.env.WAYS, JSON.stringify(ways));
  process.stdout.write(lines.join('\n') + '\n');
}, 600_000);
