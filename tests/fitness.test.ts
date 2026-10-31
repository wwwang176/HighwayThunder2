import { describe, it, expect } from 'vitest';
import { fitness, hitsTraffic, isOffRoad } from '../src/ai/fitness';
import { laneCenter } from '../src/road/coords';

describe('fitness', () => {
  it('earlier finishes beat later ones, and any finish beats not finishing', () => {
    const f150 = fitness({ distance: 10000, crashed: false, finishTime: 150 });
    const f200 = fitness({ distance: 10000, crashed: false, finishTime: 200 });
    const none = fitness({ distance: 9999, crashed: false, finishTime: null });
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
});
