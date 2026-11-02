// Whole-system checks of the training simulation (physics, traffic, judging).
//   npx vitest run --config training/vitest.config.ts training/trainingSimChecks.train.ts
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

describe('TrainingSim traffic awareness', () => {
  it('traffic can be made to see the AI cars, as it sees the player in the game', () => {
    const seen: number[] = [];
    for (const sees of [false, true]) {
      const sim = new TrainingSim([constant(0, 0.5), constant(0, 0.5)], 1, { speedCap: 40, trafficSeesCars: sees });
      const orig = sim.traffic.stepAI.bind(sim.traffic);
      let count = 0;
      sim.traffic.stepAI = (dt, t, obstacles) => {
        count = obstacles(OUR_FRAME).filter((o) => o.isPlayer).length;
        orig(dt, t, obstacles);
      };
      sim.step();
      seen.push(count);
      sim.dispose();
    }
    expect(seen).toEqual([0, 2]);
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
