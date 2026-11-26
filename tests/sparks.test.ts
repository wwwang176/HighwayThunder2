import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { burstSparks, scrapeSparks, slideSpeed, Sparks, SPARKS } from '../src/world/sparks';
import { impactSpeed } from '../src/physics/physicsWorld';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('collision sparks', () => {
  it('slide: the surfaces\' relative velocity across the normal (its sign no matter), not into it', () => {
    const n = v(1, 0, 0); // a rail along z
    expect(slideSpeed(v(2, 0, -30), v(0, 0, 0), n)).toBeCloseTo(30); // scraping along it, pressing in
    expect(slideSpeed(v(5, 0, 0), v(0, 0, 0), n)).toBeCloseTo(0); // straight into it
    expect(slideSpeed(v(0, 0, -30), v(0, 0, -26), n.clone().negate())).toBeCloseTo(4); // two cars side by side
  });

  it('a scrape throws SPARKS.rate a second per m/s over SPARKS.minSlide; slower, none', () => {
    expect(scrapeSparks(SPARKS.minSlide - 1, 1)).toBe(0);
    expect(scrapeSparks(SPARKS.minSlide + 10, 0.5)).toBeCloseTo(SPARKS.rate * 10 * 0.5);
  });

  it('a hit\'s burst grows with the speed, up to SPARKS.burstMax; a touch throws none', () => {
    expect(burstSparks(SPARKS.minSlide / 2)).toBe(0);
    expect(burstSparks(10)).toBe(Math.round(SPARKS.burst * 10));
    expect(burstSparks(200)).toBe(SPARKS.burstMax);
  });

  it('a hit\'s force: the speed its impulse took out of the two along the push (impulse x the inverse masses)', () => {
    expect(impactSpeed(3000, 1 / 1500, 1 / 3000)).toBeCloseTo(3); // 2 m/s off the light car, 1 off the heavy
    expect(impactSpeed(3000, 1 / 1500, 0)).toBeCloseTo(2); // (a rail: fixed, no inverse mass)
    expect(impactSpeed(0, 1 / 1500, 1 / 3000)).toBe(0); // resting together
  });
});

describe('sparks on a road that climbs and falls', () => {
  /** A rail scraped at 30 m/s where the road is `floor` m up (its contact half a metre over it). */
  function scrape(floor: number, over = 0.5) {
    const sparks = new Sparks(new THREE.Scene());
    sparks.floorAt = () => floor;
    const at = v(5, floor + over, -100);
    const touch = {
      a: { type: 'player' as const }, b: { type: 'static' as const },
      points: [at], count: 1, normal: v(1, 0, 0), mid: at.clone(),
      va: v(0, 0, -30), vb: v(0, 0, 0), upA: v(0, 1, 0), upB: v(0, 0, 0), fresh: true, impact: 0,
    };
    sparks.touch(touch, 1 / 120);
    const s = sparks as unknown as { pos: Float32Array; age: Float32Array };
    const live = () => [...s.age.keys()].filter((i) => s.age[i] !== Infinity);
    const born = live().map((i) => s.pos[3 * i + 1]);
    let lowest = Infinity;
    for (let k = 0; k < 120; k++) {
      sparks.update(1 / 60, v(0, 0, 0));
      for (const i of live()) lowest = Math.min(lowest, s.pos[3 * i + 1]);
    }
    return { born, lowest };
  }

  it('are born at the contact, down in a valley too (not lifted to the height 0)', () => {
    const { born } = scrape(-40);
    expect(born.length).toBeGreaterThan(0);
    for (const y of born) expect(y).toBeCloseTo(-39.5, 3);
  });

  it('bounce off the road where it is, up on a hill too (not falling through it to the height 0)', () => {
    const { lowest } = scrape(30, 0.05); // (born just over it: they reach it before they die)
    expect(lowest).toBeGreaterThanOrEqual(30);
    expect(lowest).toBeLessThan(30.1);
  });
});
