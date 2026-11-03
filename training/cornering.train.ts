import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { openGround } from './openGround';
import { PlayerCar } from '../src/vehicles/playerCar';
import { CARS } from '../src/vehicles/cars';
import { KMH, PHYSICS_DT } from '../src/config';
import * as THREE from 'three';

/** The car type these measure (CAR=muscle-car; default the supercar), with CAR_JSON='{"springK":24000}' changes on top. */
const BASE_SPEC = CARS[process.env.CAR ?? 'street-racer'];
if (!BASE_SPEC) throw new Error(`no car "${process.env.CAR}" (have: ${Object.keys(CARS).join(', ')})`);
const CAR_SPEC = { ...BASE_SPEC, params: { ...BASE_SPEC.params, ...JSON.parse(process.env.CAR_JSON ?? '{}') } };

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
    for (const kmh of speeds([100, 200, 280])) {
      const physics = openGround();
      physics.timestep = PHYSICS_DT;
      // Settings go in before the car is built: the centre of mass is fixed then.
      const car = new PlayerCar(physics, null, { spec: { ...CAR_SPEC, params: { ...CAR_SPEC.params, ...change } } });
      car.params.maxSpeed = kmh * KMH;
      car.resetTo(0, 1, kmh * KMH);
      const course = () => car.yaw + Math.atan2(car.vLat, Math.max(1, car.vLong));
      let c0 = 0;
      let speedSum = 0;
      let n = 0;
      let slipMax = 0;
      let rollMax = 0;
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
        const q = car.body.rotation();
        rollMax = Math.max(rollMax, Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))));
      }
      const lat = (Math.abs(course() - c0) / (n * PHYSICS_DT)) * (speedSum / n);
      row.push(`${kmh}: ${(lat / 9.81).toFixed(2)} g, slip ${(slipMax * 57.3).toFixed(0)}° tilt ${(rollMax * 57.3).toFixed(0)}°${slipMax > 0.35 ? ' SPUN' : ''}${rollMax > 1 ? ' ROLLED' : ''}`);
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
    const physics = openGround();
    physics.timestep = PHYSICS_DT;
    const car = new PlayerCar(physics, null, { spec: { ...CAR_SPEC, params: { ...CAR_SPEC.params, ...change } } });
    car.params.maxSpeed = kmh * KMH;
    car.resetTo(0, 1, kmh * KMH);
    const d0 = car.d;
    const marks: string[] = [];
    let laneAt = NaN;
    let slipMax = 0;
    let tiltMax = 0;
    let gMax = 0;
    let vLatPrev = 0;
    const steer = Number(process.env.STEER ?? 1); // 0.3: a gentle lane change
    for (let i = 1; i <= Math.round(1.5 / PHYSICS_DT); i++) {
      const t = i * PHYSICS_DT;
      car.prePhysics({ throttle: 1, brake: 0, steer: t < 1 ? steer : 0 }, PHYSICS_DT);
      physics.step(() => {});
      car.postPhysics();
      const moved = Math.abs(car.d - d0);
      slipMax = Math.max(slipMax, Math.abs(Math.atan2(car.vLat, Math.max(1, car.vLong))));
      const q = car.body.rotation();
      tiltMax = Math.max(tiltMax, Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))));
      const vD = car.vLong * Math.sin(car.yaw) + car.vLat * Math.cos(car.yaw);
      gMax = Math.max(gMax, Math.abs(vD - vLatPrev) / PHYSICS_DT / 9.81);
      vLatPrev = vD;
      if ([0.25, 0.5, 0.75, 1].some((x) => Math.abs(t - x) < PHYSICS_DT / 2)) marks.push(`${t.toFixed(2)}s ${moved.toFixed(2)} m`);
      if (isNaN(laneAt) && moved >= 3.75) laneAt = t;
    }
    out.push(`${name.padEnd(14)} ${marks.join(' | ')} | lane in ${laneAt.toFixed(2)} s | slip max ${(slipMax * 57.3).toFixed(0)}° | sideways g max ${gMax.toFixed(2)} | tilt max ${(tiltMax * 57.3).toFixed(1)}°`);
    physics.free();
  }
  process.stdout.write(out.join('\n') + '\n');
});

