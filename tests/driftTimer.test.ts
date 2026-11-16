import { describe, it, expect } from 'vitest';
import { DRIFT_TIMER, DriftTimer } from '../src/game/driftTimer';

const D = DRIFT_TIMER;
const FAST = D.minSpeed + 5;
const DEG = Math.PI / 180;

/** `n` steps of `dt` at `slide` (rad) and `speed`: the last report. */
function run(timer: DriftTimer, n: number, slide: number, speed = FAST, dt = 0.1) {
  let r = timer.update(dt, slide, speed);
  for (let i = 1; i < n; i++) r = timer.update(dt, slide, speed);
  return r;
}

describe('DriftTimer (the drift\'s seconds on the HUD, as the near miss\'s message)', () => {
  it('starts past DRIFT_TIMER.on of slide at speed, counting the seconds it drifts', () => {
    const t = new DriftTimer();
    expect(run(t, 5, D.on - 2 * DEG).state).toBe('off');
    const r = run(t, 12, D.on + 2 * DEG);
    expect(r.state).toBe('on');
    expect(r.seconds).toBeCloseTo(1.2, 9);
  });

  it('not when crawling', () => {
    expect(run(new DriftTimer(), 10, 40 * DEG, D.minSpeed - 1).state).toBe('off');
  });

  it('kept on down to DRIFT_TIMER.keep of slide (less than to start)', () => {
    const t = new DriftTimer();
    run(t, 5, D.on + DEG);
    expect(run(t, 5, D.keep + DEG).state).toBe('on');
  });

  it('let go: held DRIFT_TIMER.grace s (its seconds not counting) - drifting again within it, on counting from where it was', () => {
    const t = new DriftTimer();
    run(t, 10, 30 * DEG); // (1 s)
    const held = run(t, 3, 0); // (0.3 s off)
    expect(held.state).toBe('grace');
    expect(held.seconds).toBeCloseTo(1, 9);
    const again = run(t, 5, D.keep + DEG); // (back in: the lower threshold)
    expect(again.state).toBe('on');
    expect(again.seconds).toBeCloseTo(1.5, 9);
  });

  it('past the grace: done, its seconds once, then off; the next drift from 0', () => {
    const t = new DriftTimer();
    run(t, 20, 30 * DEG); // (2 s)
    const states: string[] = [];
    let done = -1;
    for (let i = 0; i < 8; i++) {
      const r = t.update(0.1, 0, FAST);
      states.push(r.state);
      if (r.state === 'done') done = r.seconds;
    }
    expect(states.filter((s) => s === 'done').length).toBe(1);
    expect(done).toBeCloseTo(2, 9);
    expect(states[states.length - 1]).toBe('off');
    expect(run(t, 3, 30 * DEG).seconds).toBeCloseTo(0.3, 9);
  });

  it('reset: off, from 0', () => {
    const t = new DriftTimer();
    run(t, 10, 30 * DEG);
    t.reset();
    expect(t.update(0.1, 0, FAST).state).toBe('off');
  });
});
