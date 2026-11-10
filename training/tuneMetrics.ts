import * as THREE from 'three';
import { CARS } from '../src/vehicles/cars';
import { PlayerCar } from '../src/vehicles/playerCar';
import { KMH, PHYSICS_DT } from '../src/config';
import { laneCenter } from '../src/road/coords';
import { selfStateOf } from '../src/ai/driver';
import { baseSteer } from '../src/ai/netTracker';
import { PLANNER } from '../src/ai/planner';
import { NITRO } from '../src/vehicles/nitro';
import { tuned, type TuneCal, type Tuning } from '../src/vehicles/tuning';
import { movePlan } from './trackerEval';
import { openGround } from './openGround';

/**
 * The tuning's measurements (tuneMeasure.train.ts, tuneCalibrate.train.ts), each car on open ground -
 *   0-100 / 0-200 (s), 150 km/h to 85 % of its top speed (top, s), speed after 25 s flat out (km/h), the nose's
 *   lift launching (deg); 200-0 braking (m), its most body slip and nose dive (deg); km/h gained in 1.5 s with the
 *   throttle back on after a lift at 150 km/h (reaccel); the most slip braking hard turning at 150 km/h; the
 *   sideways grip at 150 / 250 km/h (m/s²); a full-lock flick at 200 km/h (m moved in 0.5 s, most slip, most lean);
 *   a lane change at 200 km/h by the plain tracker (s to within 0.2 m, overshoot, most slip, most lean, when it
 *   stays within 0.3 deg of level, its swings past that); the nitro from 150 km/h (km/h in 3 s, a tank's seconds).
 * initExams() first (trackerEval: CAR its planner's car).
 */
export type Metrics = Record<string, number>;

function car(specId: string, t: Tuning, cal: TuneCal) {
  const physics = openGround();
  physics.timestep = PHYSICS_DT;
  const spec = CARS[specId];
  const c = new PlayerCar(physics, null, { spec });
  Object.assign(c.params, tuned(spec.params, t, cal));
  const step = (input: { throttle: number; brake: number; steer: number; nitro?: boolean }) => {
    c.prePhysics(input, PHYSICS_DT);
    physics.step(() => {});
    c.postPhysics();
  };
  const hold = (lane = 1) => Math.max(-1, Math.min(1, -(c.d - laneCenter(lane)) * 0.05 - c.yaw)); // straight on
  const slipDeg = () => (Math.abs(Math.atan2(c.vLat, Math.max(1, c.vLong))) * 180) / Math.PI;
  // The body's lean (onto a side) and pitch (nose up or down), deg: what is seen of the springs.
  const q = new THREE.Quaternion(), v = new THREE.Vector3();
  const orient = () => {
    const r = c.body.rotation();
    q.set(r.x, r.y, r.z, r.w);
    const roll = Math.asin(Math.max(-1, Math.min(1, v.set(1, 0, 0).applyQuaternion(q).y)));
    const pitch = Math.asin(Math.max(-1, Math.min(1, v.set(0, 0, -1).applyQuaternion(q).y)));
    return { roll: (roll * 180) / Math.PI, pitch: (pitch * 180) / Math.PI };
  };
  return { physics, c, step, hold, slipDeg, orient };
}

