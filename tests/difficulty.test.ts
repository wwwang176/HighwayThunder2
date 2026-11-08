import { describe, it, expect } from 'vitest';
import { applyDifficulty, DIFFICULTIES } from '../src/game/difficulty';

describe('difficulty', () => {
  it('four levels: a share of the rivals cars own top speed, extreme all of it', () => {
    expect(DIFFICULTIES.map((d) => d.name)).toEqual(['簡單', '普通', '困難', '極限']);
    expect(DIFFICULTIES[3].topShare).toBe(1);
  });

  it('harder: faster rivals', () => {
    for (let i = 1; i < DIFFICULTIES.length; i++) expect(DIFFICULTIES[i].topShare).toBeGreaterThan(DIFFICULTIES[i - 1].topShare);
  });

  it('applied: the level share, an unknown level normal', () => {
    expect(applyDifficulty(0)).toBe(DIFFICULTIES[0].topShare);
    expect(applyDifficulty(99)).toBe(DIFFICULTIES[1].topShare);
  });
});
