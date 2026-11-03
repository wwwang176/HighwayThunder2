import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { burstSparks, scrapeSparks, slideSpeed, SPARKS } from '../src/world/sparks';

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
});