/** The metrics of `specId` tuned `t` (with `cal`): all of them, or (`only`) just the blocks giving those named. */
export function measure(specId: string, t: Tuning, cal: TuneCal = {}, only: string[] | null = null): Metrics {
  const m: Metrics = {};
  const want = (...names: string[]) => !only || names.some((n) => only.includes(n));
  // Flat out from a standstill.
  if (want('t100', 't150', 't200', 'top', 'v25', 'launchPitch')) {
    const { physics, c, step, hold, orient } = car(specId, t, cal);
    c.resetTo(0, 1, 0);
    let time = 0;
    m.launchPitch = 0;
    m.t100 = m.t200 = NaN;
    let t150 = NaN, tHi = NaN;
    const hi = 0.85 * CARS[specId].params.maxSpeed; // (each car its own: 85 % of its stock top speed)
    // (asked only for the times: done once they are in)
    const timesOnly = only && !only.includes('v25') && !only.includes('launchPitch');
    while (time < 25) {
      if (timesOnly && !Number.isNaN(tHi) && !Number.isNaN(m.t200)) break;
      step({ throttle: 1, brake: 0, steer: hold() });
      time += PHYSICS_DT;
      if (time < 3) m.launchPitch = Math.max(m.launchPitch, Math.abs(orient().pitch));
      if (Number.isNaN(m.t100) && c.speed >= 100 * KMH) m.t100 = time;
      if (Number.isNaN(m.t200) && c.speed >= 200 * KMH) m.t200 = time;
      if (Number.isNaN(t150) && c.speed >= 150 * KMH) t150 = time;
      if (Number.isNaN(tHi) && c.speed >= hi) tHi = time;
    }
    m.t150 = t150;
    // The top end, 150 km/h to 85 % of its top speed (drag's); not getting there (a limiter under it): as if 5 s
    // past the run's end.
    m.top = (Number.isNaN(tHi) ? 30 : tHi) - t150;
    m.v25 = c.speed / KMH;
    physics.free();
  }
  // Its top speed: flat out for a minute from 150 km/h (the 25 s from a standstill may not get there).
  if (want('vTop')) {
    const { physics, c, step, hold } = car(specId, t, cal);
    c.resetTo(0, 1, 150 * KMH);
    let top = 0;
    for (let i = 0; i < 60 / PHYSICS_DT; i++) {
      step({ throttle: 1, brake: 0, steer: hold() });
      top = Math.max(top, c.speed);
    }
    m.vTop = top / KMH;
    physics.free();
  }
  // Braking from 200 km/h.
  if (want('brake200', 'brakeT', 'brakeSlip', 'brakePitch')) {
    const { physics, c, step, hold, slipDeg, orient } = car(specId, t, cal);
    c.resetTo(500, 1, 200 * KMH);
    const s0 = c.s;
    let slip = 0;
    m.brakePitch = 0;
    for (let i = 0; i < 8 / PHYSICS_DT && c.speed > 0.5; i++) {
      step({ throttle: 0, brake: 1, steer: hold() });
      slip = Math.max(slip, slipDeg());
      m.brakePitch = Math.max(m.brakePitch, Math.abs(orient().pitch));
    }
    m.brake200 = c.s - s0;
    m.brakeT = m.brake200 / ((200 * KMH) / 2); // (as time at its mean speed: a top end's seconds to weigh it against)
    m.brakeSlip = slip;
    physics.free();
  }
  // The throttle back on after a lift (the turbo's lag): coasting 1 s from 150 km/h, then flat out - km/h gained in
  // 1.5 s, and the s to 170 km/h.
  if (want('reaccel', 'reaccelT')) {
    const { physics, c, step, hold } = car(specId, t, cal);
    c.resetTo(0, 1, 150 * KMH);
    for (let i = 0; i < 1 / PHYSICS_DT; i++) step({ throttle: 0, brake: 0, steer: hold() });
    const v0 = c.speed;
    m.reaccelT = 6;
    for (let i = 0; i < 6 / PHYSICS_DT; i++) {
      step({ throttle: 1, brake: 0, steer: hold() });
      if (i === Math.round(1.5 / PHYSICS_DT) - 1) m.reaccel = (c.speed - v0) / KMH;
      if (c.speed >= 170 * KMH) {
        m.reaccelT = (i + 1) * PHYSICS_DT;
        if (i >= 1.5 / PHYSICS_DT) break;
      }
    }
    physics.free();
  }
  // Braking hard while turning at 150 km/h (a lane change braked): the most body slip.
  if (want('brakeTurnSlip')) {
    const { physics, c, step, slipDeg } = car(specId, t, cal);
    c.params.maxSpeed = 150 * KMH;
    c.resetTo(500, 1, 150 * KMH);
    for (let i = 0; i < 0.4 / PHYSICS_DT; i++) step({ throttle: 1, brake: 0, steer: 0.35 });
    let slip = 0;
    for (let i = 0; i < 1.5 / PHYSICS_DT && c.speed > 3; i++) {
      step({ throttle: 0, brake: 1, steer: 0.35 });
      slip = Math.max(slip, slipDeg());
    }
    m.brakeTurnSlip = slip;
    physics.free();
  }
  // Sideways grip, full steering, as measureCar does.
  for (const kmh of [150, 250]) {
    if (!want(`lat${kmh}`)) continue;
    const { physics, c, step } = car(specId, t, cal);
    c.params.maxSpeed = kmh * KMH;
    c.resetTo(0, 1, kmh * KMH);
    const course = () => c.yaw + Math.atan2(c.vLat, Math.max(1, c.vLong));
    const steps = Math.round(1.5 / PHYSICS_DT);
    let c0 = 0, speedSum = 0, n = 0;
    for (let i = 0; i < steps; i++) {
      step({ throttle: 1, brake: 0, steer: 1 });
      if (i === Math.round(steps / 2)) c0 = course();
      if (i > steps / 2) {
        speedSum += Math.hypot(c.vLong, c.vLat);
        n++;
      }
    }
    m[`lat${kmh}`] = (Math.abs(course() - c0) / (n * PHYSICS_DT)) * (speedSum / n);
    physics.free();
  }
  // A flick: full lock for 0.5 s at 200 km/h (the human's key).
  if (want('flick', 'flickSlip', 'flickRoll')) {
    const { physics, c, step, slipDeg, orient } = car(specId, t, cal);
    c.params.maxSpeed = 200 * KMH;
    c.resetTo(0, 1, 200 * KMH);
    const d0 = c.d;
    let slip = 0;
    m.flickRoll = 0;
    for (let i = 0; i < 0.5 / PHYSICS_DT; i++) {
      step({ throttle: 1, brake: 0, steer: 1 });
      slip = Math.max(slip, slipDeg());
      m.flickRoll = Math.max(m.flickRoll, Math.abs(orient().roll));
    }
    m.flick = c.d - d0;
    m.flickSlip = slip;
    physics.free();
  }
  // A lane change at 200 km/h, the plain tracker following a planner-shaped move (replanned every 0.25 s).
  if (want('lane', 'laneOver', 'laneSlip', 'laneRoll', 'laneSettle', 'laneSwings')) {
    const { physics, c, step, slipDeg, orient } = car(specId, t, cal);
    const cap = 200 * KMH;
    m.laneRoll = 0;
    let lastBig = 0, swings = 0, sign = 0;
    c.params.maxSpeed = cap;
    c.resetTo(0, 1, cap);
    const target = laneCenter(2);
    let plan = null as ReturnType<typeof movePlan> | null, madeAt = 0, time = 0, over = 0, slip = 0;
    m.lane = NaN;
    while (time < 5) {
      const self = selfStateOf(c, cap);
      if (!plan || time - madeAt >= PLANNER.step - 1e-9) {
        plan = movePlan(self.s, self.d, self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw), Math.max(5, self.vLong), target, cap);
        madeAt = time;
      }
      step({ throttle: 1, brake: 0, steer: baseSteer(plan, time - madeAt, self, c.params) });
      time += PHYSICS_DT;
      if (Number.isNaN(m.lane) && Math.abs(c.d - target) < 0.2) m.lane = time;
      if (!Number.isNaN(m.lane)) over = Math.max(over, c.d - target);
      slip = Math.max(slip, slipDeg());
      const roll = orient().roll;
      m.laneRoll = Math.max(m.laneRoll, Math.abs(roll));
      if (Math.abs(roll) > 0.3) {
        lastBig = time;
        if (Math.sign(roll) !== sign) {
          swings++;
          sign = Math.sign(roll);
        }
      }
    }
    m.laneSettle = lastBig;
    m.laneSwings = swings;
    m.laneOver = over;
    m.laneSlip = slip;
    physics.free();
  }
  // Nitro from 150 km/h: km/h gained in 3 s (the tank's own seconds aside).
  if (want('nitro3', 'nitroSecs')) {
    const { physics, c, step, hold } = car(specId, t, cal);
    c.resetTo(0, 1, 150 * KMH);
    const v0 = c.speed;
    for (let i = 0; i < 3 / PHYSICS_DT; i++) step({ throttle: 1, brake: 0, steer: hold(), nitro: true });
    m.nitro3 = (c.speed - v0) / KMH;
    m.nitroSecs = NITRO.burn * (tuned(CARS[specId].params, t, cal).nitroBurn ?? 1);
    physics.free();
  }
  return m;
}