/**
 * Keyboard moves a player makes at speed (key held for so long, then the other way): the body's
 * biggest tilt and whether it rolls. Moves: quick lane change, hard swerve, slalom.
 *   TURN_JSON='{"soft":{"springK":25000}}' npx vitest run --config training/vitest.config.ts training/cornering.train.ts -t maneuvers
 */
it('maneuvers', async () => {
  await RAPIER.init();
  const variants: Record<string, Record<string, number>> = process.env.TURN_JSON ? JSON.parse(process.env.TURN_JSON) : { now: {} };
  const moves: Record<string, [number, number][]> = {
    'lane 0.3+0.3': [[1, 0.3], [-1, 0.3]],
    'swerve 0.6+0.6': [[1, 0.6], [-1, 0.6]],
    'slalom 3x0.4': [[1, 0.4], [-1, 0.4], [1, 0.4], [-1, 0.4], [1, 0.4], [-1, 0.4]],
  };
  const out: string[] = [];
  for (const [name, change] of Object.entries(variants)) {
    const row: string[] = [];
    for (const kmh of speeds([200, 280])) {
      for (const [move, keys] of Object.entries(moves)) {
        const physics = openGround();
        physics.timestep = PHYSICS_DT;
        const car = new PlayerCar(physics, null, { spec: { ...CAR_SPEC, params: { ...CAR_SPEC.params, ...change } } });
        car.params.maxSpeed = kmh * KMH;
        car.resetTo(0, 1, kmh * KMH);
        const plan: [number, number][] = [[0, 0.5], ...keys, [0, 1.5]]; // settle on the springs first
        let tilt = 0;
        for (const [steer, secs] of plan)
          for (let i = 0; i < Math.round(secs / PHYSICS_DT); i++) {
            car.prePhysics({ throttle: 1, brake: 0, steer }, PHYSICS_DT);
            physics.step(() => {});
            car.postPhysics();
            const q = car.body.rotation();
            tilt = Math.max(tilt, Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))));
          }
        row.push(`${kmh} ${move}: ${(tilt * 57.3).toFixed(1)}°${tilt > 1 ? ' ROLLED' : ''} (ends at d ${car.d.toFixed(1)}, guardrail at 10)`);
        physics.free();
      }
    }
    out.push(`${name}\n  ${row.join('\n  ')}`);
  }
  process.stdout.write(out.join('\n') + '\n');
});

/**
 * What a tap of the key leaves behind: steer for TAP s at speed, then hands off. The body's roll
 * and the car's yaw rate afterwards - how far they swing back the other way, how often they
 * cross over, and how long until both settle (roll < 0.3 deg, yaw rate < 0.5 deg/s).
 *   TURN_JSON='{"stiff":{"antiRollFront":18000}}' TAP=0.15 npx vitest run --config training/vitest.config.ts training/cornering.train.ts -t tap
 */
