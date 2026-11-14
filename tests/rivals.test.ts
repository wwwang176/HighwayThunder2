import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { clearOf, ghostMode, GRID_REV, gridRevStart, gridRevStep, needsReset, placeOf, putBackAt, Rivals, rubberBand, RIVAL_TUNING } from '../src/game/rivals';
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
  const own = 0.9 * cap; // (a difficulty's share of its car's top speed)

  it('level with the player or a little behind: as built', () => {
    expect(rubberBand(0, 40, own, cap)).toEqual({ push: 0, speedCap: own });
    expect(rubberBand(-T.boostFrom + 1, 40, own, cap)).toEqual({ push: 0, speedCap: own });
  });

  it('further behind: pushed, up to the most at boostFull - its top speed up toward its car\'s own, never past it', () => {
    const mid = rubberBand(-(T.boostFrom + T.boostFull) / 2, 40, own, cap);
    expect(mid.push).toBeCloseTo(0.5, 5);
    expect(mid.speedCap).toBeCloseTo(own + (cap - own) * T.topLift * 0.5, 5);
    expect(rubberBand(-T.boostFull, 40, own, cap).push).toBeCloseTo(1, 5);
    const far = rubberBand(-T.boostFull * 3, 40, own, cap);
    expect(far.push).toBeCloseTo(1, 5);
    expect(far.speedCap).toBeCloseTo(own + (cap - own) * T.topLift, 5);
    expect(far.speedCap).toBeLessThanOrEqual(cap);
    expect(rubberBand(-T.boostFull, 40, cap).speedCap).toBe(cap); // at its car's own already: no higher
  });

  it('far ahead: slowed down toward a little under the player speed, to wait', () => {
    expect(rubberBand(T.waitFrom - 1, 40, cap).speedCap).toBe(cap);
    const full = rubberBand(T.waitFull, 40, cap);
    expect(full.speedCap).toBeCloseTo(40 * T.waitSpeed, 5);
    expect(full.push).toBe(0);
    expect(rubberBand(T.waitFull * 2, 40, cap).speedCap).toBeCloseTo(40 * T.waitSpeed, 5);
    expect(rubberBand(T.waitFull, 2, cap).speedCap).toBeGreaterThanOrEqual(T.waitMinSpeed); // never parks on the road
  });
});

describe('ghostMode', () => {
  const solid = { ghost: false, blind: false };

  it('near: solid and seeing the traffic; past ghostFrom through it; past blindFrom (and the slack) not seeing it', () => {
    expect(ghostMode(T.ghostFrom - 1, solid, true)).toEqual(solid);
    expect(ghostMode(T.ghostFrom, solid, true)).toEqual({ ghost: true, blind: false });
    expect(ghostMode(T.blindFrom + T.ghostSlack - 1, { ghost: true, blind: false }, true)).toEqual({ ghost: true, blind: false });
    expect(ghostMode(T.blindFrom + T.ghostSlack, { ghost: true, blind: false }, true)).toEqual({ ghost: true, blind: true });
  });

  it('coming back: seeing again under blindFrom (less the slack), solid again under ghostFrom (less the slack) - only with room round it', () => {
    const blind = { ghost: true, blind: true };
    expect(ghostMode(T.blindFrom - T.ghostSlack + 1, blind, true).blind).toBe(true);
    expect(ghostMode(T.blindFrom - T.ghostSlack - 1, blind, true)).toEqual({ ghost: true, blind: false });
    const ghost = { ghost: true, blind: false };
    expect(ghostMode(T.ghostFrom - T.ghostSlack + 1, ghost, true).ghost).toBe(true);
    expect(ghostMode(T.ghostFrom - T.ghostSlack - 1, ghost, true).ghost).toBe(false);
    expect(ghostMode(0, ghost, false).ghost).toBe(true); // inside a car: still through it
  });
});

describe('clearOf', () => {
  const me = { s: 100, dMin: 1, dMax: 3, length: 4.5 };
  const box = (s: number, dMin: number, extra = {}) => ({ s, dMin, dMax: dMin + 2, length: 4.5, v: 0, ...extra });

  it('room along and across the road from every box; a phantom (a lane about to be taken) is no car', () => {
    expect(clearOf(me, 0, [])).toBe(true);
    expect(clearOf(me, 0, [box(100 + 4.5 + T.clearS + 0.1, 1)])).toBe(true);
    expect(clearOf(me, 0, [box(100 + 4.5 + T.clearS - 0.1, 1)])).toBe(false);
    expect(clearOf(me, 0, [box(100, 3 + T.clearD + 0.1)])).toBe(true);
    expect(clearOf(me, 0, [box(100, 3 + T.clearD - 0.1)])).toBe(false);
    expect(clearOf(me, 0, [box(100, 1, { phantom: true })])).toBe(true);
  });

  it('along, as far again as either closes on the other in clearTime', () => {
    const room = 4.5 + T.clearS + 20 * T.clearTime;
    expect(clearOf(me, 20, [box(100 + room - 0.1, 1)])).toBe(false); // closing 20 m/s on one ahead
    expect(clearOf(me, 20, [box(100 + room + 0.1, 1)])).toBe(true);
    expect(clearOf(me, 0, [box(100 - room + 0.1, 1, { v: 20 })])).toBe(false); // one behind closing on it
    expect(clearOf(me, 0, [box(100 + 4.5 + T.clearS + 0.1, 1, { v: 20 })])).toBe(true); // one ahead pulling away
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

  it('without teleports (the mountain road\'s): far behind or ahead it races on; off its own narrow road, put back', () => {
    expect(needsReset({ ...ok, playerS: ok.s + T.teleportBehind + 1 }, 4.75, false)).toBe(null);
    expect(needsReset({ ...ok, playerS: ok.s - T.teleportAhead - 1 }, 4.75, false)).toBe(null);
    expect(needsReset({ ...ok, d: 5, playerS: ok.s + T.teleportBehind + 1 }, 4.75, false)).toBe('off-road');
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
    for (const r of rivals.list) r.push = 0.5;
    rivals.drive(1 / 120, { player, traffic: [], speedCap: 300 * KMH, raceTime: 0 });
    const k = (r: (typeof rivals.list)[number]) => 1 + T.engineBoost * r.push;
    expect(rivals.list[0].push).toBeGreaterThan(0.45); // still pushed (the band eases off slowly)
    expect(rivals.list[0].car.params.power).toBeCloseTo(MUSCLE_CAR.params.power * k(rivals.list[0]), 3);
    expect(rivals.list[1].car.params.power).toBeCloseTo(STREET_RACER.params.power * k(rivals.list[1]), 3);
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
