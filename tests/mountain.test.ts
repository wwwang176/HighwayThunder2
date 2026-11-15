import { describe, it, expect } from 'vitest';
import { bend, Centerline, straight } from '../src/road/centerline';
import { keepOverRoad, MOUNTAIN, mountainRoad, roadEdges, wallShare, wallSide, wallSides } from '../src/road/mountain';
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

  it('its hairpins and tight bends banked into them (MOUNTAIN.bank), eased in over MOUNTAIN.bank.ease m, flat off the grid', () => {
    for (const r of roads.slice(0, 10)) {
      let steepest = 0;
      let fastest = 0;
      for (let s = 0; s <= r.length; s += 1) {
        const slope = r.crossSlope(s);
        if (Math.abs(r.curvature(s)) >= MOUNTAIN.bank.full) expect(Math.sign(slope)).toBe(-Math.sign(r.curvature(s))); // (the inside lower)
        steepest = Math.max(steepest, Math.abs(slope));
        fastest = Math.max(fastest, Math.abs(r.crossSlope(s + 1) - slope));
      }
      expect(steepest).toBeCloseTo(Math.tan(MOUNTAIN.bank.max), 6); // (its hairpins tighter than `full`, long enough)
      expect(fastest).toBeLessThanOrEqual((2 * Math.tan(MOUNTAIN.bank.max)) / MOUNTAIN.bank.ease + 1e-9);
      expect(r.crossSlope(10)).toBe(0); // (the grid level and flat)
    }
  });

  it('is the same road for the same seed', () => {
    const a = mountainRoad(mulberry32(7));
    const b = mountainRoad(mulberry32(7));
    expect(a.pieces).toEqual(b.pieces);
    expect(a.height(2000)).toBe(b.height(2000));
  });
});

describe('keepOverRoad', () => {
  const road = new Centerline([...straight(100), ...bend(30, 90, 10), ...straight(100)], { turnBack: true, grades: [{ len: 1, g: 0.05 }, { len: 300, g: 0.05 }] });

  it('a point over the road between its sides is left where it is', () => {
    const w = road.toWorld(50, 2);
    const p = { x: w.x, y: road.height(50) + 3, z: w.z };
    expect(keepOverRoad(road, p, 50, 4, 0.8)).toBe(false);
    expect(p).toEqual({ x: w.x, y: road.height(50) + 3, z: w.z });
  });

  it('one past a side (in the rock) is brought in to it, as high', () => {
    const w = road.toWorld(120, 9);
    const p = { x: w.x, y: road.height(120) + 3, z: w.z };
    expect(keepOverRoad(road, p, 118, 4, 0.8)).toBe(true);
    const at = road.project(p.x, p.z, 120);
    expect(at.d).toBeCloseTo(4, 3);
    expect(p.y).toBeCloseTo(road.height(120) + 3, 6);
  });

  it('each side\'s room its own at s (a shoulder): over it left be, past the other side brought in', () => {
    const room = (s: number, side: 1 | -1) => (side < 0 && s > 100 ? 7 : 4);
    const w = road.toWorld(120, -6);
    const p = { x: w.x, y: road.height(120) + 3, z: w.z };
    expect(keepOverRoad(road, p, 118, room, 0.8)).toBe(false);
    const w2 = road.toWorld(120, 6);
    const p2 = { x: w2.x, y: road.height(120) + 3, z: w2.z };
    expect(keepOverRoad(road, p2, 118, room, 0.8)).toBe(true);
    expect(road.project(p2.x, p2.z, 120).d).toBeCloseTo(4, 3);
  });

  it('one under the road is lifted over it', () => {
    const w = road.toWorld(150, -1);
    const p = { x: w.x, y: road.height(150) - 2, z: w.z };
    expect(keepOverRoad(road, p, 150, 4, 0.8)).toBe(true);
    expect(p.y).toBeCloseTo(road.height(150) + 0.8, 6);
  });
});

describe('wallSides', () => {
  it('is wallSide at every row, all at once (but where two bends are as near, to a row)', () => {
    for (const road of roads.slice(0, 5)) {
      const ss: number[] = [];
      for (let s = -100; s <= road.length + 300; s += 3.7) ss.push(s);
      const sides = wallSides(road, ss);
      const differ = ss.filter((s, i) => sides[i] !== wallSide(road, s)).length;
      expect(differ).toBeLessThanOrEqual(ss.length * 0.01);
    }
  });
});