it('tap', async () => {
  await RAPIER.init();
  const variants: Record<string, Record<string, number>> = process.env.TURN_JSON ? JSON.parse(process.env.TURN_JSON) : { now: {} };
  const tap = Number(process.env.TAP ?? 0.15);
  const out: string[] = [];
  for (const [name, change] of Object.entries(variants)) {
    const row: string[] = [];
    for (const kmh of speeds([200, 280])) {
      const physics = openGround();
      physics.timestep = PHYSICS_DT;
      const car = new PlayerCar(physics, null, { spec: { ...CAR_SPEC, params: { ...CAR_SPEC.params, ...change } } });
      car.params.maxSpeed = kmh * KMH;
      car.resetTo(0, 1, kmh * KMH);
      const roll = () => {
        const q = car.body.rotation();
        // Signed lean about the car's own length: + = right side down.
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
        return Math.asin(Math.max(-1, Math.min(1, -right.y)));
      };
      const yawRate = () => car.body.angvel().y;
      const steps = (s: number) => Math.round(s / PHYSICS_DT);
      for (let i = 0; i < steps(0.5); i++) {
        car.prePhysics({ throttle: 1, brake: 0, steer: 0 }, PHYSICS_DT);
        physics.step(() => {});
        car.postPhysics();
      }
      let rollPeak = 0;
      let yawPeak = 0;
      let rollBack = 0;
      let yawBack = 0;
      let rollCross = 0;
      let yawCross = 0;
      let settled = NaN;
      let lastRoll = 0;
      let lastYaw = 0;
      for (let i = 0; i < steps(tap + 3); i++) {
        const t = i * PHYSICS_DT;
        car.prePhysics({ throttle: 1, brake: 0, steer: t < tap ? 1 : 0 }, PHYSICS_DT);
        physics.step(() => {});
        car.postPhysics();
        const r = roll();
        const y = yawRate();
        if (Math.abs(r) > Math.abs(rollPeak) && Math.sign(r) === Math.sign(rollPeak || r)) rollPeak = r;
        if (Math.abs(y) > Math.abs(yawPeak) && Math.sign(y) === Math.sign(yawPeak || y)) yawPeak = y;
        if (rollPeak && Math.sign(r) === -Math.sign(rollPeak)) rollBack = Math.max(rollBack, Math.abs(r));
        if (yawPeak && Math.sign(y) === -Math.sign(yawPeak)) yawBack = Math.max(yawBack, Math.abs(y));
        if (t > tap && Math.abs(r) > 0.001 && Math.sign(r) !== Math.sign(lastRoll)) rollCross++;
        if (t > tap && Math.abs(y) > 0.002 && Math.sign(y) !== Math.sign(lastYaw)) yawCross++;
        if (Math.abs(r) > 0.001) lastRoll = r;
        if (Math.abs(y) > 0.002) lastYaw = y;
        if (t > tap && (Math.abs(r) * 57.3 > 0.3 || Math.abs(y) * 57.3 > 0.5)) settled = NaN;
        else if (t > tap && isNaN(settled)) settled = t - tap;
      }
      const deg = (x: number) => (Math.abs(x) * 57.3).toFixed(1);
      row.push(
        `${kmh}: roll ${deg(rollPeak)}° back ${deg(rollBack)}° x${rollCross} | yaw ${deg(yawPeak)}°/s back ${deg(yawBack)}°/s x${yawCross} | settled ${isNaN(settled) ? '>3' : settled.toFixed(2)} s`,
      );
      physics.free();
    }
    out.push(`${name}\n  ${row.join('\n  ')}`);
  }
  process.stdout.write(out.join('\n') + '\n');
});

/**
 * Full throttle from a standstill down a straight: seconds to 100 / 200 km/h, the top speed it
 * reaches in 40 s, and how far the nose comes up (pitch, deg; + nose up) in the first 3 s.
 *   CAR=muscle-car npx vitest run --config training/vitest.config.ts training/cornering.train.ts -t launch
 */
