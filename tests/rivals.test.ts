import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { GRID_REV, gridRevStart, gridRevStep, needsReset, placeOf, putBackAt, Rivals, rubberBand, RIVAL_TUNING } from '../src/game/rivals';
import { mulberry32 } from '../src/ai/rng';
import { KMH } from '../src/config';
import { laneCenter } from '../src/road/coords';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { PlayerCar } from '../src/vehicles/playerCar';
import { MUSCLE_CAR, STREET_RACER } from '../src/vehicles/cars';

beforeAll(async () => {
  await RAPIER.init();
});

const T = RIVAL_TUNING;
const cap = 300 * KMH;

describe('rubberBand', () => {
  it('level with the player or a little behind: as built', () => {
    expect(rubberBand(0, 40, cap)).toEqual({ boost: 0, speedCap: cap });
    expect(rubberBand(-T.boostFrom + 1, 40, cap)).toEqual({ boost: 0, speedCap: cap });
  });

  it('further behind: grip and engine boosted, up to the most at boostFull', () => {
    const mid = rubberBand(-(T.boostFrom + T.boostFull) / 2, 40, cap);
    expect(mid.boost).toBeCloseTo(T.maxBoost / 2, 5);
    expect(rubberBand(-T.boostFull, 40, cap).boost).toBeCloseTo(T.maxBoost, 5);
    expect(rubberBand(-T.boostFull * 3, 40, cap).boost).toBeCloseTo(T.maxBoost, 5);
  });

  it('far ahead: slowed down toward a little under the player speed, to wait', () => {
    expect(rubberBand(T.waitFrom - 1, 40, cap).speedCap).toBe(cap);
    const full = rubberBand(T.waitFull, 40, cap);
    expect(full.speedCap).toBeCloseTo(40 * T.waitSpeed, 5);
    expect(full.boost).toBe(0);
    expect(rubberBand(T.waitFull * 2, 40, cap).speedCap).toBeCloseTo(40 * T.waitSpeed, 5);
    expect(rubberBand(T.waitFull, 2, cap).speedCap).toBeGreaterThanOrEqual(T.waitMinSpeed); // never parks on the road
  });
});

describe('placeOf', () => {
  it('counts the rivals further down the road while racing', () => {
    const rivals = [{ s: 900, finishTime: null }, { s: 1100, finishTime: null }, { s: 1200, finishTime: null }];
    expect(placeOf(1000, null, rivals)).toBe(3);
    expect(placeOf(1500, null, rivals)).toBe(1);
  });

  it('once finished, only those that finished earlier are ahead', () => {
    const rivals = [{ s: 10_100, finishTime: 240 }, { s: 10_050, finishTime: 250 }, { s: 9_000, finishTime: null }];
    expect(placeOf(10_000, 245, rivals)).toBe(2);
    expect(placeOf(9_500, null, rivals)).toBe(3); // still racing: both finishers are ahead
  });
});

describe('needsReset', () => {
  const ok = { s: 500, d: laneCenter(1), yaw: 0, speed: 40, stuckFor: 0, playerS: 500 };

  it('a car racing along is left alone', () => {
    expect(needsReset(ok)).toBe(null);
  });

  it('stopped too long, spun round, off the road (the player well away), or hopelessly far behind: back into the race', () => {
    const away = { ...ok, playerS: ok.s + T.resetClear + 1 };
    expect(needsReset({ ...away, speed: 0.5, stuckFor: T.stuckTime + 0.1 })).toBe('stuck');
    expect(needsReset({ ...away, speed: 0.5, stuckFor: T.stuckTime - 0.1 })).toBe(null);
    expect(needsReset({ ...away, yaw: 1.2 })).toBe('spun');
    expect(needsReset({ ...away, d: 12 })).toBe('off-road');
    expect(needsReset({ ...ok, playerS: ok.s + T.teleportBehind + 1 })).toBe('far-behind');
  });

  it('stuck, spun or off the road within resetClear of the player, either way: left where it is (no popping)', () => {
    for (const gap of [0, T.resetClear - 1, -(T.resetClear - 1)]) {
      const near = { ...ok, playerS: ok.s + gap };
      expect(needsReset({ ...near, speed: 0.5, stuckFor: T.stuckTime + 0.1 })).toBe(null);
      expect(needsReset({ ...near, yaw: 1.2 })).toBe(null);
      expect(needsReset({ ...near, d: 12 })).toBe(null);
    }
    expect(needsReset({ ...ok, playerS: ok.s - T.resetClear - 1, yaw: 1.2 })).toBe('spun'); // far behind it, too
  });

  it('hopelessly far ahead: brought back to wait for the player', () => {
    expect(needsReset({ ...ok, playerS: ok.s - T.teleportAhead - 1 })).toBe('far-ahead');
    expect(needsReset({ ...ok, playerS: ok.s - T.teleportAhead + 1 })).toBe(null);
  });
});

