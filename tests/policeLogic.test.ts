import { describe, it, expect } from 'vitest';
import { BLOCK, blockClear, blockD, blockSteer, bustAllowed, chaseStarts, guardD, guardHorizon, isLost, outOfSight, POLICE_TUNING, lineClear, parkSpot, phaseOf, pickTarget, racerVD, ramInput, reachTime, Sighting, type Racer } from '../src/game/policeLogic';
import { LANE_WIDTH, RAIL_D, ROAD_HALF_WIDTH } from '../src/config';
import type { SelfState, TrafficBox } from '../src/ai/sensors';
import type { Plan } from '../src/ai/planner';

const P = (s: number, isPlayer = false): Racer => ({ s, d: 0, v: 50, isPlayer });

describe('policeLogic', () => {
  it('the chase starts as any racer comes within POLICE_TUNING.notice of a parked police car - a rival too', () => {
    expect(POLICE_TUNING.notice).toBe(100);
    expect(chaseStarts(400, [P(250, true), P(310)])).toBe(true); // (a rival 90 m short of it)
    expect(chaseStarts(400, [P(410, true)])).toBe(true); // (past it)
    expect(chaseStarts(400, [P(250, true), P(299)])).toBe(false); // (both further off)
  });

  it('target: the player within POLICE_TUNING.playerFirst first, else the nearest racer in range', () => {
    expect(POLICE_TUNING.playerFirst).toBe(100);
    expect(pickTarget(1000, [P(1010), P(1090, true)], 300)!.isPlayer).toBe(true); // (the player near: it, a rival nearer)
    expect(pickTarget(1000, [P(1050), P(1200, true)], 300)!.s).toBe(1050); // (the player 200 m off: the nearer rival)
    expect(pickTarget(1000, [P(1250), P(1200, true)], 300)!.isPlayer).toBe(true); // (past 100 m: the nearest, the player)
    expect(pickTarget(1000, [P(1100), P(1500, true)], 300)!.s).toBe(1100);
    expect(pickTarget(1000, [P(1400), P(1500, true)], 300)).toBeNull();
  });

  it('a racer past the line is nobody\'s target', () => {
    expect(pickTarget(1000, [P(1100), { ...P(1010, true), done: true }], 300)!.s).toBe(1100);
    expect(pickTarget(1000, [{ ...P(1100), done: true }], 300)).toBeNull();
  });

  it('out of the player\'s sight: far behind it, or ahead past the fog', () => {
    expect(outOfSight(600, 1000)).toBe(true); // (300+ m behind)
    expect(outOfSight(800, 1000)).toBe(false);
    expect(outOfSight(1400, 1000)).toBe(false); // (400 m ahead: in the fog, still seen)
    expect(outOfSight(1000 + POLICE_TUNING.viewAhead + 1, 1000)).toBe(true);
    expect(POLICE_TUNING.parkAhead).toBeGreaterThanOrEqual(POLICE_TUNING.viewAhead); // (parked again out of sight)
  });

  it('front or behind by s against the target', () => {
    expect(phaseOf(1000, P(900))).toBe('front');
    expect(phaseOf(1000, P(1100))).toBe('behind');
  });

  it('a line is clear only with no box in the corridor between', () => {
    const box = { s: 1050, dMin: -1, dMax: 1, length: 4.5, v: 30 };
    expect(lineClear({ s: 1000, d: 0 }, { s: 1100, d: 0 }, [box], 1.1)).toBe(false);
    expect(lineClear({ s: 1000, d: 0 }, { s: 1100, d: 0 }, [{ ...box, dMin: 4, dMax: 6 }], 1.1)).toBe(true);
    expect(lineClear({ s: 1000, d: 0 }, { s: 1100, d: 0 }, [{ ...box, s: 1200 }], 1.1)).toBe(true);
  });

  it('lost only when far from every racer', () => {
    expect(isLost(1000, [P(1350), P(1500, true)], 300)).toBe(true);
    expect(isLost(1000, [P(1250), P(1500, true)], 300)).toBe(false);
  });

  it('parked on the shoulder ahead of the leader', () => {
    expect(parkSpot([P(900), P(1200, true)], 500)).toEqual({ s: 1700, d: (ROAD_HALF_WIDTH + RAIL_D) / 2 });
  });

  it('a bust: racing, a hard hit (45 km/h closing; a knock under it not), not just after a put-back', () => {
    expect(bustAllowed('racing', 45, 5)).toBe(true);
    expect(bustAllowed('racing', 40, 5)).toBe(false); // (a knock: no bust)
    expect(bustAllowed('racing', 50, 1)).toBe(false);
    expect(bustAllowed('finished', 60, 5)).toBe(false); // (past the line: the finish's show)
  });

  it('guarding: the predicted line\'s d where the target gets to the police car', () => {
    const plan: Plan = { points: [{ t: 0, s: 900, d: 0, v: 50 }, { t: 1, s: 950, d: 2, v: 50 }, { t: 2, s: 1000, d: 3.75, v: 50 }] };
    expect(guardD(plan, 1000, { s: 900, d: 0, v: 50, isPlayer: true })).toBeCloseTo(3.75);
    expect(guardD(plan, 975, { s: 900, d: 0, v: 50, isPlayer: true })).toBeCloseTo(2.875);
    expect(guardD(plan, 1300, { s: 900, d: 0, v: 50, isPlayer: true })).toBeCloseTo(3.75); // (past the plan: its end)
    expect(guardD(plan, 1000, { s: 900, d: 1, v: 0, isPlayer: true })).toBe(1); // (standing: where it is)
  });

  it('a guard prediction looks only as far as the target takes to get to the police car, and 1 s more', () => {
    expect(guardHorizon(1100, P(1000))).toBeCloseTo(3); // (100 m at 50 m/s: 2 s, +1)
    expect(guardHorizon(1010, P(1000))).toBe(2); // (at least 2 s)
    expect(guardHorizon(2000, P(1000))).toBe(8); // (at most the planner's own)
    expect(guardHorizon(1100, { ...P(1000), v: 0 })).toBe(8); // (standing: no telling)
  });

  it('ramming: full throttle, steering toward the aim', () => {
    const self = { s: 1000, d: 0, yaw: 0, vLong: 40 } as SelfState;
    const left = ramInput(self, { s: 1030, d: -3 });
    expect(left.throttle).toBe(1);
    expect(left.brake).toBe(0);
    expect(Math.sign(left.steer)).toBe(Math.sign(ramInput(self, { s: 1030, d: -6 }).steer));
    expect(left.steer).not.toBe(0);
    expect(ramInput(self, { s: 1030, d: 3 }).steer).toBeCloseTo(-left.steer);
  });

  it('a racer\'s speed across the road: from its heading and its sideways slide', () => {
    expect(racerVD({ s: 0, d: 0, v: 50, isPlayer: true })).toBe(0); // (none given: straight)
    expect(racerVD({ s: 0, d: 0, v: 50, isPlayer: true, yaw: 0.05 })).toBeCloseTo(50 * Math.sin(0.05));
    expect(racerVD({ s: 0, d: 0, v: 50, isPlayer: true, yaw: 0, vLat: -1 })).toBeCloseTo(-1);
  });

  it('blocking: how soon its target is at its tail - none closing in: never', () => {
    const t = { s: 1000, d: 0, v: 60, isPlayer: true };
    expect(reachTime(1030, 50, 2.5, t, 2.5)).toBeCloseTo(25 / 10); // (30 m apart, 5 m of the two cars: 25 m at 10 m/s)
    expect(reachTime(1004, 50, 2.5, t, 2.5)).toBe(0); // (alongside)
    expect(reachTime(1030, 60, 2.5, t, 2.5)).toBe(Infinity);
  });

  it('blocking: what it saw of its target BLOCK.react s ago (its reaction), nothing that old yet: nothing', () => {
    expect(BLOCK.react).toBe(0.3); // (the user's)
    const seen = new Sighting();
    for (let i = 0; i <= 10; i++) seen.see(i / 10, i, 2 * i);
    expect(seen.at(1)?.d).toBe(7); // (at 0.7 s)
    expect(seen.at(1)?.vD).toBe(14);
    expect(seen.at(0.2)).toBeNull();
    seen.clear();
    expect(seen.at(1)).toBeNull();
  });

  it('blocking: where its target will be, its sideways speed on - a lane over at most, on the road', () => {
    expect(blockD(1.875, 0, 2, 1)).toBe(1.875); // (going straight)
    expect(blockD(1.875, 1, 1.5, 1)).toBeCloseTo(3.375);
    expect(blockD(-1.875, -4, 2, 1)).toBeCloseTo(-1.875 - LANE_WIDTH); // (not 8 m on: a lane change ends)
    expect(blockD(5.625, 4, 2, 1)).toBeCloseTo(ROAD_HALF_WIDTH - 1); // (not off the road)
  });

  it('blocking: only with no traffic in the way - beside it, or ahead of it on its way over, closed in on in time', () => {
    const self = { s: 1000, d: -1.875, v: 50, halfWidth: 1, halfLength: 2.5 };
    const box = (s: number, d: number, v: number): TrafficBox => ({ s, dMin: d - 0.9, dMax: d + 0.9, v, length: 4.5 });
    expect(blockClear(self, 1.875, 3, [])).toBe(true);
    expect(blockClear(self, 1.875, 3, [box(1002, 1.875, 30)])).toBe(false); // (beside it, in the lane it moves into)
    expect(blockClear(self, 1.875, 3, [box(1040, 1.875, 30)])).toBe(false); // (ahead, 20 m/s slower: 60 m closed in 3 s)
    expect(blockClear(self, 1.875, 3, [box(1100, 1.875, 30)])).toBe(true); // (far enough)
    expect(blockClear(self, 1.875, 3, [box(1040, -1.875, 30)])).toBe(false); // (ahead in its own lane too)
    expect(blockClear(self, 1.875, 3, [box(1002, 5.625, 30)])).toBe(true); // (two lanes over: not in its way)
    expect(blockClear(self, 1.875, 3, [box(970, 1.875, 30)])).toBe(true); // (behind, slower)
    expect(blockClear(self, 1.875, 3, [box(970, 1.875, 70)])).toBe(false); // (behind, faster: there in 1.5 s)
  });

  it('blocking: steered across to where its target will be', () => {
    const self = { s: 1000, d: 0, yaw: 0, vLong: 40, vLat: 0 } as SelfState;
    expect(blockSteer(self, 0)).toBeCloseTo(0);
    expect(Math.sign(blockSteer(self, 3))).toBe(Math.sign(ramInput(self, { s: 1030, d: 3 }).steer));
    expect(Math.abs(blockSteer(self, 3))).toBeLessThanOrEqual(1);
  });
});
