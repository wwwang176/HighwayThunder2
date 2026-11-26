import { describe, it, expect } from 'vitest';
import { coursePlan } from '../src/ai/coursePlanner';
import type { PlanEgo, PreviousPlan } from '../src/ai/planner';
import { ROAD_HALF_WIDTH } from '../src/config';

describe('coursePlan on the shoulder', () => {
  // On the right shoulder at 30 m/s, its last plan along it: an empty road, nothing to go round.
  const d = 8.6;
  const ego: PlanEgo = { s: 0, d, v: 30, speedCap: 40, halfWidth: 1, halfLength: 2.4 };
  const previous: PreviousPlan = {
    plan: { points: Array.from({ length: 25 }, (_, i) => ({ t: i * 0.25, s: 30 * i * 0.25, d, v: 30 })) },
    age: 0,
  };
  const last = (p: ReturnType<typeof coursePlan>) => p.points[p.points.length - 1];

  it('a police car (ego.shoulder) keeps to it as to a lane: no cost out there (the user\'s call: it may use it freely)', () => {
    const p = coursePlan({ ...ego, shoulder: true }, [], previous);
    expect(last(p).d).toBeGreaterThan(ROAD_HALF_WIDTH);
  });

  it('a racer out there heads back onto the paved road (it costs them)', () => {
    const p = coursePlan(ego, [], previous);
    expect(last(p).d).toBeLessThanOrEqual(ROAD_HALF_WIDTH);
  });
});
