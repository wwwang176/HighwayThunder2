import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/ai/rng';
import { mountainRoad, roadEdges } from '../src/road/mountain';
import { earthwork, groundAt, TERRAIN, terrainOf } from '../src/road/terrain';

describe('earthwork (the road cut into the ground or built up on it)', () => {
  it('on the road (past <= 0): the edge\'s height, whatever the ground', () => {
    expect(earthwork(50, 10, 0)).toBe(10);
    expect(earthwork(-50, 10, -2)).toBe(10);
  });

  it('a hill beside it: cut back no steeper than TERRAIN.cut a metre, after a ditch (its foot dipped TERRAIN.ditchDeep)', () => {
    expect(earthwork(100, 0, TERRAIN.ditch / 2)).toBeCloseTo(-TERRAIN.ditchDeep, 9); // (the ditch's bottom)
    expect(earthwork(100, 0, 5)).toBeCloseTo(TERRAIN.cut * (5 - TERRAIN.ditch), 9);
  });

  it('a fall beside it: built up, falling no steeper than TERRAIN.fill a metre past a verge', () => {
    expect(earthwork(-100, 0, TERRAIN.verge)).toBeCloseTo(0, 9);
    expect(earthwork(-100, 0, 5)).toBeCloseTo(-TERRAIN.fill * (5 - TERRAIN.verge), 9);
  });

  it('ground within both slopes: as it is', () => {
    expect(earthwork(1, 0, 5)).toBe(1);
    expect(earthwork(-1, 0, 5)).toBe(-1);
  });
});

describe('terrainOf (the mountainside the road is built on)', () => {
  const road = mountainRoad(mulberry32(1));
  const t = terrainOf(road);

  it('within a hairpin (its centre): no pit under its legs (the player\'s: a deep hole there); over them at most a spur no steeper than TERRAIN.steepest', () => {
    let pins = 0;
    let inRun = false, from = 0;
    for (let s = 0; s <= road.length; s += 0.5) {
      const tight = Math.abs(road.curvature(s)) > 1 / 26;
      if (tight && !inRun) from = s;
      if (!tight && inRun) {
        const mid = (from + s) / 2;
        const c = road.toWorld(mid, 1 / road.curvature(mid));
        const a = road.height(from), b = road.height(s);
        const g = t.height(c.x, c.z);
        expect(g).toBeGreaterThan(Math.min(a, b) - 5);
        expect(g).toBeLessThan(Math.max(a, b) + TERRAIN.steepest * Math.abs(1 / road.curvature(mid)));
        pins++;
      }
      inRun = tight;
    }
    expect(pins).toBeGreaterThan(3);
  });

  it('its normals: unit length, up', () => {
    for (const s of [100, 900, 2000]) {
      const p = road.toWorld(s, 30);
      const [x, y, z] = t.normal(p.x, p.z);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
      expect(y).toBeGreaterThan(0);
    }
  });
});

describe('groundAt (the ground as drawn: what the camera keeps clear of)', () => {
  const road = mountainRoad(mulberry32(2));
  const t = terrainOf(road);
  const edges = roadEdges(road);
  const s = 500;

  it('on the road: its surface', () => {
    const w = road.toWorld(s, 1.2);
    expect(groundAt(road, t, w.x, w.z, s)).toBeCloseTo(road.surfaceHeight(s, 1.2), 3);
  });

  it('past the edge, within the edge\'s strip: the earthwork against the edge, as the strip is drawn (not the grid\'s 3 m between nodes)', () => {
    for (const side of [-1, 1] as const) {
      const E = edges.at(s, side);
      const w = road.toWorld(s, side * (E + 2));
      const base = road.surfaceHeight(s, side * E);
      expect(groundAt(road, t, w.x, w.z, s)).toBeCloseTo(earthwork(t.natural(w.x, w.z), base, 2), 3);
    }
  });

  it('far off the road: the grid\'s', () => {
    const w = road.toWorld(s, edges.at(s, 1) + TERRAIN.seam + 15);
    expect(groundAt(road, t, w.x, w.z, s)).toBeCloseTo(t.height(w.x, w.z), 6);
  });
});
