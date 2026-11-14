import { describe, it, expect } from 'vitest';
import { toMap } from '../src/ui/minimap';

describe('toMap', () => {
  it('the car heading up the map: what is ahead of it up, to its right right, whichever way it heads in the world', () => {
    // heading 0: along -z
    expect(toMap(0, -10, 0).ahead).toBeCloseTo(10, 9);
    expect(toMap(0, -10, 0).right).toBeCloseTo(0, 9);
    expect(toMap(10, 0, 0).right).toBeCloseTo(10, 9); // (+x: its right heading -z)
    // heading +90 deg: along +x
    const h = Math.PI / 2;
    expect(toMap(10, 0, h).ahead).toBeCloseTo(10, 9);
    expect(toMap(0, 10, h).right).toBeCloseTo(10, 9); // (+z: its right heading +x)
    expect(toMap(0, -10, h).right).toBeCloseTo(-10, 9);
  });

  it('keeps distances', () => {
    const m = toMap(3, -4, 0.7);
    expect(Math.hypot(m.ahead, m.right)).toBeCloseTo(5, 9);
  });
});
