import { describe, it, expect } from 'vitest';
import { wrapAngle, approachAngle, reverseView, cameraTargetYaw } from '../src/render/cameraRig';

describe('camera helpers', () => {
  it('wrapAngle keeps angles in (-π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI / 2)).toBeCloseTo(Math.PI / 2);
  });
  it('approachAngle takes the short way round', () => {
    const a = approachAngle(3.0, -3.0, 0.5); // -3.0 is just past π from 3.0
    expect(a).toBeGreaterThan(3.0);
  });
  it('approachAngle converges to the target', () => {
    let a = 0;
    for (let i = 0; i < 200; i++) a = approachAngle(a, 1, 0.1);
    expect(a).toBeCloseTo(1, 3);
  });
  it('reverse view switches with hysteresis', () => {
    expect(reverseView(false, -0.5)).toBe(false);
    expect(reverseView(false, -1.5)).toBe(true);
    expect(reverseView(true, 0.2)).toBe(true);
    expect(reverseView(true, 1.5)).toBe(false);
  });
  it('follows the direction of travel, not the nose or the road', () => {
    // Car pointing straight down the road but sliding to the right at speed.
    const yaw = cameraTargetYaw(0, 10, -20, false);
    expect(yaw).toBeCloseTo(Math.atan2(10, 20));
    // Reversing at speed: camera looks the way the car moves (backwards).
    expect(Math.abs(wrapAngle(cameraTargetYaw(0, 0, 5, true) - Math.PI))).toBeLessThan(1e-9);
  });
  it('uses the car heading when (almost) stopped', () => {
    expect(cameraTargetYaw(0.3, 0, 0, false)).toBeCloseTo(0.3);
    expect(cameraTargetYaw(0.3, 0, 0, true)).toBeCloseTo(0.3 + Math.PI);
  });
});
