import { describe, expect, it } from 'vitest';
import { Backfire, BACKFIRE } from '../src/vehicles/backfire';

/** Seconds of flame over `seconds` at `throttle`, and how many separate pops. */
const run = (b: Backfire, seconds: number, throttle: number, rpm: number, dt = 0.01) => {
  let on = 0;
  let pops = 0;
  let was = false;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    const f = b.update(dt, throttle, rpm);
    if (f) on += dt;
    if (f && !was) pops++;
    was = f;
  }
  return { on, pops };
};

describe('backfire', () => {
  it('lifting off at high revs: 1 to BACKFIRE.most pops within a second, each BACKFIRE.pop long', () => {
    for (const r of [0, 0.5, 0.99]) {
      const b = new Backfire(() => r);
      run(b, 0.5, 1, 0.8);
      const { on, pops } = run(b, 1, 0, 0.8);
      expect(pops).toBe(1 + Math.floor(r * BACKFIRE.most));
      expect(on).toBeCloseTo(pops * BACKFIRE.pop, 1);
    }
  });

  it('none at low revs, none while on the throttle, none off it without having been on', () => {
    const b = new Backfire(() => 0.5);
    run(b, 0.5, 1, 0.3);
    expect(run(b, 1, 0, 0.3).pops).toBe(0);
    expect(run(new Backfire(), 2, 1, 0.9).pops).toBe(0);
    expect(run(new Backfire(), 2, 0, 0.9).pops).toBe(0);
  });

  it('firstPop: on the step a lift-off lights its first pop, only then', () => {
    const b = new Backfire(() => 0.99); // 3 pops
    run(b, 0.5, 1, 0.8);
    let firsts = 0, at = -1, flameAt = -1;
    for (let i = 0; i < 100; i++) {
      const f = b.update(0.01, 0, 0.8);
      if (f && flameAt < 0) flameAt = i;
      if (b.firstPop) { firsts++; at = i; }
    }
    expect(firsts).toBe(1);
    expect(at).toBe(flameAt);
  });

  it('back on the throttle: the pops still to come are off', () => {
    const b = new Backfire(() => 0.99);
    run(b, 0.5, 1, 0.8);
    run(b, 0.05, 0, 0.8); // lifted, the first pop not yet
    expect(run(b, 1, 1, 0.8).pops).toBe(0);
  });
});
