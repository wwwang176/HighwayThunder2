import { describe, it, expect } from 'vitest';
import { bend, Centerline, randomRoad, RANDOM_ROAD, straight, STRAIGHT_ROAD } from '../src/road/centerline';
import { mulberry32 } from '../src/ai/rng';

const RIGHT = new Centerline([...straight(100), ...bend(2000, 30, 200), ...straight(100)]);

describe('centerline', () => {
  it('straight: the old conversions exactly (s = -z, d = x)', () => {
    for (const [s, d] of [[0, 0], [123.456, -7.5], [-50, 3], [5000, 10]]) {
      expect(STRAIGHT_ROAD.toWorld(s, d)).toEqual({ x: d, z: s === 0 ? 0 : -s });
      expect(STRAIGHT_ROAD.project(d, -s)).toEqual({ s, d });
    }
    expect(STRAIGHT_ROAD.heading(1234)).toBe(0);
    expect(STRAIGHT_ROAD.curvature(1234)).toBe(0);
  });

  it('a bend turns by its angle; its clothoids ramp the curvature', () => {
    expect(RIGHT.heading(RIGHT.length)).toBeCloseTo((30 * Math.PI) / 180, 12);
    expect(RIGHT.curvature(100)).toBe(0);
    expect(RIGHT.curvature(200)).toBeCloseTo(1 / 2000 / 2, 12);
    expect(RIGHT.curvature(300)).toBeCloseTo(1 / 2000, 12);
    expect(RIGHT.length).toBeCloseTo(100 + 2000 * (Math.PI / 6) + 200 + 100, 9);
    expect(RIGHT.minRadius).toBeCloseTo(2000, 9);
  });

  it('heading is the curvature integrated (dθ/ds = κ)', () => {
    for (const s of [150, 250, 600, 1100, 1180]) {
      const h = 1e-3;
      expect((RIGHT.heading(s + h) - RIGHT.heading(s - h)) / (2 * h)).toBeCloseTo(RIGHT.curvature(s), 8);
    }
  });

  it('the line moves along its heading at unit speed', () => {
    for (const s of [0.5, 150, 333.3, 800, 1200]) {
      const h = 1e-3;
      const a = RIGHT.center(s - h);
      const b = RIGHT.center(s + h);
      const th = RIGHT.heading(s);
      expect((b.x - a.x) / (2 * h)).toBeCloseTo(Math.sin(th), 6);
      expect((b.z - a.z) / (2 * h)).toBeCloseTo(-Math.cos(th), 6);
    }
  });

  it('an arc keeps its radius: points on it as far from one centre', () => {
    // Right bend: the centre of curvature to the right (+d) of the line, R away.
    const s = 600;
    const c = RIGHT.toWorld(s, 2000);
    for (const t of [400, 500, 700, 900]) {
      const p = RIGHT.center(t);
      expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeCloseTo(2000, 3);
    }
  });

  it('positive curvature bends right (toward +x from -z)', () => {
    const end = RIGHT.center(RIGHT.length);
    expect(end.x).toBeGreaterThan(0);
  });

  it('project inverts toWorld, with and without a hint', () => {
    for (const s of [-30, 0, 50, 180, 640, 1000, RIGHT.length + 80]) {
      for (const d of [-40, -7.5, 0, 3.2, 10]) {
        const w = RIGHT.toWorld(s, d);
        const r = RIGHT.project(w.x, w.z);
        expect(r.s).toBeCloseTo(s, 6);
        expect(r.d).toBeCloseTo(d, 6);
        const h = RIGHT.project(w.x, w.z, s + 7);
        expect(h.s).toBeCloseTo(s, 6);
        expect(h.d).toBeCloseTo(d, 6);
      }
    }
  });

  it('forwardWorld turns a road-relative yaw by the road heading', () => {
    const s = 700;
    const f = RIGHT.forwardWorld(0, s);
    const th = RIGHT.heading(s);
    expect(f.x).toBeCloseTo(Math.sin(th), 12);
    expect(f.z).toBeCloseTo(-Math.cos(th), 12);
  });
});

describe('randomRoad', () => {
  it('straight at both ends, its bends within the radii, its heading within bounds', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const road = randomRoad(mulberry32(seed), 5000);
      expect(road.length).toBeLessThanOrEqual(5000 - RANDOM_ROAD.endStraight + 1e-6);
      for (let s = 0; s < RANDOM_ROAD.startStraight; s += 10) expect(road.curvature(s)).toBe(0);
      expect(road.curvature(5000 - RANDOM_ROAD.endStraight + 1)).toBe(0);
      if (!road.straight) {
        expect(road.minRadius).toBeGreaterThanOrEqual(RANDOM_ROAD.radius[0] - 1e-6);
        expect(road.minRadius).toBeLessThanOrEqual(RANDOM_ROAD.radius[1] + 1e-6);
      }
      for (let s = 0; s <= 5000; s += 25) expect(Math.abs(road.heading(s))).toBeLessThanOrEqual(((RANDOM_ROAD.maxHeading + 1e-6) * Math.PI) / 180);
    }
  });

  it('has bends (not all straight)', () => {
    let bent = 0;
    for (let seed = 1; seed <= 20; seed++) if (!randomRoad(mulberry32(seed), 5000).straight) bent++;
    expect(bent).toBe(20);
  });
});
