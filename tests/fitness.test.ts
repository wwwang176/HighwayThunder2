import { describe, it, expect } from 'vitest';
import { fitness, FITNESS, hitsTraffic, isOffRoad, touching } from '../src/ai/fitness';
import { laneCenter } from '../src/road/coords';
import { ROAD_LENGTH } from '../src/config';

describe('fitness', () => {
  it('earlier finishes beat later ones, and any finish beats not finishing', () => {
    const f150 = fitness({ distance: ROAD_LENGTH, crashed: false, finishTime: FITNESS.timeLimit * 0.5 });
    const f200 = fitness({ distance: ROAD_LENGTH, crashed: false, finishTime: FITNESS.timeLimit * 0.8 });
    const none = fitness({ distance: ROAD_LENGTH - 1, crashed: false, finishTime: null });
    expect(f150).toBeGreaterThan(f200);
    expect(f200).toBeGreaterThan(none);
  });

  it('driving off and crashing early still beats not moving at all', () => {
    expect(fitness({ distance: 250, crashed: true, finishTime: null })).toBeGreaterThan(fitness({ distance: 5, crashed: false, finishTime: null }));
    expect(fitness({ distance: 40, crashed: true, finishTime: null })).toBeGreaterThan(0);
  });

  it('crashing costs about a kilometre', () => {
    expect(fitness({ distance: 5000, crashed: false, finishTime: null })).toBeGreaterThan(fitness({ distance: 5800, crashed: true, finishTime: null }));
    expect(fitness({ distance: 7000, crashed: true, finishTime: null })).toBeGreaterThan(fitness({ distance: 5000, crashed: false, finishTime: null }));
  });
});

describe('crash rules', () => {
  it('leaving our pavement counts', () => {
    expect(isOffRoad(0, 9.2, 0)).toBe(true); // right corners at 10.13
    expect(isOffRoad(0, 9, 0)).toBe(false); // corners at 9.93: still on the shoulder
    expect(isOffRoad(0, -10.5, 0)).toBe(false); // two wheels on the median grass is allowed
    expect(isOffRoad(0, -11.5, 0)).toBe(true); // more than 2 m onto the grass is not
    expect(isOffRoad(0, 8.2, 0.5)).toBe(true); // nose swung out over the edge (corner at ~10.07)
    expect(isOffRoad(0, 8.2, 0)).toBe(false);
  });

  it('touching a vehicle counts', () => {
    const t = [{ s: 3, dMin: laneCenter(1) - 0.9, dMax: laneCenter(1) + 0.9, v: 20, length: 4.6 }];
    expect(hitsTraffic(0, laneCenter(1), 0, t)).toBe(true);
    expect(hitsTraffic(-7, laneCenter(1), 0, t)).toBe(false);
    expect(hitsTraffic(0, laneCenter(2), 0, t)).toBe(false);
  });

  it('light contacts cost a little each, a crash a lot', () => {
    const clean = fitness({ distance: 5000, crashed: false, finishTime: null });
    const twice = fitness({ distance: 5000, crashed: false, finishTime: null, contacts: 2 });
    expect(twice).toBe(clean - 2 * FITNESS.contactPenalty);
    expect(fitness({ distance: 5000, crashed: true, finishTime: null })).toBeLessThan(twice);
  });

  it('lists what the car is touching', () => {
    const t = [1, 2].map((lane) => ({ id: lane, s: 3, dMin: laneCenter(lane) - 1.25, dMax: laneCenter(lane) + 1.25, v: 20, length: 8.5 })); // trucks
    expect(touching(0, laneCenter(1), 0, t).map((x) => x.id)).toEqual([1]);
    expect(touching(0, (laneCenter(1) + laneCenter(2)) / 2, 0, t).map((x) => x.id)).toEqual([1, 2]);
    expect(touching(30, laneCenter(1), 0, t)).toEqual([]);
  });

  it('a car changing lanes into it while it holds its lane is not its doing (in the game it would have waited)', () => {
    const merging = [
      { id: 7, s: 2, dMin: laneCenter(1) - 0.2, dMax: laneCenter(1) + 1.6, v: 25, length: 4.5 }, // sliding across from lane 2
      { id: 7, s: 2, dMin: laneCenter(1) - 0.9, dMax: laneCenter(1) + 0.9, v: 25, length: 4.5, phantom: true }, // its target: our lane
    ];
    expect(touching(0, laneCenter(1), 0, merging).length).toBe(1); // no lane held: it counts
    expect(touching(0, laneCenter(1), 0, merging, 1)).toEqual([]);
    const steady = [{ id: 8, s: 2, dMin: laneCenter(1) - 0.9, dMax: laneCenter(1) + 0.9, v: 25, length: 4.5 }];
    expect(touching(0, laneCenter(1), 0, steady, 1).length).toBe(1); // one that is not changing lanes still counts
  });

  it('the lane a car is about to move into is not a crash', () => {
    const t = [{ s: 3, dMin: laneCenter(1) - 0.9, dMax: laneCenter(1) + 0.9, v: 20, length: 4.6, phantom: true }];
    expect(hitsTraffic(0, laneCenter(1), 0, t)).toBe(false);
  });

  it('traffic from behind passes through it in the lane it holds (or is leaving), not in the one it cuts into', () => {
    const behindIn = (lane: number) => [{ s: -3, dMin: laneCenter(lane) - 0.9, dMax: laneCenter(lane) + 0.9, v: 30, length: 4.6 }];
    const ahead = [{ s: 3, dMin: laneCenter(1) - 0.9, dMax: laneCenter(1) + 0.9, v: 10, length: 4.6 }];
    const line = (laneCenter(1) + laneCenter(2)) / 2; // the line between lanes 1 and 2
    expect(hitsTraffic(0, laneCenter(1), 0, behindIn(1))).toBe(true); // no lane given
    expect(hitsTraffic(0, laneCenter(1), 0, behindIn(1), 1)).toBe(false); // holding lane 1: the other car's doing
    expect(hitsTraffic(0, laneCenter(1), 0, ahead, 1)).toBe(true); // what is in front is always its own business
    // Moving from lane 1 to lane 2: a car coming up lane 1 passes through, one coming up lane 2 was cut off.
    expect(hitsTraffic(0, line - 0.3, 0, behindIn(1))).toBe(true);
    expect(hitsTraffic(0, line - 0.3, 0, behindIn(1), 1)).toBe(false);
    expect(hitsTraffic(0, line + 0.3, 0, behindIn(2), 1)).toBe(true);
  });
});
