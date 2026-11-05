import { describe, it, expect } from 'vitest';
import { FLARE_AIM, flareFacing } from '../src/render/lightFlares';

const deg = (a: number) => Math.cos((a * Math.PI) / 180);

describe('a lamp glow seen from off its axis', () => {
  it('is full ahead of the lamp, fading toward its side, gone from behind it', () => {
    expect(flareFacing(deg(0))).toBe(1);
    expect(flareFacing(deg(40))).toBe(1);
    const side = flareFacing(deg(75));
    expect(side).toBeGreaterThan(0);
    expect(side).toBeLessThan(1);
    expect(flareFacing(deg(100))).toBe(0);
    expect(flareFacing(deg(180))).toBe(0);
  });

  it('fades the more the further round (no step)', () => {
    let last = 1;
    for (let a = 0; a <= 180; a += 5) {
      const f = flareFacing(deg(a));
      expect(f).toBeLessThanOrEqual(last);
      last = f;
    }
    expect(flareFacing(deg(FLARE_AIM.full))).toBe(1);
    expect(flareFacing(deg(FLARE_AIM.gone))).toBe(0);
  });
});
