import { describe, it, expect } from 'vitest';
import { GameFlow, formatTime } from '../src/game/gameState';
import { BEST_TIME_KEY } from '../src/config';

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

function runTo(g: GameFlow, seconds: number, s = 0) {
  const n = Math.round(seconds / 0.01);
  for (let i = 0; i < n; i++) g.update(0.01, s);
}

describe('GameFlow', () => {
  it('starts at title, countdown does not accumulate race time', () => {
    const g = new GameFlow(memStorage());
    expect(g.phase).toBe('title');
    g.start();
    expect(g.phase).toBe('countdown');
    runTo(g, 2.5);
    expect(g.raceTime).toBe(0);
    expect(g.phase).toBe('countdown');
    runTo(g, 1);
    expect(g.phase).toBe('racing');
    expect(g.raceTime).toBeGreaterThan(0);
    expect(g.raceTime).toBeLessThan(1);
  });

  it('finishes at 10 km and stores best time only when faster', () => {
    const st = memStorage({ [BEST_TIME_KEY]: '100' });
    const g = new GameFlow(st);
    expect(g.best).toBe(100);
    g.start();
    runTo(g, 3.05);
    runTo(g, 50, 5000);
    g.update(0.01, 10000);
    expect(g.phase).toBe('finished');
    expect(g.finishTime).not.toBeNull();
    expect(g.isBest).toBe(true);
    expect(Number(st.m.get(BEST_TIME_KEY))).toBeCloseTo(g.finishTime!, 5);

    const g2 = new GameFlow(st);
    g2.start();
    runTo(g2, 3.05);
    runTo(g2, 80, 5000);
    g2.update(0.01, 10001);
    expect(g2.isBest).toBe(false);
    expect(Number(st.m.get(BEST_TIME_KEY))).toBeCloseTo(g.finishTime!, 5);
  });

  it('after finish, updates, pause and start do not change finish time', () => {
    const g = new GameFlow(memStorage());
    g.start();
    runTo(g, 3.05);
    g.update(0.01, 10000);
    const ft = g.finishTime;
    runTo(g, 5, 10500);
    g.togglePause();
    expect(g.phase).toBe('finished');
    expect(g.finishTime).toBe(ft);
    expect(g.canReset()).toBe(false);
  });

  it('pause stops the clock', () => {
    const g = new GameFlow(memStorage());
    g.start();
    runTo(g, 4);
    g.togglePause();
    expect(g.phase).toBe('paused');
    const t = g.raceTime;
    runTo(g, 2);
    expect(g.raceTime).toBe(t);
    g.togglePause();
    expect(g.phase).toBe('racing');
  });

  it('reset only after GO and with 3s cooldown', () => {
    const g = new GameFlow(memStorage());
    g.start();
    expect(g.canReset()).toBe(false);
    runTo(g, 3.05);
    expect(g.canReset()).toBe(true);
    g.markReset();
    expect(g.canReset()).toBe(false);
    runTo(g, 2.9);
    expect(g.canReset()).toBe(false);
    runTo(g, 0.2);
    expect(g.canReset()).toBe(true);
  });

  it('formatTime', () => {
    expect(formatTime(0)).toBe('0:00.000');
    expect(formatTime(83.4567)).toBe('1:23.456');
  });
});
