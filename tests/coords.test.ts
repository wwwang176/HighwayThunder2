import { describe, it, expect } from 'vitest';
import { laneCenter, laneAt, lanesOccupied, roadToWorld, worldToRoad, headingVector } from '../src/road/coords';

describe('coords', () => {
  it('lane centers', () => {
    expect(laneCenter(0)).toBeCloseTo(-5.625);
    expect(laneCenter(3)).toBeCloseTo(5.625);
  });
  it('laneAt clamps and rounds', () => {
    expect(laneAt(-100)).toBe(0);
    expect(laneAt(2)).toBe(2);
    expect(laneAt(100)).toBe(3);
  });
  it('lanesOccupied', () => {
    expect(lanesOccupied(-1, 1)).toEqual([1, 2]);
    expect(lanesOccupied(4, 7)).toEqual([3]);
    expect(lanesOccupied(-20, 20)).toEqual([0, 1, 2, 3]);
  });
  it('road <-> world', () => {
    expect(roadToWorld(100, 2)).toEqual({ x: 2, z: -100 });
    const r = worldToRoad(2, -100);
    expect(r.s).toBe(100);
    expect(r.d).toBe(2);
  });
  it('positive yaw heads toward +d (right) while moving +s', () => {
    const h = headingVector(0.1);
    expect(h.x).toBeGreaterThan(0);
    expect(h.z).toBeLessThan(0);
    const h0 = headingVector(0);
    expect(h0.x).toBeCloseTo(0);
    expect(h0.z).toBeCloseTo(-1);
  });
});
