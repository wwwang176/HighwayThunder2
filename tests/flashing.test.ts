import { describe, it, expect } from 'vitest';
import { BeamFlasher, FLASH, wantsToFlash } from '../src/game/flashing';

const KMH = 1 / 3.6;

describe('flashing the high beam', () => {
  const me = { s: 0, d: 0, v: 250 * KMH };

  it('at a car ahead in its lane, much slower and soon reached', () => {
    expect(wantsToFlash(me, [{ s: 60, d: 0.5, v: 180 * KMH }])).toBe(true);
  });

  it('not at one in another lane, behind, far, barely slower, or reached only in a while', () => {
    expect(wantsToFlash(me, [{ s: 60, d: 3.75, v: 180 * KMH }])).toBe(false); // (the next lane)
    expect(wantsToFlash(me, [{ s: -20, d: 0, v: 100 * KMH }])).toBe(false); // (behind)
    expect(wantsToFlash(me, [{ s: 150, d: 0, v: 100 * KMH }])).toBe(false); // (far)
    expect(wantsToFlash(me, [{ s: 60, d: 0, v: 230 * KMH }])).toBe(false); // (20 km/h slower)
    expect(wantsToFlash({ ...me, v: 120 * KMH }, [{ s: 90, d: 0, v: 75 * KMH }])).toBe(false); // (45 km/h slower, 7 s off)
  });

  it('flashes on, off, on, then waits before it can again', () => {
    const f = new BeamFlasher();
    const dt = 0.01;
    const lit: boolean[] = [];
    for (let t = 0; t < 1.2; t += dt) lit.push(f.update(dt, true));
    const ons = lit.reduce((n, on, i) => n + (on && !lit[i - 1] ? 1 : 0), 0);
    expect(ons).toBe(FLASH.flashes);
    expect(lit[0]).toBe(true);
    expect(lit.at(-1)).toBe(false); // (done, waiting)
    for (let t = 0; t < FLASH.cooldown - 1.3; t += dt) expect(f.update(dt, true)).toBe(false);
    let again = false;
    for (let t = 0; t < 0.3; t += dt) again ||= f.update(dt, true);
    expect(again).toBe(true);
  });

  it('a flash under way runs out even if the reason went; none starts without one', () => {
    const f = new BeamFlasher();
    expect(f.update(0.01, true)).toBe(true);
    expect(f.update(0.01, false)).toBe(true);
    const g = new BeamFlasher();
    for (let t = 0; t < 2; t += 0.01) expect(g.update(0.01, false)).toBe(false);
  });

  it('holds still while paused (no time passing)', () => {
    const f = new BeamFlasher();
    f.update(0.01, true);
    for (let i = 0; i < 100; i++) expect(f.update(0, true)).toBe(true);
  });
});
