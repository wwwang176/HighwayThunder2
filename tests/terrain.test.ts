import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/ai/rng';
import { mountainRoad } from '../src/road/mountain';
import { earthwork, TERRAIN, terrainOf } from '../src/road/terrain';

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

  it('within a hairpin (its centre): ground between its legs\' heights - no pit under them, no knob over them (the player\'s: a deep hole there)', () => {
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
        expect(g).toBeLessThan(Math.max(a, b) + 5);
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
