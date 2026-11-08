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
  raceRivals,
  removeRival,
  sanitize,
  saveSelection,
  setRival,
  setRivalCount,
} from '../src/game/carSelection';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('carSelection', () => {
  it('by default: the player on the supercar, five rivals on cars at random, hard, a clear night', () => {
    expect(defaultSelection()).toEqual({ player: 'street-racer', rivals: Array(5).fill('street-racer'), rivalMode: 'random', difficulty: 2, weather: 'clear', paint: {} });
  });

  it('anything it does not know becomes the default; between 0 and 5 rivals', () => {
    expect(sanitize({ player: 'no-such-car', rivals: ['muscle-car', 'no-such-car'], difficulty: 3, weather: 'clear' })).toEqual({
      player: 'street-racer',
      rivals: ['muscle-car', 'street-racer'],
      rivalMode: 'custom',
      difficulty: 3,
      weather: 'clear',
      paint: {},
    });
    expect(sanitize({ player: 'jdm', rivals: [], rivalMode: 'random' }).rivalMode).toBe('random');
    expect(sanitize({ player: 'jdm', rivals: [], rivalMode: 'chaos' }).rivalMode).toBe('custom');
    expect(sanitize({ player: 'jdm', rivals: Array(9).fill('jdm') }).rivals).toHaveLength(MAX_RIVALS);
    expect(sanitize({ player: 'jdm', rivals: [] }).rivals).toEqual([]);
    expect(sanitize({ player: 'jdm', rivals: [], difficulty: 7, weather: 'rain' })).toMatchObject({ difficulty: 2, weather: 'clear' });
    expect(sanitize('garbage')).toEqual(defaultSelection());
  });

  it('an old save (cars only) keeps its cars and gets the defaults for the rest', () => {
    const old = { player: 'muscle-car', rivals: ['jdm', 'jdm', 'muscle-car', 'street-racer', 'jdm'] };
    expect(sanitize(old)).toEqual({ ...old, rivalMode: 'custom', difficulty: 2, weather: 'clear', paint: {} });
  });

  it('keeps a paint job (by name) per pickable car, nothing else', () => {
    const paint = { jdm: 'red', 'muscle-car': 'blue-white', 'no-such-car': 'red', 'street-racer': 7 };
    expect(sanitize({ player: 'jdm', rivals: [], paint }).paint).toEqual({ jdm: 'red', 'muscle-car': 'blue-white' });
    expect(sanitize({ player: 'jdm', rivals: [], paint: 'red' }).paint).toEqual({});
  });

  it('is kept between visits; a broken saved value is the default', () => {
    const s = memory();
    const picked = { player: 'muscle-car', rivals: ['jdm', 'street-racer'], rivalMode: 'same' as const, difficulty: 2, weather: 'clear' as const, paint: { 'muscle-car': 'black' } };
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

  it('how many rivals, set at once: the ones kept keep their cars, new ones are the player\'s car, 0 to 5', () => {
    const s = { ...defaultSelection(), player: 'jdm', rivals: ['street-racer', 'muscle-car', 'street-racer'] };
    expect(setRivalCount(s, 1).rivals).toEqual(['street-racer']);
    expect(setRivalCount(s, 5).rivals).toEqual(['street-racer', 'muscle-car', 'street-racer', 'jdm', 'jdm']);
    expect(setRivalCount(s, 0).rivals).toEqual([]);
    expect(setRivalCount(s, 9).rivals).toHaveLength(MAX_RIVALS);
  });

  it('one rival\'s car picked straight (no stepping round); only a pickable car, only a rival that is there', () => {
    const s = { ...defaultSelection(), rivals: ['street-racer', 'street-racer'] };
    expect(setRival(s, 1, 'jdm').rivals).toEqual(['street-racer', 'jdm']);
    expect(setRival(s, 1, 'no-such-car')).toBe(s);
    expect(setRival(s, 4, 'jdm')).toBe(s);
  });

  it('the race\'s rivals by mode: drawn afresh each race, all on the player\'s car (whichever it is now), or as listed', () => {
    const s = { ...defaultSelection(), player: 'jdm', rivals: ['street-racer', 'muscle-car', 'street-racer'] };
    expect(raceRivals({ ...s, rivalMode: 'custom' }, Math.random)).toEqual(s.rivals);
    expect(raceRivals({ ...s, rivalMode: 'same' }, Math.random)).toEqual(['jdm', 'jdm', 'jdm']);
    let k = 0;
    const drawn = raceRivals({ ...s, rivalMode: 'random' }, () => [0, 0.4, 0.9][k++ % 3]);
    expect(drawn).toEqual([PICKABLE[0], PICKABLE[1], PICKABLE[2]]);
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