it('launch', async () => {
  await RAPIER.init();
  const physics = openGround();
  physics.timestep = PHYSICS_DT;
  const car = new PlayerCar(physics, null, { spec: CAR_SPEC });
  car.resetTo(0, 1, 0);
  const d0 = car.d;
  const times: Record<number, number> = {};
  let pitchMax = 0;
  let top = 0;
  const nose = new THREE.Vector3();
  for (let i = 1; i <= Math.round(40 / PHYSICS_DT); i++) {
    const t = i * PHYSICS_DT;
    const steer = Math.max(-1, Math.min(1, -(car.d - d0) * 0.05 - car.yaw));
    car.prePhysics({ throttle: 1, brake: 0, steer }, PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
    const kmh = car.speed / KMH;
    top = Math.max(top, kmh);
    for (const mark of [100, 200]) if (times[mark] === undefined && kmh >= mark) times[mark] = t;
    if (t < 3) {
      const q = car.body.rotation();
      nose.set(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
      pitchMax = Math.max(pitchMax, Math.asin(nose.y) * 57.3);
    }
  }
  physics.free();
  const s = (x?: number) => (x === undefined ? 'never' : `${x.toFixed(2)} s`);
  process.stdout.write(`${CAR_SPEC.id}: 0-100 ${s(times[100])}, 0-200 ${s(times[200])}, top ${top.toFixed(0)} km/h (40 s), nose up ${pitchMax.toFixed(1)} deg (first 3 s)\n`);
});

/**
 * Power oversteer: holding a turn (steer STEER, default 0.6) on a third of the throttle for 1 s,
 * then flooring it for 1.5 s - the biggest body slip angle (deg) after the throttle goes down, and
 * whether it spun. A tail-happy car slides here; a planted one does not.
 *   CAR=muscle-car npx vitest run --config training/vitest.config.ts training/cornering.train.ts -t powerOn
 */
it('powerOn', async () => {
  await RAPIER.init();
  const steer = Number(process.env.STEER ?? 0.6);
  const row: string[] = [];
  for (const kmh of speeds([60, 100, 150])) {
    const physics = openGround();
    physics.timestep = PHYSICS_DT;
    const car = new PlayerCar(physics, null, { spec: CAR_SPEC });
    car.resetTo(0, 1, kmh * KMH);
    let slipMax = 0;
    for (let i = 1; i <= Math.round(2.5 / PHYSICS_DT); i++) {
      const t = i * PHYSICS_DT;
      car.prePhysics({ throttle: t < 1 ? 0.33 : 1, brake: 0, steer }, PHYSICS_DT);
      physics.step(() => {});
      car.postPhysics();
      if (t >= 1) slipMax = Math.max(slipMax, Math.abs(Math.atan2(car.vLat, Math.max(1, car.vLong))));
    }
    row.push(`${kmh}: slip ${(slipMax * 57.3).toFixed(0)}°${slipMax > 0.35 ? ' SPUN' : ''}`);
    physics.free();
  }
  process.stdout.write(`${CAR_SPEC.id} power on in a turn: ${row.join(' | ')}\n`);
});

/**
 * Steering under a hard brake: full brake and full steering together from a steady speed, for 1 s - how far
 * the direction of travel turned, how far sideways it got (dodging), the speed left, the body's largest slip
 * angle (SPUN past 20°). With the front tyres braking apart from their grip (frontBrakeApart) or not.
 *   npx vitest run --config training/vitest.config.ts training/cornering.train.ts -t brakeSteer
 */
it('brakeSteer', async () => {
  await RAPIER.init();
  const variants: Record<string, Record<string, number | boolean>> = process.env.BRAKE_JSON
    ? JSON.parse(process.env.BRAKE_JSON)
    : { apart: { frontBrakeApart: true }, circle: { frontBrakeApart: false } };
  const out: string[] = [];
  for (const [name, change] of Object.entries(variants)) {
    const row: string[] = [];
    for (const kmh of speeds([120, 200, 280])) {
      const physics = openGround();
      physics.timestep = PHYSICS_DT;
      const car = new PlayerCar(physics, null, { spec: { ...CAR_SPEC, params: { ...CAR_SPEC.params, ...change } } });
      car.resetTo(0, 1, kmh * KMH);
      const course = () => car.yaw + Math.atan2(car.vLat, Math.max(1, car.vLong));
      const d0 = car.d;
      let slipMax = 0;
      for (let i = 0; i < Math.round(1 / PHYSICS_DT); i++) {
        car.prePhysics({ throttle: 0, brake: 1, steer: 1 }, PHYSICS_DT);
        physics.step(() => {});
        car.postPhysics();
        slipMax = Math.max(slipMax, Math.abs(Math.atan2(car.vLat, Math.max(1, Math.abs(car.vLong)))));
      }
      const v = Math.hypot(car.vLong, car.vLat) / KMH;
      row.push(
        `${kmh}: turned ${(Math.abs(course()) * 57.3).toFixed(0)}°, sideways ${Math.abs(car.d - d0).toFixed(1)} m, ` +
          `${v.toFixed(0)} km/h left, slip ${(slipMax * 57.3).toFixed(0)}°${slipMax > 0.35 ? ' SPUN' : ''}`,
      );
      physics.free();
    }
    out.push(`${name.padEnd(8)} ${row.join(' | ')}`);
  }
  process.stdout.write(out.join('\n') + '\n');
});

/** Speeds (km/h) to test at: KMHS=100,150,200 or the test's own. */
function speeds(own: number[]): number[] {
  return process.env.KMHS ? process.env.KMHS.split(',').map(Number) : own;
}
