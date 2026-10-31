import { describe, it, expect } from 'vitest';
import { planSpawns, shouldDespawn, pickKind, MIN_CLEAR_GAP } from '../src/traffic/spawner';
import { VEHICLE_SPECS } from '../src/config';

function rngFrom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('planSpawns', () => {
  it('initial fill: only ahead of the player, at least 60 m away, enough cars', () => {
    const reqs = planSpawns({ playerS: 0, playerV: 0, raceTime: 0, occupied: [], rng: rngFrom(1), initial: true });
    expect(reqs.length).toBeGreaterThanOrEqual(20);
    for (const r of reqs) expect(r.s - VEHICLE_SPECS[r.kind].length / 2).toBeGreaterThanOrEqual(60);
  });

  it('keeps clear gaps between vehicles in the same lane', () => {
    const reqs = planSpawns({ playerS: 0, playerV: 0, raceTime: 0, occupied: [], rng: rngFrom(2), initial: true });
    for (let lane = 0; lane < 4; lane++) {
      const inLane = reqs.filter((r) => r.lane === lane).sort((a, b) => a.s - b.s);
      for (let i = 1; i < inLane.length; i++) {
        const a = inLane[i - 1];
        const b = inLane[i];
        const gap = b.s - VEHICLE_SPECS[b.kind].length / 2 - (a.s + VEHICLE_SPECS[a.kind].length / 2);
        expect(gap).toBeGreaterThanOrEqual(MIN_CLEAR_GAP);
      }
    }
  });

  it('trucks and container trucks only in lanes 2-3', () => {
    for (let seed = 1; seed < 20; seed++) {
      const reqs = planSpawns({ playerS: 0, playerV: 0, raceTime: 0, occupied: [], rng: rngFrom(seed), initial: true });
      for (const r of reqs) if (r.kind !== 'car') expect(r.lane).toBeGreaterThanOrEqual(2);
    }
  });

  it('no rear spawns before 5 s of racing; rear spawns when slow afterwards', () => {
    const early = planSpawns({ playerS: 1000, playerV: 5, raceTime: 3, occupied: [], rng: rngFrom(3), initial: false });
    expect(early.some((r) => r.s < 1000)).toBe(false);
    let rear = 0;
    for (let seed = 1; seed < 40; seed++) {
      const late = planSpawns({ playerS: 1000, playerV: 5, raceTime: 10, occupied: [], rng: rngFrom(seed), initial: false });
      rear += late.filter((r) => r.s < 1000).length;
    }
    expect(rear).toBeGreaterThan(0);
  });

  it('no rear spawns when the player is fast', () => {
    for (let seed = 1; seed < 40; seed++) {
      const r = planSpawns({ playerS: 1000, playerV: 60, raceTime: 30, occupied: [], rng: rngFrom(seed), initial: false });
      expect(r.some((x) => x.s < 1000)).toBe(false);
    }
  });

  it('incremental spawns appear only at the far edge and respect existing vehicles', () => {
    const occupied = [{ s: 1650, lane: 1, length: 4.5 }];
    for (let seed = 1; seed < 40; seed++) {
      const reqs = planSpawns({ playerS: 1000, playerV: 80, raceTime: 30, occupied, rng: rngFrom(seed), initial: false });
      for (const r of reqs) {
        expect(r.s).toBeGreaterThanOrEqual(1600);
        expect(r.s).toBeLessThanOrEqual(1700);
        if (r.lane === 1) expect(Math.abs(r.s - 1650)).toBeGreaterThanOrEqual(MIN_CLEAR_GAP);
      }
    }
  });
});

describe('planSpawns safety', () => {
  it('a stopped player does not get the far edge packed: at most one new car per lane per 100 m band', () => {
    // Player stopped; everything nearer has driven away, so the ahead window is empty.
    const occupied: { s: number; lane: number; length: number; v?: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const reqs = planSpawns({ playerS: 0, playerV: 0, raceTime: 30, occupied, rng: rngFrom(i + 1), initial: false });
      for (const r of reqs) occupied.push({ s: r.s, lane: r.lane, length: VEHICLE_SPECS[r.kind].length, v: 30 });
    }
    for (let lane = 0; lane < 4; lane++) {
      expect(occupied.filter((o) => o.lane === lane && o.s >= 600 && o.s <= 700).length).toBeLessThanOrEqual(1);
    }
  });

  it('new vehicles behind a stopped obstacle start slow enough to stop', () => {
    const wreck = { s: 660, lane: 2, length: 4.5, v: 0 };
    for (let seed = 1; seed < 30; seed++) {
      const reqs = planSpawns({ playerS: 0, playerV: 80, raceTime: 30, occupied: [wreck], rng: rngFrom(seed), initial: false });
      for (const r of reqs) {
        if (r.lane !== 2 || r.s > 660) continue;
        const gap = 660 - 4.5 / 2 - (r.s + VEHICLE_SPECS[r.kind].length / 2);
        // Stopping distance at 3 m/s^2 must fit in the gap.
        expect((r.vMax * r.vMax) / (2 * 3)).toBeLessThanOrEqual(gap + 1e-6);
      }
    }
  });
});

describe('pickKind / shouldDespawn', () => {
  it('mix is mostly cars', () => {
    const rng = rngFrom(5);
    const counts = { car: 0, truck: 0, container: 0 };
    for (let i = 0; i < 5000; i++) counts[pickKind(rng)]++;
    expect(counts.car / 5000).toBeCloseTo(0.7, 1);
    expect(counts.truck).toBeGreaterThan(0);
    expect(counts.container).toBeGreaterThan(0);
  });
  it('despawn window', () => {
    expect(shouldDespawn(700, 1000)).toBe(true);
    expect(shouldDespawn(800, 1000)).toBe(false);
    expect(shouldDespawn(1950, 1000)).toBe(true);
  });
});
