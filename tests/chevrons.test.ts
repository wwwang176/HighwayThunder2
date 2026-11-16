import { describe, it, expect } from 'vitest';
import { bend, Centerline, straight } from '../src/road/centerline';
import { CHEVRON_LEVELS, chevronSpots } from '../src/world/mountainScene';

/** One bend of radius r turning `deg` (right: + ), between straights. */
const road = (r: number, deg: number) => new Centerline([...straight(100), ...bend(r, deg, 10), ...straight(100)], { turnBack: true });

describe('chevronSpots', () => {
  it('the sharper the bend, the closer together its boards: a hairpin\'s, a medium bend\'s, a big bend\'s', () => {
    for (const [r, level] of [[20, 3], [70, 2], [120, 1]] as const) {
      const spots = chevronSpots(road(r, 90));
      expect(spots.length).toBeGreaterThan(1);
      for (const s of spots) expect(s.level).toBe(level);
      const gap = spots[1].s - spots[0].s;
      expect(gap).toBeCloseTo(CHEVRON_LEVELS[level - 1].spacing, 6);
    }
    expect(CHEVRON_LEVELS[0].spacing).toBeGreaterThan(CHEVRON_LEVELS[1].spacing);
    expect(CHEVRON_LEVELS[1].spacing).toBeGreaterThan(CHEVRON_LEVELS[2].spacing);
  });

  it('none on a bend gentler than the first level\'s radius, nor on a straight', () => {
    expect(chevronSpots(road(200, 40))).toEqual([]);
    expect(chevronSpots(new Centerline([...straight(300)]))).toEqual([]);
  });

  it('along the bend, its direction the bend\'s (right: +1)', () => {
    const right = chevronSpots(road(70, 90));
    const left = chevronSpots(road(70, -90));
    for (const s of right) {
      expect(s.dir).toBe(1);
      expect(s.s).toBeGreaterThanOrEqual(100);
      expect(s.s).toBeLessThanOrEqual(100 + 70 * (Math.PI / 2) + 10);
    }
    for (const s of left) expect(s.dir).toBe(-1);
  });
});
