import { describe, expect, it } from 'vitest';
import { Nitro, NITRO, NitroAi } from '../src/vehicles/nitro';

const run = (n: Nitro, seconds: number, want: boolean, dt = 0.01) => {
  let on = false;
  for (let t = 0; t < seconds - 1e-9; t += dt) on = n.update(dt, want);
  return on;
};

describe('nitro', () => {
  it('starts full; from empty, fills on its own in NITRO.refill seconds', () => {
    const n = new Nitro();
    expect(n.level).toBe(1);
    n.level = 0;
    run(n, NITRO.refill / 2, false);
    expect(n.level).toBeCloseTo(0.5, 2);
    run(n, NITRO.refill, false);
    expect(n.level).toBe(1);
  });

  it('burns while held, a full tank in NITRO.burn seconds, and does not fill meanwhile', () => {
    const n = new Nitro();
    n.level = 1;
    expect(run(n, NITRO.burn / 2, true)).toBe(true);
    expect(n.level).toBeCloseTo(0.5, 2);
    expect(run(n, NITRO.burn, true)).toBe(false); // empty: no more boost
    expect(n.level).toBe(0);
    run(n, 1, true); // held on empty: still not filling
    expect(n.level).toBe(0);
  });

  it('a near miss adds NITRO.nearMiss, up to full', () => {
    const n = new Nitro();
    n.level = 0;
    n.nearMiss();
    expect(n.level).toBeCloseTo(NITRO.nearMiss);
    n.level = 0.9;
    n.nearMiss();
    expect(n.level).toBe(1);
  });

  it('reset (a race\'s start): full, off', () => {
    const n = new Nitro();
    n.level = 0.3;
    n.update(0.01, true);
    n.reset();
    expect(n.level).toBe(1);
    expect(n.active).toBe(false);
  });
});

describe('the AI\'s nitro', () => {
  it('fires a NITRO.aiBurst burst on full throttle with enough in the tank, then waits', () => {
    const ai = new NitroAi();
    const n = new Nitro();
    n.level = 1;
    const want: boolean[] = [];
    for (let t = 0; t < 1.5; t += 0.05) want.push(ai.want(0.05, 1, n));
    const firing = want.filter(Boolean).length * 0.05;
    expect(firing).toBeCloseTo(NITRO.aiBurst, 1);
    expect(want[0]).toBe(true);
  });

  it('not off the throttle, nor without enough for a burst', () => {
    const ai = new NitroAi();
    const n = new Nitro();
    n.level = 1;
    expect(ai.want(0.05, 0.3, n)).toBe(false);
    n.level = 0.05;
    expect(ai.want(0.05, 1, n)).toBe(false);
  });
});
