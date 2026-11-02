import { describe, it, expect } from 'vitest';
import { judgeContacts, ownLane } from '../src/ai/trainingSim';
import { FITNESS } from '../src/ai/fitness';
import { laneCenter } from '../src/road/coords';

// The judging rules only; the simulation itself is checked in training/trainingSimChecks.train.ts.

describe('judgeContacts (light contact is allowed)', () => {
  // A car (4.4 x 1.86) beside it, 5 cm into its side; and right behind it, 10 cm into its tail.
  const box = (id: number, v: number) => ({ id, s: 0, dMin: 0, dMax: 1, v, length: 4.5 });
  const beside = (vS: number, vD: number) => ({ s: 0, d: 1.88, yaw: 0, vS, vD });
  const behind = (vS: number) => ({ s: -4.35, d: 0.5, yaw: 0, vS, vD: 0 });

  it('a light touch is counted once per contact, not per step, and is not a crash', () => {
    const open = new Map<number, number>();
    expect(judgeContacts([box(1, 30)], beside(32, 0.5), 1, open)).toBe(1);
    expect(judgeContacts([box(1, 30)], beside(32, 0.5), 1.1, open)).toBe(0); // same contact going on
    expect(judgeContacts([], beside(32, 0), 1.2, open)).toBe(0); // over
    expect(judgeContacts([box(1, 30)], beside(32, 0.5), 2, open)).toBe(1); // a new one
  });

  it('brushing a side while passing much faster is a scrape: only the sideways speed counts', () => {
    expect(judgeContacts([box(1, 30)], beside(45, 1), 1, new Map())).toBe(1); // 54 km/h faster, 3.6 km/h sideways
  });

  it('a hard hit is a crash, and so is staying inside another car', () => {
    expect(judgeContacts([box(1, 20)], behind(30), 1, new Map())).toBe('crash'); // rear-end 36 km/h faster
    expect(judgeContacts([box(1, 20)], behind(21), 1, new Map())).toBe(1); // a nudge at 3.6 km/h
    expect(judgeContacts([box(1, 30)], beside(30, 5), 1, new Map())).toBe('crash'); // swiped at 18 km/h sideways
    const open = new Map<number, number>();
    judgeContacts([box(1, 30)], beside(31, 0), 1, open);
    expect(judgeContacts([box(1, 30)], beside(31, 0), 1 + FITNESS.maxContactTime + 0.01, open)).toBe('crash');
  });
});

describe('ownLane', () => {
  it('the lane it is settled in; none while moving across or between lanes', () => {
    expect(ownLane(laneCenter(2) + 0.2, 0.3)).toBe(2);
    expect(ownLane(laneCenter(2), 2)).toBeNull();
    expect(ownLane((laneCenter(1) + laneCenter(2)) / 2, 0)).toBeNull();
  });
});

