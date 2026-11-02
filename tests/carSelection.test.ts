import { describe, it, expect } from 'vitest';
import { allRandom, allSameAsPlayer, CAR_CARDS, defaultSelection, loadSelection, PICKABLE, sanitize, saveSelection } from '../src/game/carSelection';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('carSelection', () => {
  it('by default everyone is on the supercar, as before', () => {
    expect(defaultSelection()).toEqual({ player: 'street-racer', rivals: Array(5).fill('street-racer') });
  });

  it('anything it does not know becomes the supercar, and there are always five rivals', () => {
    expect(sanitize({ player: 'jdm', rivals: ['muscle-car'] })).toEqual({ player: 'street-racer', rivals: ['muscle-car', ...Array(4).fill('street-racer')] });
    expect(sanitize({ player: 'muscle-car', rivals: Array(9).fill('muscle-car') }).rivals).toHaveLength(5);
    expect(sanitize('garbage')).toEqual(defaultSelection());
    expect(sanitize(null)).toEqual(defaultSelection());
  });

  it('is kept between visits; a broken saved value is the default', () => {
    const s = memory();
    const picked = { player: 'muscle-car', rivals: ['muscle-car', 'street-racer', 'muscle-car', 'street-racer', 'street-racer'] };
    saveSelection(s, picked);
    expect(loadSelection(s)).toEqual(picked);
    s.setItem('ht2.cars', '{not json');
    expect(loadSelection(s)).toEqual(defaultSelection());
    expect(loadSelection(memory())).toEqual(defaultSelection());
  });

  it('the shortcuts: all rivals on the player\'s car, or each a random one it can pick', () => {
    const s = { player: 'muscle-car', rivals: Array(5).fill('street-racer') };
    expect(allSameAsPlayer(s).rivals).toEqual(Array(5).fill('muscle-car'));
    let k = 0;
    const r = allRandom(s, () => (k++ % 10) / 10);
    expect(r.player).toBe('muscle-car');
    for (const id of r.rivals) expect(PICKABLE).toContain(id);
  });

  it('three cards; the tuned car is not pickable yet', () => {
    expect(CAR_CARDS.map((c) => [c.name, c.pickable])).toEqual([
      ['超跑', true],
      ['肌肉車', true],
      ['改裝車', false],
    ]);
  });
});
