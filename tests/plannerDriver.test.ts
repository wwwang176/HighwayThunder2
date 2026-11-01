import { describe, it, expect } from 'vitest';
import { planAt, plan, Plan, PlanEgo, PreviousPlan } from '../src/ai/planner';
import { emergencyBrake, PlannerDriver, PlanSource } from '../src/ai/plannerDriver';
import type { TrafficBox } from '../src/ai/sensors';
import { KMH } from '../src/config';
import { laneCenter } from '../src/road/coords';

// The driver's decisions only; it driving the real car is checked in training/plannerDriverSim.train.ts.

describe('planAt', () => {
  it('interpolates between plan points', () => {
    const p = plan({ s: 0, d: laneCenter(1), v: 20, speedCap: 300 * KMH }, []);
    const a = planAt(p, 0.25);
    expect(a.s).toBeGreaterThan(p.points[0].s);
    expect(a.s).toBeLessThan(p.points[1].s);
    expect(planAt(p, 99).s).toBe(p.points[p.points.length - 1].s);
  });
});

/** A PlanSource that answers a few steps late, like a Web Worker. */
class LateSource implements PlanSource {
  private queue: { due: number; stamp: number; plan: Plan }[] = [];
  private steps = 0;
  requests = 0;
  constructor(private readonly delaySteps: number) {}
  get busy() {
    return this.queue.length > 0;
  }
  request(stamp: number, ego: PlanEgo, traffic: TrafficBox[], previous: PreviousPlan | null): void {
    this.requests++;
    this.queue.push({ due: this.steps + this.delaySteps, stamp, plan: plan(ego, traffic, previous) });
  }
  take() {
    this.steps++;
    if (!this.queue.length || this.queue[0].due > this.steps) return null;
    return this.queue.shift()!;
  }
}

describe('PlannerDriver with plans worked out elsewhere', () => {
  it('drops an answer for the car as it was before a reset', () => {
    const source = new LateSource(3);
    const ai = new PlannerDriver(source);
    const self = { s: 0, d: laneCenter(1), yaw: 0, vLong: 30, vLat: 0, yawRate: 0, speedCap: 80 };
    ai.drive(self, []);
    ai.reset();
    ai.drive({ ...self, s: 500, d: laneCenter(3) }, []);
    ai.drive({ ...self, s: 500, d: laneCenter(3) }, []);
    expect(ai.plan === null || ai.plan.points[0].s === 500).toBe(true);
  });
});

describe('emergencyBrake', () => {
  // A car 12 m ahead (bumper to bumper) 72 km/h slower, overlapping 0.3 m of our left side.
  const self = { s: 0, d: laneCenter(1) + 1.6, yaw: 0, vLong: 45, vLat: 0, yawRate: 0, speedCap: 80 };
  const slow = { id: 1, s: 2.2 + 12 + 2.25, dMin: laneCenter(1) - 0.925, dMax: self.d - 0.93 + 0.3, v: 25, length: 4.5 };

  it('brakes hard for what is right ahead and not getting out of the way', () => {
    expect(emergencyBrake(self, [slow])).toBeGreaterThan(0.5);
  });

  it('not for a car it is swerving clear of before it gets there', () => {
    // Moving right at 2 m/s: clear of the 0.3 m overlap in 0.15 s, while closing 20 m/s eats 3 of the 12 m.
    expect(emergencyBrake({ ...self, vLat: 2 }, [slow])).toBe(0);
    // Moving toward it: no such luck.
    expect(emergencyBrake({ ...self, vLat: -2 }, [slow])).toBeGreaterThan(0.5);
  });
});

describe('PlannerDriver', () => {
  it('an engine boost is planned with and used (not cancelled by the pedal controller)', () => {
    const self = { s: 0, d: laneCenter(1), yaw: 0, vLong: 50, vLat: 0, yawRate: 0, speedCap: 83.3 };
    const plain = new PlannerDriver();
    const boosted = new PlannerDriver();
    boosted.accelScale = 1.25;
    plain.drive(self, []);
    boosted.drive(self, []);
    const gain = (d: PlannerDriver) => d.plan!.points[1].v - d.plan!.points[0].v;
    expect(gain(boosted)).toBeCloseTo(gain(plain) * 1.25, 5);
    expect(boosted.drive(self, []).throttle).toBe(1);
  });

  it('flat out means the throttle all the way down, not most of the way', () => {
    const ai = new PlannerDriver();
    const self = { s: 0, d: laneCenter(1), yaw: 0, vLong: 30, vLat: 0, yawRate: 0, speedCap: 83.3 };
    expect(ai.drive(self, []).throttle).toBe(1);
    expect(new PlannerDriver().drive({ ...self, vLong: 60 }, []).throttle).toBe(1); // 216 km/h: still flat out
  });

});