describe('putBackAt', () => {
  const player = { s: 2000, speed: 55 };

  it('far behind or far ahead: near the player (behind / ahead of it), at the player\'s speed', () => {
    expect(putBackAt('far-behind', 1500, player)).toEqual({ s: 2000 - T.placeBehind, speed: 55 });
    expect(putBackAt('far-ahead', 2600, player)).toEqual({ s: 2000 + T.placeAhead, speed: 55 });
    expect(putBackAt('far-ahead', 2600, { s: 2000, speed: -1 }).speed).toBe(0); // backing up: not backwards
  });

  it('stuck, spun or off the road: where it was, at a set speed', () => {
    const at = putBackAt('spun', 1990, player);
    expect(at.s).toBe(1990);
    expect(at.speed).toBeCloseTo(60 / 3.6);
  });

  it('the same both ways: brought back from as far, to as far (out of sight), well short of being brought back again', () => {
    expect(T.teleportAhead).toBe(T.teleportBehind);
    expect(T.placeAhead).toBe(T.placeBehind);
    expect(T.placeBehind).toBeGreaterThanOrEqual(200);
    expect(T.placeBehind).toBeLessThanOrEqual(T.teleportBehind / 2);
    expect(T.placeAhead).toBeGreaterThanOrEqual(T.waitFull); // ahead, put where it waits as fast as the player (not drawing away again)
  });
});

describe('Rivals on their own cars', () => {
  const make = () => {
    const physics = PhysicsWorld.createSync();
    return { physics, rivals: new Rivals(physics, null, () => null, [MUSCLE_CAR, STREET_RACER]) };
  };

  it("each drives with its own car's tables", () => {
    const { physics, rivals } = make();
    expect(rivals.list[0].driver.latAccel).toBe(MUSCLE_CAR.ai.latAccel);
    expect(rivals.list[1].driver.latAccel).toBe(STREET_RACER.ai.latAccel);
    physics.free();
  });

  it('the rubber band boosts each car from its own engine', () => {
    const { physics, rivals } = make();
    const player = new PlayerCar(physics, null, { entity: { type: 'player' } });
    for (const r of rivals.list) r.boost = 0.25;
    rivals.drive(1 / 120, { player, traffic: [], speedCap: 300 * KMH, raceTime: 0 });
    const k = 1 + rivals.list[0].boost;
    expect(k).toBeGreaterThan(1.2); // still boosted (the band eases off slowly)
    expect(rivals.list[0].car.params.power).toBeCloseTo(MUSCLE_CAR.params.power * k, 3);
    expect(rivals.list[1].car.params.power).toBeCloseTo(STREET_RACER.params.power * (1 + rivals.list[1].boost), 3);
    physics.free();
  });

  it('never runs past its own top speed, whatever the AI cap', () => {
    const { physics, rivals } = make();
    const player = new PlayerCar(physics, null, { entity: { type: 'player' } });
    rivals.drive(1 / 120, { player, traffic: [], speedCap: 300 * KMH, raceTime: 0 });
    expect(rivals.list[0].car.params.maxSpeed).toBeLessThanOrEqual(MUSCLE_CAR.params.maxSpeed);
    physics.free();
  });

  it('dispose stops their planners (each a Web Worker in the game)', () => {
    const physics = PhysicsWorld.createSync();
    let stopped = 0;
    const source = () => ({ busy: false, request() {}, take: () => null, dispose: () => void stopped++ });
    const rivals = new Rivals(physics, null, source, [MUSCLE_CAR, STREET_RACER]);
    rivals.dispose();
    expect(stopped).toBe(2);
    physics.free();
  });

  it('dispose leaves nothing behind in the physics world', () => {
    const physics = PhysicsWorld.createSync();
    const before = physics.world.bodies.len();
    const rivals = new Rivals(physics, null, () => null, [MUSCLE_CAR, STREET_RACER]);
    expect(physics.world.bodies.len()).toBe(before + 2);
    rivals.dispose();
    expect(physics.world.bodies.len()).toBe(before);
    physics.free();
  });
});

describe('revving on the grid', () => {
  it('blips the throttle on and off in the set lengths, then holds it down for the green', () => {
    const rng = mulberry32(3);
    const dt = 1 / 120;
    const g = gridRevStart(rng);
    expect(g.on).toBe(false);
    expect(g.launch).toBeGreaterThanOrEqual(GRID_REV.launch[0]);
    expect(g.launch).toBeLessThanOrEqual(GRID_REV.launch[1]);
    const runs: { on: boolean; s: number }[] = [];
    let toGo = 3;
    let held = 0;
    while (toGo > 0) {
      const on = gridRevStep(g, dt, toGo, rng);
      if (toGo <= g.launch) {
        expect(on).toBe(true);
        held += dt;
      } else if (runs.length && runs[runs.length - 1].on === on) runs[runs.length - 1].s += dt;
      else runs.push({ on, s: dt });
      toGo -= dt;
    }
    expect(held).toBeCloseTo(g.launch, 1);
    expect(runs.filter((r) => r.on).length).toBeGreaterThanOrEqual(2); // a few blips, not one long burn
    // Whole blips and pauses (not the first wait, nor the last one cut short by the hold) last as set.
    for (const r of runs.slice(1, -1)) {
      const [lo, hi] = r.on ? GRID_REV.on : GRID_REV.off;
      expect(r.s).toBeGreaterThanOrEqual(lo - dt);
      expect(r.s).toBeLessThanOrEqual(hi + dt);
    }
  });
});
