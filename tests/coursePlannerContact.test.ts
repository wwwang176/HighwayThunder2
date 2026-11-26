import { describe, it, expect } from 'vitest';
import { coursePlan, COURSE_STATS } from '../src/ai/coursePlanner';
import type { TrafficBox } from '../src/ai/sensors';

/**
 * Two cars standing close (a racer's or a police car's, after a knock): neither planned anywhere, both stood there -
 * the other's box its AABB (wider than its body turned), or the two touching already.
 */
describe('coursePlan beside a car it is close to, turned', () => {
  const W = 1.86, L = 4.4;
  /** A car turned `yaw` off the road with its centre at (s, d): its box (its AABB) and its body. */
  const car = (s: number, d: number, yaw: number): TrafficBox => {
    const c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw));
    const hd = (W / 2) * c + (L / 2) * sn, hs = (L / 2) * c + (W / 2) * sn;
    return { s, dMin: d - hd, dMax: d + hd, length: 2 * hs, v: 0, id: 7, body: { yaw, halfLength: L / 2, halfWidth: W / 2 } };
  };
  /** Beside the ego (at 0, 0, turned `yaw` as it is), `gap` m between their sides (-: into it). */
  const beside = (yaw: number, gap: number) => car(-(W + gap) * Math.sin(yaw), (W + gap) * Math.cos(yaw), yaw);
  const plan = (yaw: number, b: TrafficBox) => {
    COURSE_STATS.fallback = 0;
    const p = coursePlan({ s: 0, d: 0, v: 0, speedCap: 30, halfWidth: W / 2, halfLength: L / 2, yaw }, [b], null);
    return { end: p.points[p.points.length - 1], fallback: COURSE_STATS.fallback };
  };

  it('both turned 10-30 deg, a hand apart: by its body, not its box (that reached over the ego), on its way', () => {
    for (const deg of [10, 20, 30]) {
      const y = (deg * Math.PI) / 180;
      const { end, fallback } = plan(y, beside(y, 0.05));
      expect(fallback).toBe(0);
      expect(end.s).toBeGreaterThan(50);
    }
  });

  it('touching it already (a few cm into it): planned out of it, not stood still', () => {
    for (const deg of [0, 15]) {
      const y = (deg * Math.PI) / 180;
      const { end, fallback } = plan(y, beside(y, -0.05));
      expect(fallback).toBe(0);
      expect(end.s).toBeGreaterThan(50);
    }
  });

  it('but never further into it: a car right across its way still stops it', () => {
    // (standing nose against its side: anything forward goes into it - no way out but back, which it does not plan)
    const b = car(L / 2 + W / 2 - 0.05, 0, Math.PI / 2);
    const { end } = plan(0, b);
    expect(end.s).toBeLessThan(0.5);
  });
});
