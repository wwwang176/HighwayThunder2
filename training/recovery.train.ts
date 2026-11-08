import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { KMH, LANE_COUNT, PHYSICS_DT } from '../src/config';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { CARS } from '../src/vehicles/cars';
import { selfStateOf } from '../src/ai/driver';
import { baseSteer, trackerFrom } from '../src/ai/netTracker';
import { planAt } from '../src/ai/planner';
import { PlannerDriver } from '../src/ai/plannerDriver';

/**
 * How the AI drives off after a crash left it standing across the road: the car stopped in the middle lane at a
 * heading off the road's (each of HEADINGS, both ways), the rival's driver (its planner, its car's network) given
 * RUN_S s on the road with its rails, no traffic. For each: when it was away (heading within AWAY_YAW of the road's,
 * faster than AWAY_KMH, and staying so), how far it turned in all (a donut: far more than it started off by), how
 * far past straight it swung the other way, whether it touched a rail.
 *   CAR=muscle-car npx vitest run --config training/vitest.config.ts training/recovery.train.ts
 * (CAR: the car type, default all three.)
 */

const HEADINGS = [45, 90, 135]; // deg off the road's
const RUN_S = 12;
const AWAY_YAW = (15 * Math.PI) / 180;
const AWAY_KMH = 40;
const AWAY_HOLD = 1; // s it must stay away
const DEG = 180 / Math.PI;

it('recovery', async () => {
  await RAPIER.init();
  const cars = process.env.CAR ? [process.env.CAR] : Object.keys(CARS);
  const lines: string[] = [];
  const trace: string[] = [];
  for (const id of cars) {
    const spec = CARS[id];
    if (!spec) throw new Error(`no car "${id}"`);
    const rows: string[] = [];
    let away = 0, total = 0, turned = 0, rails = 0;
    for (const deg of HEADINGS) {
      for (const side of [1, -1]) {
        const physics = PhysicsWorld.createSync();
        physics.timestep = PHYSICS_DT;
        const car = new PlayerCar(physics, null, { spec });
        const cap = spec.params.maxSpeed;
        car.resetTo(100, Math.floor(LANE_COUNT / 2), 0);
        const a = (side * deg) / DEG;
        car.body.setRotation({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }, true);
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        // Settled on its springs first, standing.
        for (let i = 0; i < Math.round(0.5 / PHYSICS_DT); i++) {
          car.prePhysics({ steer: 0, throttle: 0, brake: 1 }, PHYSICS_DT);
          physics.step(() => {});
          car.postPhysics();
        }
        const driver = new PlannerDriver();
        driver.accel = spec.ai.accel;
        driver.latAccel = spec.ai.latAccel;
        driver.tracker = trackerFrom(spec.ai.tracker);
        const start = car.yaw;
        let rotation = 0, overshoot = 0, awayAt = NaN, awaySince = NaN, touched = false;
        for (let i = 0; i < Math.round(RUN_S / PHYSICS_DT); i++) {
          const t = i * PHYSICS_DT;
          const self = selfStateOf(car, cap);
          const input = driver.drive(self, [], car.params);
          // TRACE=street-racer:-135: that run's every 0.25 s (where it heads, how it moves, what it's told, its plan).
          if (process.env.TRACE === `${id}:${side * deg}` && i % Math.round(0.25 / PHYSICS_DT) === 0) {
            const pl = driver.plan ? planAt(driver.plan, driver.planAge + 0.5) : null;
            const base = driver.plan ? baseSteer(driver.plan, driver.planAge, self, car.params) : NaN;
            trace.push(`  t ${t.toFixed(2)} yaw ${(car.yaw * DEG).toFixed(0)} vLong ${car.vLong.toFixed(1)} vLat ${car.vLat.toFixed(1)} d ${car.d.toFixed(1)} yawRate ${car.yawRate.toFixed(2)}`
              + ` | steer ${input.steer.toFixed(2)} (base ${base.toFixed(2)}) thr ${input.throttle.toFixed(2)} brk ${input.brake.toFixed(2)}`
              + (pl ? ` | plan+0.5s d ${pl.d.toFixed(1)} v ${pl.v.toFixed(1)}` : ''));
          }
          car.prePhysics(input, PHYSICS_DT);
          physics.step((x, y) => {
            if (x.type === 'static' || y.type === 'static') touched = true; // (a rail: the ground's under the wheels, not the body)
          });
          car.postPhysics();
          rotation += Math.abs(car.yawRate) * PHYSICS_DT;
          if (Math.sign(car.yaw) === -Math.sign(start)) overshoot = Math.max(overshoot, Math.abs(car.yaw));
          const ok = Math.abs(car.yaw) < AWAY_YAW && car.vLong > AWAY_KMH * KMH;
          if (!ok) awaySince = NaN;
          else if (Number.isNaN(awaySince)) awaySince = t;
          if (Number.isNaN(awayAt) && !Number.isNaN(awaySince) && t - awaySince >= AWAY_HOLD) awayAt = awaySince;
        }
        physics.free();
        total++;
        turned += rotation * DEG;
        if (!Number.isNaN(awayAt)) away++;
        if (touched) rails++;
        rows.push(`  ${String(side * deg).padStart(5)} deg: ${Number.isNaN(awayAt) ? 'NOT away' : `away ${awayAt.toFixed(1)} s`}, turned ${(rotation * DEG).toFixed(0)} deg, swung past ${(overshoot * DEG).toFixed(0)} deg${touched ? ', rail' : ''}`);
      }
    }
    lines.push(`${id}: away ${away}/${total}, turned ${(turned / total).toFixed(0)} deg a run on average, rails ${rails}`, ...rows);
  }
  process.stdout.write([...lines, ...trace].join('\n') + '\n');
}, 600_000);
