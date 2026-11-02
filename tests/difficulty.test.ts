import { describe, it, expect } from 'vitest';
import { applyDifficulty, DIFFICULTIES } from '../src/game/difficulty';

describe('difficulty', () => {
  it('four levels; normal is the game as it was', () => {
    expect(DIFFICULTIES.map((d) => d.name)).toEqual(['簡單', '普通', '困難', '極限']);
    expect(DIFFICULTIES[1]).toMatchObject({ speedCapKmh: 300, maxBoost: 0.25, waitSpeed: 0.9 });
  });

  it('harder: rivals boosted more when behind and waiting less when ahead', () => {
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      expect(DIFFICULTIES[i].maxBoost).toBeGreaterThan(DIFFICULTIES[i - 1].maxBoost);
      expect(DIFFICULTIES[i].waitSpeed).toBeGreaterThan(DIFFICULTIES[i - 1].waitSpeed);
      expect(DIFFICULTIES[i].speedCapKmh).toBeGreaterThanOrEqual(DIFFICULTIES[i - 1].speedCapKmh);
    }
  });

  it('applied to the rivals only: their rubber band, and their top speed returned', () => {
    const band = { maxBoost: 0, waitSpeed: 0 };
    expect(applyDifficulty(0, band)).toBe(DIFFICULTIES[0].speedCapKmh);
    expect(band).toEqual({ maxBoost: DIFFICULTIES[0].maxBoost, waitSpeed: DIFFICULTIES[0].waitSpeed });
    expect(applyDifficulty(99, band)).toBe(DIFFICULTIES[1].speedCapKmh); // an unknown level: normal
    expect(band.maxBoost).toBe(DIFFICULTIES[1].maxBoost);
  });
});
