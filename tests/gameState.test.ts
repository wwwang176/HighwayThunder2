import { describe, it, expect } from 'vitest';
import { GameFlow, formatTime, picksCars } from '../src/game/gameState';
import { ROAD_LENGTH } from '../src/config';

function runTo(g: GameFlow, seconds: number, s = 0) {
  const n = Math.round(seconds / 0.01);
  for (let i = 0; i < n; i++) g.update(0.01, s);
}

/** A race started and its intro over (the countdown on). */
function startRace(g: GameFlow) {
  g.start();
  g.beginCountdown();
}

describe('GameFlow', () => {
  it('a race starts with its intro: no countdown, no race time, till the intro hands over', () => {
    const g = new GameFlow();
    g.start();
    expect(g.phase).toBe('intro');
    runTo(g, 10);
    expect(g.phase).toBe('intro');
    expect(g.raceTime).toBe(0);
    g.togglePause(); // (no pause in the intro: a key skips it)
    expect(g.phase).toBe('intro');
    g.beginCountdown();
    expect(g.phase).toBe('countdown');
    g.beginCountdown(); // (only from the intro)
    expect(g.countdown).toBe(3);
  });

  it('starts at title, countdown does not accumulate race time', () => {
    const g = new GameFlow();
    expect(g.phase).toBe('title');
    startRace(g);
    expect(g.phase).toBe('countdown');
    runTo(g, 2.5);
    expect(g.raceTime).toBe(0);
    expect(g.phase).toBe('countdown');
    runTo(g, 1);
    expect(g.phase).toBe('racing');
    expect(g.raceTime).toBeGreaterThan(0);
    expect(g.raceTime).toBeLessThan(1);
  });

  it('finishes at the end of the road, its time where in the step it crossed', () => {
    const g = new GameFlow();
    startRace(g);
    runTo(g, 3.05);
    runTo(g, 50, ROAD_LENGTH / 2);
    g.update(0.01, ROAD_LENGTH);
    expect(g.phase).toBe('finished');
    expect(g.finishTime).toBeCloseTo(50.05, 1);
  });
  it('after finish, updates, pause and start do not change finish time', () => {
    const g = new GameFlow();
    startRace(g);
    runTo(g, 3.05);
    g.update(0.01, ROAD_LENGTH);
    const ft = g.finishTime;
    runTo(g, 5, ROAD_LENGTH + 500);
    g.togglePause();
    expect(g.phase).toBe('finished');
    expect(g.finishTime).toBe(ft);
    expect(g.canReset()).toBe(false);
  });

  it('pause stops the clock', () => {
    const g = new GameFlow();
    startRace(g);
    runTo(g, 4);
    g.togglePause();
    expect(g.phase).toBe('paused');
    const t = g.raceTime;
    runTo(g, 2);
    expect(g.raceTime).toBe(t);
    g.togglePause();
    expect(g.phase).toBe('racing');
  });

  it('reset only 3 s after GO and with 3s cooldown', () => {
    const g = new GameFlow();
    startRace(g);
    expect(g.canReset()).toBe(false);
    runTo(g, 3.05);
    expect(g.canReset()).toBe(false); // (not at the green: a standstill put back at RESET_SPEED)
    runTo(g, 3);
    expect(g.canReset()).toBe(true);
    g.markReset();
    expect(g.canReset()).toBe(false);
    runTo(g, 2.9);
    expect(g.canReset()).toBe(false);
    runTo(g, 0.2);
    expect(g.canReset()).toBe(true);
  });

  it('keeps the race top speed: only while racing, from zero each race', () => {
    const g = new GameFlow();
    startRace(g);
    g.noteSpeed(120); // (the countdown: not yet)
    expect(g.topSpeed).toBe(0);
    runTo(g, 3.05);
    g.noteSpeed(180);
    g.noteSpeed(150);
    expect(g.topSpeed).toBe(180);
    runTo(g, 1, ROAD_LENGTH); // finished
    g.noteSpeed(250);
    expect(g.topSpeed).toBe(180);
    g.start();
    expect(g.topSpeed).toBe(0);
  });

  it('formatTime', () => {
    expect(formatTime(0)).toBe('0:00.000');
    expect(formatTime(83.4567)).toBe('1:23.456');
  });
});

describe('picksCars', () => {
  it('cars are picked only before a race: from the title or after the finish, never mid-race', () => {
    expect(picksCars('title')).toBe(true);
    expect(picksCars('finished')).toBe(true);
    for (const p of ['countdown', 'racing', 'paused'] as const) expect(picksCars(p)).toBe(false);
  });
});
