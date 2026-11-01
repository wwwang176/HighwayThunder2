import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Brain, createBrain } from '../src/ai/brain';
import { BRAIN_LAYERS } from '../src/ai/evolution';
import { mulberry32 } from '../src/ai/rng';
import { judgeContacts, ownLane, TrainingSim } from '../src/ai/trainingSim';
import { GRASS_GRIP, PHYSICS_DT } from '../src/config';
import { FITNESS, isOffRoad } from '../src/ai/fitness';
import { laneAt, laneCenter } from '../src/road/coords';
import { OUR_FRAME } from '../src/road/frame';

beforeAll(async () => {
  await RAPIER.init();
});

/** A network that ignores its inputs: lane choice (-1 left, 0 keep, 1 right) and target speed (fraction of the cap) set by the output biases. */
function constant(lane: number, speed: number): Brain {
  const b = createBrain(BRAIN_LAYERS, mulberry32(1));
  b.weights.fill(0);
  const n = b.weights.length;
  const row = 16 + 1;
  b.weights[n - 2 * row + 16] = 3 * lane;
  b.weights[n - 1 * row + 16] = Math.atanh(speed * 2 - 1);
  return b;
}

const run = (sim: TrainingSim, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / PHYSICS_DT) && !sim.done; i++) sim.step();
};

describe('judgeContacts (light contact is allowed)', () => {
  const box = (id: number, v: number) => ({ id, s: 0, dMin: 0, dMax: 1, v, length: 4.5 });

  it('a light touch is counted once per contact, not per step, and is not a crash', () => {
    const open = new Map<number, number>();
    expect(judgeContacts([box(1, 30)], 32, 0.5, 1, open)).toBe(1);
    expect(judgeContacts([box(1, 30)], 32, 0.5, 1.1, open)).toBe(0); // same contact going on
    expect(judgeContacts([], 32, 0, 1.2, open)).toBe(0); // over
    expect(judgeContacts([box(1, 30)], 32, 0.5, 2, open)).toBe(1); // a new one
  });

  it('a hard hit is a crash, and so is staying inside another car', () => {
    expect(judgeContacts([box(1, 20)], 30, 0, 1, new Map())).toBe('crash'); // 36 km/h faster
    expect(judgeContacts([box(1, 30)], 30, 5, 1, new Map())).toBe('crash'); // swiped at 18 km/h sideways
    const open = new Map<number, number>();
    judgeContacts([box(1, 30)], 31, 0, 1, open);
    expect(judgeContacts([box(1, 30)], 31, 0, 1 + FITNESS.maxContactTime + 0.01, open)).toBe('crash');
  });
});

describe('ownLane', () => {
  it('the lane it is settled in; none while moving across or between lanes', () => {
    expect(ownLane(laneCenter(2) + 0.2, 0.3)).toBe(2);
    expect(ownLane(laneCenter(2), 2)).toBeNull();
    expect(ownLane((laneCenter(1) + laneCenter(2)) / 2, 0)).toBeNull();
  });
});

describe('TrainingSim', () => {
  it('cars driving straight stay alive and make progress', () => {
    const sim = new TrainingSim([constant(0, 0.5), constant(0, 0.5), constant(0, 0.5)], 11, { speedCap: 40 });
    run(sim, 5);
    for (const g of sim.ghosts) {
      expect(g.alive).toBe(true);
      expect(g.result.distance).toBeGreaterThan(10);
    }
    sim.dispose();
  });

  it('a car that always wants to go right ends up in the right lane, still on the road', () => {
    const sim = new TrainingSim([constant(1, 0.6)], 11, { speedCap: 40 });
    const g = sim.ghosts[0];
    let worst = 0;
    for (let i = 0; i < Math.round(8 / PHYSICS_DT) && g.alive; i++) {
      sim.step();
      worst = Math.max(worst, g.car.d);
    }
    expect(isOffRoad(g.car.s, g.car.d, g.car.yaw)).toBe(false);
    expect(laneAt(g.car.d)).toBe(3);
    expect(g.laneChanges).toBe(1); // counted where it settles: 1 → 3 without settling in 2
    expect(worst).toBeLessThan(laneCenter(3) + 1); // swings past a little faster with the 1.5x engine
    sim.dispose();
  });

  it('is repeatable for a seed', () => {
    const a = new TrainingSim([constant(1, 0.7), constant(-1, 0.4)], 5, { speedCap: 60 });
    const b = new TrainingSim([constant(1, 0.7), constant(-1, 0.4)], 5, { speedCap: 60 });
    run(a, 5);
    run(b, 5);
    expect(a.ghosts.map((g) => g.result.distance)).toEqual(b.ghosts.map((g) => g.result.distance));
    a.dispose();
    b.dispose();
  });

  it('tells the traffic where live ghosts are, so nothing is spawned on top of them', () => {
    const sim = new TrainingSim([constant(0, 0.5), constant(0, 0.5)], 1, { speedCap: 40 });
    const occ = sim.occupants(OUR_FRAME);
    expect(occ.length).toBeGreaterThanOrEqual(2);
    expect(occ.every((o) => o.lane === 1 && Math.abs(o.s) < 1)).toBe(true);
    sim.ghosts[0].alive = false;
    expect(sim.occupants(OUR_FRAME).length).toBe(occ.length / 2);
    sim.dispose();
  });

  it('ghosts have the same grass grip as the player car in the game', () => {
    const sim = new TrainingSim([constant(0, 0.5)], 1, { speedCap: 40 });
    const car = sim.ghosts[0].car;
    expect(car.surfaceGrip(-15)).toBe(GRASS_GRIP);
    expect(car.surfaceGrip(0)).toBe(1);
    sim.dispose();
  });

  it('a car that never moves is dropped after the stall window', () => {
    const sim = new TrainingSim([constant(0, 0.001)], 3, { speedCap: 40 });
    run(sim, 12);
    expect(sim.ghosts[0].alive).toBe(false);
    expect(sim.ghosts[0].result.crashed).toBe(false);
    sim.dispose();
  });
});
