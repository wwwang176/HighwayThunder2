import { describe, it, expect } from 'vitest';
import { bend, Centerline, straight } from '../src/road/centerline';
import { insideReach, MOUNTAIN, mountainRoad, roadEdges } from '../src/road/mountain';
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

  it('a long strip (the player\'s: not wandering round past itself): all of it, past the finish too, within MOUNTAIN.fan of straight ahead', () => {
    for (const r of roads) {
      for (let s = 0; s <= r.length + MOUNTAIN.after; s += 5) {
        const p = r.toWorld(s, 0);
        if (Math.hypot(p.x, p.z) < MOUNTAIN.fan.from) continue;
        expect(-p.z).toBeGreaterThan(0);
        expect(Math.abs(Math.atan2(p.x, -p.z))).toBeLessThanOrEqual(MOUNTAIN.fan.half + 1e-9);
      }
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

  it('goes all one way, up or down (the player\'s: a mountain road climbs or descends), MOUNTAIN.climb.mean of its length in all, no grade past `most`', () => {
    let ups = 0;
    for (const r of roads) {
      const way = Math.sign(r.height(r.length));
      if (way > 0) ups++;
      for (let s = 0; s <= r.length; s += 2) {
        const g = r.grade(s);
        expect(Math.abs(g)).toBeLessThanOrEqual(MOUNTAIN.climb.most + 1e-9);
        expect(g * way).toBeGreaterThanOrEqual(-1e-9); // (never back the other way)
      }
      expect(Math.abs(r.height(r.length))).toBeCloseTo(MOUNTAIN.climb.mean * r.length, -1); // (within ~5 m)
    }
    expect(ups).toBeGreaterThan(0);
    expect(ups).toBeLessThan(roads.length);
  });

  it('steeper between a switchback\'s hairpins than round the hairpins themselves (the hairpins there to climb)', () => {
    let pin = 0, pinN = 0, between = 0, betweenN = 0;
    for (const r of roads) {
      // (hairpins: their tight middles; between: straight stretches next to a hairpin on both sides within 90 m)
      for (let s = 100; s <= r.length - 100; s += 2) {
        const g = Math.abs(r.grade(s));
        if (Math.abs(r.curvature(s)) > 1 / 26) {
          pin += g;
          pinN++;
        } else if (r.curvature(s) === 0) {
          let before = false, after = false;
          for (let d = 2; d <= 90; d += 2) {
            if (Math.abs(r.curvature(s - d)) > 1 / 26) before = true;
            if (Math.abs(r.curvature(s + d)) > 1 / 26) after = true;
          }
          if (before && after) {
            between += g;
            betweenN++;
          }
        }
      }
    }
    expect(between / betweenN).toBeGreaterThan(pin / pinN);
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

describe('insideReach (how far off the road its slopes may reach on a bend\'s inside: short of its centre)', () => {
  const hairpin = new Centerline([...straight(150), ...bend(20, 180, 10), ...straight(150)], { turnBack: true });
  const reach = insideReach(hairpin);
  const mid = 150 + 5 + 10 * Math.PI;
  it('on a bend\'s inside, short of its centre (the tightest within a way along); outside it and on a straight away from bends, no limit', () => {
    expect(reach(mid, 1)).toBeLessThanOrEqual(0.8 * 20 + 1e-6); // (a right bend's inside: its right)
    expect(reach(mid, 1)).toBeGreaterThan(0.5 * 20);
    expect(reach(150 - 20, 1)).toBeLessThanOrEqual(0.8 * 20 + 1e-6); // (coming to it: as tight)
    expect(reach(mid, -1)).toBe(Infinity);
    expect(reach(20, 1)).toBe(Infinity);
  });
  it('so no slope point there moves back from one row to the next (its triangles turned over)', () => {
    for (let s = 100; s < 280; s += 1) {
      if (reach(s, 1) === Infinity || reach(s + 1, 1) === Infinity) continue;
      const th = hairpin.heading(s + 0.5);
      const a = hairpin.toWorld(s, reach(s, 1)), b = hairpin.toWorld(s + 1, reach(s + 1, 1));
      expect((b.x - a.x) * Math.sin(th) - (b.z - a.z) * Math.cos(th)).toBeGreaterThan(0);
    }
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
