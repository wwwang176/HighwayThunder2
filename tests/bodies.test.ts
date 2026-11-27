import { describe, it, expect } from 'vitest';
import { depthInto, reachAlong } from '../src/ai/bodies';
import type { TrafficBox } from '../src/ai/sensors';

/** A car's body turned `yaw` off the road with its centre at (s, d): its box (the road-square one round it) and its body. */
const car = (s: number, d: number, yaw: number, hl = 2.2, hw = 0.95): TrafficBox => {
  const c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw));
  const hd = hw * c + hl * sn, hs = hl * c + hw * sn;
  return { s, dMin: d - hd, dMax: d + hd, length: 2 * hs, v: 0, body: { yaw, halfLength: hl, halfWidth: hw } };
};

describe('reachAlong: how far a body goes straight down the road before it touches another', () => {
  const HL = 2.2, HW = 0.93;

  it('a car straight ahead: the bumper gap', () => {
    expect(reachAlong(0, 0, 0, HL, HW, car(2.2 + 10 + 2.2, 0.5, 0), 0)).toBeCloseTo(10, 6);
  });

  it('beside it, or past it: never', () => {
    expect(reachAlong(0, 0, 0, HL, HW, car(10, 2.0, 0), 0)).toBe(Infinity);
    expect(reachAlong(0, 0, 0, HL, HW, car(-6, 0, 0), 0)).toBe(Infinity);
  });

  it('into it already: not more than nothing', () => {
    expect(reachAlong(0, 0, 0, HL, HW, car(4, 0.3, 0), 0)).toBeLessThanOrEqual(0);
  });

  it('a car turned across the lane: where its body is, not its box (that reaches back further)', () => {
    const b = car(20, 2.5, Math.PI / 3);
    const got = reachAlong(0, -0.3, 0, HL, HW, b, 0);
    // (moved on a cm at a time until the bodies overlap)
    let x = 0;
    while (depthInto(x, -0.3, 0, HL, HW, b, 0) <= 0) x += 0.01;
    expect(got).toBeGreaterThan(x - 0.02);
    expect(got).toBeLessThanOrEqual(x + 1e-9);
    const boxGap = b.s - b.length / 2 - HL;
    expect(got).toBeGreaterThan(boxGap + 0.5);
  });

  it('turned itself: by its own corners', () => {
    // nose 30 deg off toward +d, a car straight ahead: its front's +d corner leads
    const b = car(15, 0, 0);
    let x = 0;
    while (depthInto(x, 0, Math.PI / 6, HL, HW, b, 0) <= 0) x += 0.01;
    const got = reachAlong(0, 0, Math.PI / 6, HL, HW, b, 0);
    expect(got).toBeGreaterThan(x - 0.02);
    expect(got).toBeLessThanOrEqual(x + 1e-9);
  });

  it('where the other is at time t (its speed)', () => {
    const b = { ...car(2.2 + 10 + 2.2, 0, 0), v: 5 };
    expect(reachAlong(0, 0, 0, HL, HW, b, 2)).toBeCloseTo(20, 6);
  });
});
