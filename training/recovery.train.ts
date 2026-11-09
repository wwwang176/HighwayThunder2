import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { KMH, LANE_COUNT, PHYSICS_DT } from '../src/config';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { CARS } from '../src/vehicles/cars';
import { selfStateOf } from '../src/ai/driver';
import { baseSteer, trackerFrom } from '../src/ai/netTracker';
import type { Brain } from '../src/ai/brain';
import { PLAN_STATS, planAt } from '../src/ai/planner';
import { PlannerDriver, planPedals } from '../src/ai/plannerDriver';

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
/** PROBE_FLOOR=0.6: throttle at least this while off the road's heading by AWAY_YAW (and not braking): could a firmer pedal do? */
const PROBE_FLOOR = Number(process.env.PROBE_FLOOR ?? 0);
/** PROBE_LEAD=0.4: ...only while it would not reach the road's heading within this many s at its yaw rate (then off it). */
const PROBE_LEAD = Number(process.env.PROBE_LEAD ?? 0);
/** PROBE_WRECK="6,0,0;-8,3.75,20": other cars (m ahead of it, m to the side of its start, m/s), seen only (not physical). */
/**
 * PROBE_RECOVERY=<file.json> (training/out/tracker's archives: { weights }) - the network standing across the road
 * instead of the car's own (CarSpec.ai.recovery); =none: the tracker there too.
 */
const PROBE_RECOVERY: Brain | null | undefined =
  process.env.PROBE_RECOVERY === undefined
    ? undefined
    : process.env.PROBE_RECOVERY === 'none'
      ? null
      : trackerFrom(JSON.parse(readFileSync(process.env.PROBE_RECOVERY, 'utf8')).weights);
/** PROBE_X=-13: where across it stands (m, x; -10..-20 the median's grass), not the middle lane. */
const PROBE_X = process.env.PROBE_X === undefined ? NaN : Number(process.env.PROBE_X);
const PROBE_WRECK = (process.env.PROBE_WRECK ?? '').split(';').filter(Boolean).map((x) => x.split(',').map(Number));

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
        if (!Number.isNaN(PROBE_X)) car.body.setTranslation({ ...car.body.translation(), x: PROBE_X }, true);
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
        driver.recovery = PROBE_RECOVERY === undefined ? trackerFrom(spec.ai.recovery) : PROBE_RECOVERY;
        const start = car.yaw;
        const d0 = car.d;
        let braked = 0, planStop = 0, maxD = 0;
        const fallback0 = PLAN_STATS.fallback;
        let rotation = 0, overshoot = 0, awayAt = NaN, awaySince = NaN, touched = false;
        for (let i = 0; i < Math.round(RUN_S / PHYSICS_DT); i++) {
          const t = i * PHYSICS_DT;
          const self = selfStateOf(car, cap);
          const others = PROBE_WRECK.map(([ds, dd, v]) => ({ s: 100 + ds + v * t, dMin: d0 + dd - 0.95, dMax: d0 + dd + 0.95, v, length: 4.4 }));
          const input = driver.drive(self, others, car.params);
          if (input.brake > 0) braked += PHYSICS_DT;
          maxD = Math.max(maxD, Math.abs(car.d)); // (past RAIL_D: through the rail - what follows is no test)
          if (Number.isNaN(awayAt) && driver.plan && planPedals(driver.plan, driver.planAge, self.vLong, spec.ai.accel).throttle === 0) planStop += PHYSICS_DT; // (the plan, not the network)
          if (PROBE_FLOOR > 0 && input.brake === 0 && Math.abs(car.yaw) > AWAY_YAW + PROBE_LEAD * Math.max(0, -Math.sign(car.yaw) * car.yawRate)) input.throttle = Math.max(input.throttle, PROBE_FLOOR);
          // TRACE=street-racer:-135: that run's every 0.25 s (where it heads, how it moves, what it's told, its plan).
          if (process.env.TRACE === `${id}:${side * deg}` && i % Math.round(0.25 / PHYSICS_DT) === 0) {
            const pl = driver.plan ? planAt(driver.plan, driver.planAge + 0.5) : null;
            const base = driver.plan ? baseSteer(driver.plan, driver.planAge, self, car.params) : NaN;
            const asked = driver.plan ? planPedals(driver.plan, driver.planAge, self.vLong, spec.ai.accel).throttle : NaN; // (before the network takes some back)
            trace.push(`  t ${t.toFixed(2)} yaw ${(car.yaw * DEG).toFixed(0)} vLong ${car.vLong.toFixed(1)} vLat ${car.vLat.toFixed(1)} d ${car.d.toFixed(1)} spin ${(self.rearSpin ?? 0).toFixed(1)} yawRate ${car.yawRate.toFixed(2)}`
              + ` | steer ${input.steer.toFixed(2)} (base ${base.toFixed(2)}) thr ${input.throttle.toFixed(2)} (plan ${asked.toFixed(2)}) brk ${input.brake.toFixed(2)}`
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
        rows.push(`  ${String(side * deg).padStart(5)} deg: ${Number.isNaN(awayAt) ? 'NOT away' : `away ${awayAt.toFixed(1)} s`}, turned ${(rotation * DEG).toFixed(0)} deg, swung past ${(overshoot * DEG).toFixed(0)} deg, braked ${braked.toFixed(1)} s (emergency ${(driver.overrides * PHYSICS_DT).toFixed(1)} s), plan off the pedal ${planStop.toFixed(1)} s, no plan found ${PLAN_STATS.fallback - fallback0}x, |d| up to ${maxD.toFixed(1)} m${touched ? ', rail' : ''}`);
      }
    }
    lines.push(`${id}: away ${away}/${total}, turned ${(turned / total).toFixed(0)} deg a run on average, rails ${rails}`, ...rows);
  }
  process.stdout.write([...lines, ...trace].join('\n') + '\n');
}, 600_000);
