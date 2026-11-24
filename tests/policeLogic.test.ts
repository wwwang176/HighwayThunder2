import { describe, it, expect } from 'vitest';
import { bustAllowed, isLost, lineClear, parkSpot, phaseOf, pickTarget, ramInput, type Racer } from '../src/game/policeLogic';
import { RAIL_D, ROAD_HALF_WIDTH } from '../src/config';
import type { SelfState } from '../src/ai/sensors';

const P = (s: number, isPlayer = false): Racer => ({ s, d: 0, v: 50, isPlayer });

describe('policeLogic', () => {
  it('target: the player in range first, else the nearest racer', () => {
    expect(pickTarget(1000, [P(1100), P(900, true)], 300)!.isPlayer).toBe(true);
    expect(pickTarget(1000, [P(1100), P(1500, true)], 300)!.s).toBe(1100);
    expect(pickTarget(1000, [P(1400), P(1500, true)], 300)).toBeNull();
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

  it('a bust: racing, a hit (not a scrape), not just after a put-back', () => {
    expect(bustAllowed('racing', 20, 5)).toBe(true);
    expect(bustAllowed('racing', 10, 5)).toBe(false);
    expect(bustAllowed('racing', 20, 1)).toBe(false);
    expect(bustAllowed('finished', 40, 5)).toBe(false); // (past the line: the finish's show)
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
