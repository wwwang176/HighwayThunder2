export interface HandlingParams {
  accel: number; // peak forward accel (m/s^2)
  maxSpeed: number; // m/s
  brake: number; // m/s^2
  reverseMax: number; // m/s
  coast: number; // rolling decel (m/s^2)
  grip: number; // lateral slip decay rate (1/s)
  stunGrip: number; // lateral slip decay while stunned
  latAccelMax: number; // caps yaw rate at speed: yawRate <= latAccelMax / v
  maxYawRate: number; // rad/s at low speed
  steerRise: number; // steer input ramp (1/s)
  steerFall: number; // steer return-to-center rate (1/s)
  headingAssist: number; // auto-straighten gain (1/s) when steering released
  yawResponse: number; // how fast yaw rate follows target (1/s)
}

export const DEFAULT_HANDLING: HandlingParams = {
  accel: 10,
  maxSpeed: 83.3,
  brake: 24,
  reverseMax: 8,
  coast: 1.5,
  grip: 40,
  stunGrip: 1.0,
  latAccelMax: 16,
  maxYawRate: 1.6,
  steerRise: 5,
  steerFall: 9,
  headingAssist: 3.5,
  yawResponse: 14,
};

export interface HandlingState {
  vLong: number; // forward speed along heading (m/s)
  vLat: number; // sideways speed, + = right
  yaw: number; // heading relative to road, + = right
  yawRate: number;
  steer: number; // smoothed steer -1..1
  stun: number; // seconds of post-impact loss of control left
}

export interface HandlingInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
}

function approach(cur: number, target: number, rate: number): number {
  if (cur < target) return Math.min(target, cur + rate);
  return Math.max(target, cur - rate);
}

/** Arcade handling: returns the new velocities the body should have after this step. */
export function stepHandling(
  st: HandlingState,
  input: HandlingInput,
  p: HandlingParams,
  dt: number,
): { vLong: number; vLat: number; yawRate: number; steer: number } {
  const stunned = st.stun > 0;
  const control = stunned ? 0.3 : 1;

  // Steering input smoothing (faster return to center).
  const returning = input.steer === 0 || Math.sign(input.steer) !== Math.sign(st.steer);
  const steer = approach(st.steer, input.steer, (returning ? p.steerFall : p.steerRise) * dt);

  // Longitudinal.
  let v = st.vLong;
  if (input.brake > 0 && v > 0.5) {
    v = Math.max(0, v - p.brake * input.brake * dt);
  } else if (input.brake > 0) {
    const r = Math.min(1, Math.abs(Math.min(v, 0)) / p.reverseMax);
    v -= p.accel * 0.5 * input.brake * (1 - r * r) * dt;
    v = Math.max(-p.reverseMax, v);
  } else if (input.throttle > 0) {
    if (v < 0) {
      v = Math.min(0, v + p.brake * input.throttle * dt);
    } else {
      const r = Math.min(1, v / p.maxSpeed);
      v += p.accel * input.throttle * control * (1 - r * r) * dt;
    }
  } else if (v !== 0) {
    v = Math.sign(v) * Math.max(0, Math.abs(v) - p.coast * dt);
  }
  v = Math.min(p.maxSpeed, v);

  // Lateral grip.
  const grip = stunned ? p.stunGrip : p.grip;
  const vLat = st.vLat * Math.exp(-grip * dt);

  // Yaw.
  const speed = Math.abs(v);
  const limit = Math.min(p.maxYawRate, p.latAccelMax / Math.max(speed, 1));
  const speedFactor = Math.min(1, speed / 5);
  const dir = v >= 0 ? 1 : -1;
  let target = steer * limit * speedFactor * dir * control;
  if (input.steer === 0 && !stunned && Math.abs(st.yaw) < 0.6 && v > 3) {
    target += -p.headingAssist * st.yaw;
  }
  target = Math.max(-limit, Math.min(limit, target));
  const response = stunned ? 1.5 : p.yawResponse;
  const yawRate = st.yawRate + (target - st.yawRate) * (1 - Math.exp(-response * dt));

  return { vLong: v, vLat, yawRate, steer };
}
