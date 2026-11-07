import { describe, it, expect } from 'vitest';
import { planSpawns, shouldDespawn, shouldDespawnRange, pickKind, MIN_CLEAR_GAP, FAR_DESPAWN } from '../src/traffic/spawner';
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

describe('both ways (the game)', () => {
  const both = { playerV: 80, raceTime: 30, bothWays: true } as const;
  it('initial fill: ahead of the first racer and behind the last, never within 60 m of them', () => {
    const reqs = planSpawns({ ...both, playerS: 1000, tailS: 900, occupied: [], rng: rngFrom(1), initial: true });
    expect(reqs.some((r) => r.s < 900)).toBe(true);
    expect(reqs.some((r) => r.s > 1000)).toBe(true);
    for (const r of reqs) {
      const half = VEHICLE_SPECS[r.kind].length / 2;
      if (r.s < 950) expect(r.s + half).toBeLessThanOrEqual(900 - 60);
      else expect(r.s - half).toBeGreaterThanOrEqual(1000 + 60);
    }
  });
  it('later: only at the far edges, 600-700 m beyond the last racer and the first', () => {
    for (let seed = 1; seed < 40; seed++) {
      const reqs = planSpawns({ ...both, playerS: 1000, tailS: 900, occupied: [], rng: rngFrom(seed), initial: false });
      for (const r of reqs) expect((r.s >= 200 && r.s <= 300) || (r.s >= 1600 && r.s <= 1700)).toBe(true);
    }
  });
  it('oncoming: behind in world terms is larger frame s', () => {
    for (let seed = 1; seed < 20; seed++) {
      const reqs = planSpawns({ ...both, playerS: -500, tailS: -400, occupied: [], rng: rngFrom(seed), initial: false, facing: -1 });
      for (const r of reqs) expect((r.s >= -1200 && r.s <= -1100) || (r.s >= 200 && r.s <= 300)).toBe(true);
    }
  });
  it('gone only past 900 m behind the last racer', () => {
    expect(shouldDespawnRange(200, 900, 1000, 1, FAR_DESPAWN)).toBe(false);
    expect(shouldDespawnRange(-10, 900, 1000, 1, FAR_DESPAWN)).toBe(true);
  });
});

describe('oncoming (facing = -1)', () => {
  it('initial fill sits ahead of the player in world terms (smaller frame s), never closer than 60 m', () => {
    const playerS = -500; // player at world s=500 is frame s=-500 on the oncoming side
    const reqs = planSpawns({ playerS, playerV: 0, raceTime: 0, occupied: [], rng: rngFrom(1), initial: true, facing: -1 });
    expect(reqs.length).toBeGreaterThanOrEqual(15);
    for (const r of reqs) {
      expect(r.s + VEHICLE_SPECS[r.kind].length / 2).toBeLessThanOrEqual(playerS - 60);
      expect(r.s).toBeGreaterThanOrEqual(playerS - 700);
    }
  });
  it('incremental spawns appear at the far edge ahead of the player', () => {
    for (let seed = 1; seed < 20; seed++) {
      const reqs = planSpawns({ playerS: -500, playerV: 80, raceTime: 30, occupied: [], rng: rngFrom(seed), initial: false, facing: -1 });
      for (const r of reqs) {
        expect(r.s).toBeGreaterThanOrEqual(-1200);
        expect(r.s).toBeLessThanOrEqual(-1100);
      }
    }
  });
  it('never spawns behind the player', () => {
    for (let seed = 1; seed < 20; seed++) {
      const reqs = planSpawns({ playerS: -500, playerV: 0, raceTime: 30, occupied: [], rng: rngFrom(seed), initial: false, facing: -1 });
      expect(reqs.some((r) => r.s > -500)).toBe(false);
    }
  });
  it('despawns once it has passed the player', () => {
    expect(shouldDespawn(-200, -500, -1)).toBe(true); // 300 m past the player
    expect(shouldDespawn(-600, -500, -1)).toBe(false); // still approaching
    expect(shouldDespawn(-1500, -500, -1)).toBe(true); // too far ahead
  });
});
