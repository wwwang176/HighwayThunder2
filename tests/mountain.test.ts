import { describe, it, expect } from 'vitest';
import { bend, Centerline, straight } from '../src/road/centerline';
import { MOUNTAIN, mountainRoad, wallSide } from '../src/road/mountain';
import { mulberry32 } from '../src/ai/rng';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const roads = SEEDS.map((seed) => mountainRoad(mulberry32(seed)));

/** Its bends (each three pieces: easing in at k, the arc at k, easing out to 0): radius and turn (degrees). */
function bends(road: Centerline): { r: number; turn: number }[] {
  const out: { r: number; turn: number }[] = [];
  const p = road.pieces;
  for (let i = 1; i + 1 < p.length; i++) {
    if (p[i].k !== 0 && p[i - 1].k === p[i].k && p[i + 1].k === 0) {
      out.push({ r: 1 / Math.abs(p[i].k), turn: (Math.abs(p[i].k) * (p[i - 1].len + p[i].len) * 180) / Math.PI });
    }
  }
  return out;
}

describe('mountainRoad', () => {
  it('is the course length', () => {
    for (const r of roads) expect(r.length).toBeCloseTo(MOUNTAIN.length, 0);
  });

  it('has hairpins (R 15-25 turning 150° or more), none tighter than R 15', () => {
    for (const r of roads) {
      const pins = bends(r).filter((b) => b.r <= MOUNTAIN.hairpinR[1] + 1e-6 && b.turn >= 150 - 1e-6);
      expect(pins.length).toBeGreaterThanOrEqual(2);
      expect(r.minRadius).toBeGreaterThanOrEqual(MOUNTAIN.hairpinR[0] - 1e-6);
    }
  });

  it('never comes near itself: parts more than sepArc apart along it are minSep apart or more', () => {
    for (const r of roads) {
      const pts: { s: number; x: number; z: number }[] = [];
      for (let s = -100; s <= r.length + 300; s += 5) pts.push({ s, ...r.toWorld(s, 0) });
      let worst = Infinity;
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) {
          if (pts[j].s - pts[i].s <= MOUNTAIN.sepArc) continue;
          worst = Math.min(worst, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
        }
      expect(worst).toBeGreaterThanOrEqual(MOUNTAIN.minSep);
    }
  });

  it('starts and ends straight and level, at height 0 at the start', () => {
    for (const r of roads) {
      for (let s = 0; s <= MOUNTAIN.startStraight; s += 5) {
        expect(r.curvature(s)).toBe(0);
        expect(r.grade(s)).toBe(0);
        expect(r.height(s)).toBe(0);
      }
      for (let s = r.length - MOUNTAIN.endStraight + 1; s <= r.length; s += 5) {
        expect(r.curvature(s)).toBe(0);
        expect(Math.abs(r.grade(s))).toBeLessThan(1e-9);
      }
    }
  });

  it('climbs and falls within the grade limit, both ways', () => {
    for (const r of roads) {
      let up = false;
      let down = false;
      for (let s = 0; s <= r.length; s += 2) {
        const g = r.grade(s);
        expect(Math.abs(g)).toBeLessThanOrEqual(MOUNTAIN.grade[1] + 1e-9);
        if (g > 0.03) up = true;
        if (g < -0.03) down = true;
      }
      expect(up && down).toBe(true);
    }
  });

  it('is the same road for the same seed', () => {
    const a = mountainRoad(mulberry32(7));
    const b = mountainRoad(mulberry32(7));
    expect(a.pieces).toEqual(b.pieces);
    expect(a.height(2000)).toBe(b.height(2000));
  });
});

describe('wallSide', () => {
  it('the rock wall is on the inside of a bend: +d (right) on a right bend, -d on a left one', () => {
    const road = new Centerline([...straight(100), ...bend(40, 90, 20), ...straight(100), ...bend(40, -90, 20), ...straight(100)], { turnBack: true });
    expect(wallSide(road, 100 + 30)).toBe(1);
    expect(wallSide(road, 100 + 20 + 62.8 + 100 + 30)).toBe(-1);
  });
});
