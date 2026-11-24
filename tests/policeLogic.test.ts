import { describe, it, expect } from 'vitest';
import { bustAllowed, chaseStarts, guardD, guardHorizon, isLost, outOfSight, POLICE_TUNING, lineClear, parkSpot, phaseOf, pickTarget, ramInput, type Racer } from '../src/game/policeLogic';
import { RAIL_D, ROAD_HALF_WIDTH } from '../src/config';
import type { SelfState } from '../src/ai/sensors';
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
});
