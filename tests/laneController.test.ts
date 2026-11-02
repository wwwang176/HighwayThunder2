import { describe, it, expect } from 'vitest';
import { LaneController } from '../src/ai/laneController';
import { laneCenter } from '../src/road/coords';

// The controller's bookkeeping; it steering the real car is checked in training/laneControllerSim.train.ts.

describe('LaneController', () => {
  it('refuses lanes that do not exist and a new change while one is under way', () => {
    const lc = new LaneController(0);
    expect(lc.start(-1, laneCenter(0))).toBe(false);
    expect(new LaneController(3).start(4, laneCenter(3))).toBe(false);
    expect(lc.fromLane).toBe(0);
    expect(lc.start(1, laneCenter(0))).toBe(true);
    expect(lc.start(2, laneCenter(0))).toBe(false);
    expect(lc.targetLane).toBe(1);
    expect(lc.fromLane).toBe(0); // the lane it is leaving
    lc.update(5);
    expect(lc.fromLane).toBe(1); // done: the lane it holds
  });

  it('re-syncs to the lane the car is in after it was moved (reset, respawn)', () => {
    const lc = new LaneController(0);
    lc.sync(laneCenter(3));
    expect(lc.targetLane).toBe(3);
    expect(lc.changing).toBe(false);
  });
});
