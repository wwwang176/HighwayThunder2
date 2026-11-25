import { describe, expect, it } from 'vitest';
import { moverOf, onCourse, WAKE, wakers, type Mover } from '../src/traffic/wake';

describe('waking the traffic', () => {
  const car = (s: number, d: number, vS: number, vD = 0): Mover => ({ s, d, vS, vD, halfLength: 2.2, halfWidth: 0.95 });
  const npc = (s: number, d: number, vS: number) => ({ s, d, vS, halfLength: 2.3, halfWidth: 0.9 });

  it('woken by a car that would touch it within WAKE.ahead s: closing in, in its lane', () => {
    expect(WAKE.ahead).toBe(0.3);
    // (58 m/s faster, 10 m clear between them: there in 0.17 s)
    expect(onCourse(car(1000, 1.875, 83), npc(1014.5, 1.875, 25))).toBe(true);
    // (40 m clear: 0.69 s - not yet)
    expect(onCourse(car(1000, 1.875, 83), npc(1044.5, 1.875, 25))).toBe(false);
    // (the same speed, 10 m clear: never closing - only WAKE.along m clear)
    expect(onCourse(car(1000, 1.875, 25), npc(1014.5, 1.875, 25))).toBe(false);
    expect(onCourse(car(1000, 1.875, 25), npc(1000 + 4.5 + WAKE.along - 0.1, 1.875, 25))).toBe(true);
  });

  it('not by one in another lane going by, unless it moves over to it', () => {
    expect(onCourse(car(1000, 1.875, 83), npc(1014.5, 5.625, 25))).toBe(false); // (a lane over)
    expect(onCourse(car(1000, 1.875, 83, 8), npc(1014.5, 5.625, 25))).toBe(true); // (8 m/s across: there in 0.3 s)
    expect(onCourse(car(1000, 5.625, 83, -8), npc(1014.5, 1.875, 25))).toBe(true);
  });

  it('alongside: touching it already', () => {
    expect(onCourse(car(1000, 1.875, 30), npc(1001, 1.875 + 1.85 + WAKE.across - 0.1, 30))).toBe(true);
    expect(onCourse(car(1000, 1.875, 30), npc(1001, 1.875 + 1.85 + WAKE.across + 0.1, 30))).toBe(false);
  });

  it('one behind closing in on it too (it slowing, the traffic faster); the oncoming beyond the median: never', () => {
    expect(onCourse(car(1000, 1.875, 10), npc(988, 1.875, 40))).toBe(true);
    expect(onCourse(car(1000, -1.875, 83), npc(1014.5, -23, -25))).toBe(false);
    expect(onCourse(car(1000, -12, 83, -30), npc(1014.5, -16.5, -25))).toBe(true); // (over the median, flying at it)
  });

  it('a car\'s motion along the road and across it, by its heading', () => {
    const m = moverOf({ s: 10, d: 2, vLong: 50, vLat: 0, yaw: 0.1, length: 4.4, width: 1.9 });
    expect(m.vS).toBeCloseTo(50 * Math.cos(0.1));
    expect(m.vD).toBeCloseTo(50 * Math.sin(0.1));
    expect(m.halfLength).toBeCloseTo(2.2);
    expect(m.halfWidth).toBeCloseTo(0.95);
  });

  it('who wakes it: round the player (our side) by reach; the other cars by their course, only within WAKE.seen m of the player', () => {
    const at = (s: number) => ({ s, d: 0, vLong: 50, vLat: 0, yaw: 0, length: 4.4, width: 1.9 });
    const w = wakers(at(1000), [at(1250), at(1400), at(800), at(600)], 120);
    expect(w.rousers).toEqual([{ s: 1000, reach: 120, oursOnly: true }]);
    expect(w.movers.map((m) => m.s)).toEqual([1000, 1250, 800]); // (the player on its course too: the oncoming)
    expect(WAKE.seen).toBe(300);
  });
});
