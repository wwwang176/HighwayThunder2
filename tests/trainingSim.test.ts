import { describe, it, expect } from 'vitest';
import { judgeContacts, ownLane } from '../src/ai/trainingSim';
import { FITNESS } from '../src/ai/fitness';
import { laneCenter } from '../src/road/coords';

// The judging rules only; the simulation itself is checked in training/trainingSimChecks.train.ts.

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

