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

/** The bursts an AI fires over `seconds` on full throttle, a full tank kept full: [start, end] each (s). */
function bursts(ai: NitroAi, seconds: number): [number, number][] {
  const n = new Nitro();
  const dt = 0.01;
  const out: [number, number][] = [];
  for (let i = 0; i * dt < seconds; i++) {
    n.level = 1;
    const t = i * dt;
    if (!ai.want(dt, 1, n)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - t) < dt / 2) last[1] = t + dt;
    else out.push([t, t + dt]);
  }
  return out;
}

describe('the AI\'s nitro', () => {
  it('fires its bursts as short and its gaps as short as NITRO.aiBurst and aiGap go, the dice low', () => {
    const b = bursts(new NitroAi(() => 0), 6);
    expect(b[0][0]).toBe(0);
    expect(b[0][1] - b[0][0]).toBeCloseTo(NITRO.aiBurst[0], 1);
    expect(b[1][0] - b[0][1]).toBeCloseTo(NITRO.aiGap[0], 1);
  });

  it('as long as they go, the dice high', () => {
    const b = bursts(new NitroAi(() => 0.9999), 8);
    expect(b[0][1] - b[0][0]).toBeCloseTo(NITRO.aiBurst[1], 1);
    expect(b[1][0] - b[0][1]).toBeCloseTo(NITRO.aiGap[1], 1);
  });

  it('a burst and a gap each within their bounds, by chance', () => {
    const b = bursts(new NitroAi(), 60);
    for (let i = 0; i < b.length - 1; i++) {
      expect(b[i][1] - b[i][0]).toBeGreaterThanOrEqual(NITRO.aiBurst[0] - 0.02);
      expect(b[i][1] - b[i][0]).toBeLessThanOrEqual(NITRO.aiBurst[1] + 0.02);
      expect(b[i + 1][0] - b[i][1]).toBeGreaterThanOrEqual(NITRO.aiGap[0] - 0.02);
      expect(b[i + 1][0] - b[i][1]).toBeLessThanOrEqual(NITRO.aiGap[1] + 0.02);
    }
  });

  it('not off the throttle, nor without enough in the tank for its next burst', () => {
    const n = new Nitro();
    n.level = 1;
    expect(new NitroAi(() => 0).want(0.05, 0.3, n)).toBe(false);
    n.level = 0.15; // (enough for 0.4 s, not for 0.9 s)
    expect(new NitroAi(() => 0).want(0.05, 1, n)).toBe(true);
    expect(new NitroAi(() => 0.9999).want(0.05, 1, n)).toBe(false);
  });
});