describe('wallShare', () => {
  const ss = [0, 5, 10, 15, 20, 25];
  const sides = Int8Array.from([1, 1, 1, -1, -1, -1]);
  it('all of the wall along its side\'s run, past it on down to none over `taper` m: where it changes sides both walls there, no gap', () => {
    expect(Array.from(wallShare(ss, sides, 1, 10))).toEqual([1, 1, 1, 0.5, 0, 0]);
    expect(Array.from(wallShare(ss, sides, -1, 10))).toEqual([0, 0, 0.5, 1, 1, 1]);
    for (let i = 0; i < ss.length; i++) expect(wallShare(ss, sides, 1, 10)[i] + wallShare(ss, sides, -1, 10)[i]).toBeGreaterThanOrEqual(1);
  });
  it('a side with no run: none of it', () => {
    expect(Array.from(wallShare(ss, Int8Array.from([1, 1, 1, 1, 1, 1]), -1, 10))).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('wallSide', () => {
  it('the rock wall is on the inside of a bend: +d (right) on a right bend, -d on a left one', () => {
    const road = new Centerline([...straight(100), ...bend(40, 90, 20), ...straight(100), ...bend(40, -90, 20), ...straight(100)], { turnBack: true });
    expect(wallSide(road, 100 + 30)).toBe(1);
    expect(wallSide(road, 100 + 20 + 62.8 + 100 + 30)).toBe(-1);
  });
});

describe('roadEdges (the bends wider, a shoulder on a tight bend\'s outside)', () => {
  const M = MOUNTAIN;
  /** A right hairpin (R 20) between straights. */
  const hairpin = new Centerline([...straight(150), ...bend(20, 180, 10), ...straight(150)], { turnBack: true });
  const mid = 150 + 5 + 10 * Math.PI; // (its middle)
  /** The shoulder alone (past the bend's widening). */
  const shoulder = (e: ReturnType<typeof roadEdges>, s: number, side: 1 | -1) => e.at(s, side) - M.edge - e.widen(s);

  it('a bend MOUNTAIN.widen.by wider either side (every bend from R 150), a straight as it was', () => {
    const e = roadEdges(hairpin);
    expect(e.widen(mid)).toBeCloseTo(M.widen.by, 2);
    expect(e.at(mid, 1)).toBeCloseTo(M.edge + M.widen.by, 2); // (its inside: the widening only)
    for (const s of [0, 60, hairpin.length - 60]) expect(e.widen(s)).toBe(0);
    const gentle = roadEdges(new Centerline([...straight(100), ...bend(150, 90, 10), ...straight(100)], { turnBack: true }));
    expect(gentle.widen(100 + 5 + (150 * 45 * Math.PI) / 180)).toBeCloseTo(M.widen.by, 2);
    const softer = roadEdges(new Centerline([...straight(100), ...bend(300, 60, 10), ...straight(100)], { turnBack: true }));
    expect(softer.widen(100 + 5 + (300 * 30 * Math.PI) / 180)).toBeCloseTo(M.widen.by / 2, 2);
  });

  it('a hairpin\'s outside (left of a right turn) MOUNTAIN.shoulder.max more in its middle; its inside none', () => {
    const e = roadEdges(hairpin);
    expect(shoulder(e, mid, -1)).toBeCloseTo(M.shoulder.max, 2);
    expect(shoulder(e, mid, 1)).toBeCloseTo(0, 9);
    const left = roadEdges(new Centerline([...straight(150), ...bend(20, -180, 10), ...straight(150)], { turnBack: true }));
    expect(shoulder(left, mid, 1)).toBeCloseTo(M.shoulder.max, 2);
    expect(shoulder(left, mid, -1)).toBeCloseTo(0, 9);
  });

  it('no shoulder on a straight, nor on a bend gentler than its from; less in proportion up to its full', () => {
    const e = roadEdges(hairpin);
    for (const s of [0, 60, hairpin.length - 60]) for (const side of [1, -1] as const) expect(e.at(s, side)).toBe(M.edge);
    const gentle = roadEdges(new Centerline([...straight(100), ...bend(1 / M.shoulder.from + 10, 90, 10), ...straight(100)], { turnBack: true }));
    for (let s = 0; s < 300; s += 5) expect(shoulder(gentle, s, -1)).toBeCloseTo(0, 9);
    const r = 2 / (M.shoulder.from + M.shoulder.full); // (halfway in curvature)
    const half = roadEdges(new Centerline([...straight(100), ...bend(r, 160, 10), ...straight(100)], { turnBack: true }));
    expect(shoulder(half, 100 + 5 + (r * 80 * Math.PI) / 180, -1)).toBeCloseTo(M.shoulder.max / 2, 1);
  });

  it('eased in and out: its width changing no faster than (widen + shoulder) / ease a metre, and the same edges for the same road', () => {
    const rate = M.widen.by / M.widen.ease + M.shoulder.max / M.shoulder.ease + 1e-9;
    for (const r of roads.slice(0, 10)) {
      const e = roadEdges(r);
      expect(roadEdges(r)).toBe(e);
      for (const side of [1, -1] as const) {
        for (let s = -M.before; s < r.length + M.after - 1; s += 1) {
          expect(Math.abs(e.at(s + 1, side) - e.at(s, side))).toBeLessThanOrEqual(rate);
          expect(e.at(s, side)).toBeGreaterThanOrEqual(M.edge);
        }
      }
      expect(e.at(10, 1)).toBe(M.edge); // (the grid as it was)
    }
  });
});
