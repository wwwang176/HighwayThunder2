import { describe, it, expect } from 'vitest';
import { idmAccel, EMERGENCY_DECEL } from '../src/traffic/idm';
import { mobilIncentive, mobilSafe } from '../src/traffic/mobil';

const P = { v0: 30, T: 1.3, s0: 2.5, a: 2, b: 2.5 };

describe('idmAccel', () => {
  it('free road from standstill gives max accel', () => {
    expect(idmAccel(0, null, 0, P)).toBeCloseTo(2);
  });
  it('at desired speed with no leader is ~0', () => {
    expect(Math.abs(idmAccel(30, null, 0, P))).toBeLessThan(1e-9);
  });
  it('stationary obstacle close ahead clamps to emergency decel', () => {
    expect(idmAccel(30, 10, 30, P)).toBe(-EMERGENCY_DECEL);
    expect(EMERGENCY_DECEL).toBe(9);
  });
  it('very large gap at same speed approaches free accel', () => {
    expect(idmAccel(20, 5000, 0, P)).toBeCloseTo(idmAccel(20, null, 0, P), 2);
  });
  it('never exceeds a', () => {
    expect(idmAccel(0, 1000, -20, P)).toBeLessThanOrEqual(2);
  });
  it('zero or negative gap is emergency', () => {
    expect(idmAccel(10, 0, 0, P)).toBe(-EMERGENCY_DECEL);
    expect(idmAccel(10, -1, 0, P)).toBe(-EMERGENCY_DECEL);
  });
});

describe('MOBIL', () => {
  it('safety', () => {
    expect(mobilSafe(-5)).toBe(false);
    expect(mobilSafe(-3)).toBe(true);
    expect(mobilSafe(-4.5, 5)).toBe(true);
  });
  it('incentive combines own gain, politeness-weighted follower changes and bias', () => {
    const v = mobilIncentive({
      selfNew: 1.0,
      selfOld: -1.0,
      newFollowerNew: -0.5,
      newFollowerOld: 0.5,
      oldFollowerNew: 0.4,
      oldFollowerOld: 0.0,
      politeness: 0.5,
      bias: 0.2,
    });
    // 2 + 0.5 * (-1 + 0.4) + 0.2 = 1.9
    expect(v).toBeCloseTo(1.9);
  });
});
