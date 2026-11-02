import { describe, it, expect } from 'vitest';
import {
  addRival,
  allRandom,
  allSameAsPlayer,
  CAR_CARDS,
  defaultSelection,
  loadSelection,
  MAX_RIVALS,
  PICKABLE,
  removeRival,
  sanitize,
  saveSelection,
} from '../src/game/carSelection';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('carSelection', () => {
  it('by default: everyone on the supercar, five rivals, normal difficulty, a clear night - the game as it was', () => {
    expect(defaultSelection()).toEqual({ player: 'street-racer', rivals: Array(5).fill('street-racer'), difficulty: 1, weather: 'clear' });
  });

  it('anything it does not know becomes the default; between 0 and 5 rivals', () => {
    expect(sanitize({ player: 'no-such-car', rivals: ['muscle-car', 'no-such-car'], difficulty: 3, weather: 'clear' })).toEqual({
      player: 'street-racer',
      rivals: ['muscle-car', 'street-racer'],
      difficulty: 3,
      weather: 'clear',
    });
    expect(sanitize({ player: 'jdm', rivals: Array(9).fill('jdm') }).rivals).toHaveLength(MAX_RIVALS);
    expect(sanitize({ player: 'jdm', rivals: [] }).rivals).toEqual([]);
    expect(sanitize({ player: 'jdm', rivals: [], difficulty: 7, weather: 'rain' })).toMatchObject({ difficulty: 1, weather: 'clear' });
    expect(sanitize('garbage')).toEqual(defaultSelection());
  });

  it('an old save (cars only) keeps its cars and gets the defaults for the rest', () => {
    const old = { player: 'muscle-car', rivals: ['jdm', 'jdm', 'muscle-car', 'street-racer', 'jdm'] };
    expect(sanitize(old)).toEqual({ ...old, difficulty: 1, weather: 'clear' });
  });

  it('is kept between visits; a broken saved value is the default', () => {
    const s = memory();
    const picked = { player: 'muscle-car', rivals: ['jdm', 'street-racer'], difficulty: 2, weather: 'clear' as const };
    saveSelection(s, picked);
    expect(loadSelection(s)).toEqual(picked);
    s.setItem('ht2.cars', '{not json');
    expect(loadSelection(s)).toEqual(defaultSelection());
  });

  it('storage that refuses to save (full, or turned off) does not stop the race', () => {
    const full = { setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    expect(() => saveSelection(full, defaultSelection())).not.toThrow();
  });

  it('rivals: added at the end as the player\'s car (up to five), removed from anywhere (the rest move up)', () => {
    const s = { ...defaultSelection(), player: 'jdm', rivals: ['street-racer', 'muscle-car'] };
    expect(addRival(s).rivals).toEqual(['street-racer', 'muscle-car', 'jdm']);
    expect(addRival({ ...s, rivals: Array(5).fill('muscle-car') }).rivals).toHaveLength(5);
    expect(removeRival(s, 0).rivals).toEqual(['muscle-car']);
  });

  it('the shortcuts change the rivals\' cars, not how many there are', () => {
    const s = { ...defaultSelection(), player: 'muscle-car', rivals: ['jdm', 'jdm', 'street-racer'] };
    expect(allSameAsPlayer(s).rivals).toEqual(Array(3).fill('muscle-car'));
    let k = 0;
    const r = allRandom(s, () => (k++ % 10) / 10);
    expect(r.rivals).toHaveLength(3);
    for (const id of r.rivals) expect(PICKABLE).toContain(id);
  });

  it('three cards, all pickable, each with acceleration, top speed and cornering', () => {
    expect(CAR_CARDS.map((c) => [c.name, c.pickable, c.stats.length])).toEqual([
      ['超跑', true, 3],
      ['肌肉車', true, 3],
      ['改裝車', true, 3],
    ]);
  });
});
