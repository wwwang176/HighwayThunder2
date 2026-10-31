import { describe, it, expect } from 'vitest';
import { stepHandling, DEFAULT_HANDLING, HandlingState } from '../src/vehicles/handling';

const dt = 1 / 120;
const fresh = (): HandlingState => ({ vLong: 0, vLat: 0, yaw: 0, yawRate: 0, steer: 0, stun: 0 });

function run(st: HandlingState, input: { throttle: number; brake: number; steer: number }, sec: number) {
  const n = Math.round(sec / dt);
  for (let i = 0; i < n; i++) {
    const r = stepHandling(st, input, DEFAULT_HANDLING, dt);
    st = { ...st, ...r, yaw: st.yaw + r.yawRate * dt, stun: Math.max(0, st.stun - dt) };
  }
  return st;
}

describe('stepHandling', () => {
  it('accelerates well and never exceeds max speed', () => {
    let st = run(fresh(), { throttle: 1, brake: 0, steer: 0 }, 5);
    expect(st.vLong).toBeGreaterThan(27);
    st = run(st, { throttle: 1, brake: 0, steer: 0 }, 60);
    expect(st.vLong).toBeLessThanOrEqual(DEFAULT_HANDLING.maxSpeed + 1e-6);
    expect(st.vLong).toBeGreaterThan(DEFAULT_HANDLING.maxSpeed * 0.95);
  });

  it('yaw rate at 300 km/h is limited by lateral accel', () => {
    let st: HandlingState = { ...fresh(), vLong: 83.3 };
    st = run(st, { throttle: 1, brake: 0, steer: 1 }, 0.4);
    expect(Math.abs(st.yawRate)).toBeLessThanOrEqual(DEFAULT_HANDLING.latAccelMax / 83 + 1e-6);
    expect(st.yawRate).toBeGreaterThan(0);
  });

  it('heading returns toward road direction when steering is released', () => {
    let st: HandlingState = { ...fresh(), vLong: 60, yaw: 0.2 };
    st = run(st, { throttle: 0.5, brake: 0, steer: 0 }, 2);
    expect(Math.abs(st.yaw)).toBeLessThan(0.03);
  });

  it('lateral slip decays', () => {
    let st: HandlingState = { ...fresh(), vLong: 40, vLat: 5 };
    st = run(st, { throttle: 0, brake: 0, steer: 0 }, 0.5);
    expect(Math.abs(st.vLat)).toBeLessThan(0.5);
  });

  it('stun keeps slip much longer', () => {
    let st: HandlingState = { ...fresh(), vLong: 40, vLat: 5, stun: 1 };
    st = run(st, { throttle: 0, brake: 0, steer: 0 }, 0.3);
    expect(Math.abs(st.vLat)).toBeGreaterThan(2);
  });

  it('brakes then reverses with limited speed', () => {
    let st: HandlingState = { ...fresh(), vLong: 30 };
    st = run(st, { throttle: 0, brake: 1, steer: 0 }, 2);
    expect(st.vLong).toBeLessThan(1);
    st = run(st, { throttle: 0, brake: 1, steer: 0 }, 10);
    expect(st.vLong).toBeLessThan(0);
    expect(st.vLong).toBeGreaterThanOrEqual(-DEFAULT_HANDLING.reverseMax - 1e-6);
  });

  it('no turning when stationary', () => {
    const st = run(fresh(), { throttle: 0, brake: 0, steer: 1 }, 1);
    expect(Math.abs(st.yaw)).toBeLessThan(1e-6);
  });
});
