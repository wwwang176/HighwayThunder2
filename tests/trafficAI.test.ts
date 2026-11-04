import { describe, it, expect } from 'vitest';
import { TrafficSim, Obstacle, Agent } from '../src/traffic/trafficAI';
import { laneCenter } from '../src/road/coords';
import { VEHICLE_SPECS, VehicleKind } from '../src/config';

const dt = 1 / 120;

function rngFrom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function run(sim: TrafficSim, sec: number, obstacles: Obstacle[] = [], each?: (t: number) => void, seed = 1) {
  const rng = rngFrom(seed);
  const n = Math.round(sec / dt);
  for (let i = 0; i < n; i++) {
    sim.step(dt, obstacles, rng);
    each?.(i * dt);
  }
}

function add(sim: TrafficSim, kind: VehicleKind, s: number, lane: number, v: number, desired = v, seed = 5): Agent {
  const a = sim.addAgent(kind, s, lane, rngFrom(seed));
  a.v = v;
  a.desiredV = desired;
  a.idm.v0 = desired;
  return a;
}

describe('TrafficSim', () => {
  it('follows a slower leader without collision', () => {
    const sim = new TrafficSim();
    const lead = add(sim, 'car', 100, 1, 15);
    const f = add(sim, 'car', 40, 1, 30, 33);
    f.cooldown = Infinity;
    lead.cooldown = Infinity;
    let minGap = Infinity;
    run(sim, 30, [], () => {
      minGap = Math.min(minGap, lead.s - lead.length / 2 - (f.s + f.length / 2));
    });
    expect(minGap).toBeGreaterThan(0.5);
    expect(f.v).toBeLessThan(16);
  });

  it('brakes for a stationary obstacle spanning two lanes', () => {
    const sim = new TrafficSim();
    const a1 = add(sim, 'car', 50, 1, 30);
    const a2 = add(sim, 'car', 50, 2, 30);
    a1.cooldown = a2.cooldown = Infinity;
    const wreck: Obstacle = { id: -1, s: 200, dMin: -2.5, dMax: 2.5, v: 0, length: 4 };
    run(sim, 30, [wreck]);
    for (const a of [a1, a2]) {
      expect(a.s + a.length / 2).toBeLessThan(200 - 2);
      expect(a.v).toBeLessThan(0.5);
    }
  });

  it('brakes for a stopped player in its lane', () => {
    const sim = new TrafficSim();
    const a = add(sim, 'car', 0, 0, 30);
    a.cooldown = Infinity;
    const player: Obstacle = { id: -2, s: 150, dMin: laneCenter(0) - 0.93, dMax: laneCenter(0) + 0.93, v: 0, length: 4.4, isPlayer: true };
    run(sim, 30, [player]);
    expect(a.s + a.length / 2).toBeLessThan(150 - 2.2);
  });

  it('signals at least 1 s before moving sideways', () => {
    const sim = new TrafficSim();
    add(sim, 'car', 60, 1, 10, 10).cooldown = Infinity;
    const f = add(sim, 'car', 20, 1, 30, 33);
    f.cooldown = 0;
    f.politeness = 0;
    const d0 = f.d;
    let signalAt = -1;
    let moveAt = -1;
    run(sim, 10, [], (t) => {
      if (f.lcState === 'signal' && signalAt < 0) signalAt = t;
      if (f.lcState === 'signal') expect(f.d).toBe(d0);
      if (f.lcState === 'move' && moveAt < 0) moveAt = t;
    });
    expect(signalAt).toBeGreaterThanOrEqual(0);
    expect(moveAt).toBeGreaterThan(signalAt + 0.99);
  });

  it('trucks and container trucks stay in the right two lanes', () => {
    const sim = new TrafficSim();
    const rng = rngFrom(9);
    const list: Agent[] = [];
    for (let i = 0; i < 6; i++) {
      const kind: VehicleKind = i % 2 ? 'truck' : 'container';
      const a = sim.addAgent(kind, i * 40, 2 + (i % 2), rng);
      list.push(a);
    }
    add(sim, 'car', 300, 2, 8, 8).cooldown = Infinity;
    add(sim, 'car', 320, 3, 8, 8).cooldown = Infinity;
    run(sim, 60, [], () => {
      for (const a of list) {
        expect(a.lane).toBeGreaterThanOrEqual(2);
        if (a.targetLane !== null) expect(a.targetLane).toBeGreaterThanOrEqual(2);
      }
    });
  });

  it('never cuts sideways faster than a smooth lane change allows', () => {
    const sim = new TrafficSim();
    const rng = rngFrom(3);
    for (let i = 0; i < 24; i++) {
      const kind: VehicleKind = i % 5 === 0 ? 'truck' : i % 7 === 0 ? 'container' : 'car';
      const lanes = VEHICLE_SPECS[kind].allowedLanes;
      sim.addAgent(kind, i * 30, lanes[i % lanes.length], rng);
    }
    const prev = new Map<number, number>();
    run(sim, 60, [], () => {
      for (const a of sim.agents.values()) {
        const p = prev.get(a.id);
        if (p !== undefined) {
          const maxStep = (1.5 * 3.75 * dt) / a.spec.laneChangeTime + 1e-6;
          expect(Math.abs(a.d - p)).toBeLessThanOrEqual(maxStep);
        }
        prev.set(a.id, a.d);
      }
    });
  }, 20_000); // (60 s of traffic: near the 5 s default on a busy machine, the whole suite at once)

  it('never changes lanes into a wreck that is alongside (center slightly behind)', () => {
    for (const back of [1, 2, 3, 4]) {
      const sim = new TrafficSim();
      add(sim, 'car', 130, 3, 0, 0.01).cooldown = Infinity; // stopped leader forces a lane change
      const a = add(sim, 'car', 120, 3, 0, 33);
      a.cooldown = 0;
      a.politeness = 0;
      // 12.5 m trailer wreck in lane 2, its center a little behind the car's center.
      const wreck: Obstacle = { id: -50, s: 120 - back, dMin: laneCenter(2) - 1.25, dMax: laneCenter(2) + 1.25, v: 0, length: 12.5 };
      let entered = false;
      run(sim, 4, [wreck], () => {
        if (a.lcState === 'move' && a.targetLane === 2) entered = true;
      });
      expect(entered).toBe(false);
    }
  });

  it('does not start a lane change in front of a fast-approaching player', () => {
    const sim = new TrafficSim();
    add(sim, 'car', 260, 1, 12, 12).cooldown = Infinity;
    const a = add(sim, 'car', 230, 1, 28, 33);
    a.cooldown = 0;
    a.politeness = 0;
    const player: Obstacle = { id: -2, s: 100, dMin: laneCenter(0) - 0.93, dMax: laneCenter(0) + 0.93, v: 83, length: 4.4, isPlayer: true };
    let violated = false;
    const rng = rngFrom(4);
    for (let i = 0; i < 240; i++) {
      const before = a.lcState;
      sim.step(dt, [player], rng);
      if (before !== 'move' && a.lcState === 'move' && a.targetLane === 0) {
        const closing = player.v - a.v;
        const gap = a.s - a.length / 2 - (player.s + player.length / 2);
        if (gap > -5 && gap < 2.5 * closing) violated = true;
      }
      player.s += player.v * dt;
    }
    expect(violated).toBe(false);
  });
});
