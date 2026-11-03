import { describe, it, expect } from 'vitest';
import { closestBehind, overtook, progress } from '../src/ui/hudMath';

describe('hudMath', () => {
  it('the rival closest behind within range, with its colour and the side it comes up on', () => {
    const me = { s: 1000, d: 0 };
    const rivals = [
      { s: 960, d: 0, color: '#a' }, // 40 m behind (bumper to bumper: 35.6 m)
      { s: 990, d: -3.75, color: '#b' }, // closest, a lane to the left
      { s: 1010, d: 0, color: '#c' }, // ahead
      { s: 800, d: 0, color: '#d' }, // far behind
    ];
    expect(closestBehind(me, rivals, 50)).toEqual({ gap: 5.6, color: '#b', side: -1 });
    expect(closestBehind(me, [rivals[0]], 50)).toEqual({ gap: 35.6, color: '#a', side: 0 });
    expect(closestBehind(me, [rivals[2], rivals[3]], 50)).toBeNull();
  });

  it('progress along the road, from the start (0) to the finish (1), clamped', () => {
    expect(progress(0)).toBe(0);
    expect(progress(2500)).toBeCloseTo(0.5);
    expect(progress(-20)).toBe(0);
    expect(progress(6000)).toBe(1);
  });

  it('an overtake: the place got better (a smaller number), not on the first frame', () => {
    expect(overtook(3, 2)).toBe(true);
    expect(overtook(2, 3)).toBe(false);
    expect(overtook(2, 2)).toBe(false);
    expect(overtook(null, 1)).toBe(false);
  });
});
