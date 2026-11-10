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
    const a = planAt(p, p.points[1].t / 2);
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

  it('nothing until it is needed, then the braking it needs: late and hard', () => {
    // Closing 25 m/s on a car straight ahead: needs 25² / (2 · room) m/s².
    const ahead = (room: number) => [{ id: 1, s: 2.2 + 1.5 + room + 2.25, dMin: laneCenter(1) - 0.925, dMax: laneCenter(1) + 0.925, v: 25, length: 4.5 }];
    const me = { ...self, d: laneCenter(1), vLong: 50 };
    expect(emergencyBrake(me, ahead(40))).toBe(0); // needs 7.8 m/s²: not yet
    const b = emergencyBrake(me, ahead(32)); // needs 9.8 m/s²
    expect(b).toBeGreaterThan(0.85); // ~9.8 of the ~11 a full brake gives
    expect(emergencyBrake(me, ahead(20))).toBe(1);
  });

  it('not for a car it is swerving clear of before it gets there', () => {
    // Moving right at 2 m/s: clear of the 0.3 m overlap in 0.15 s, while closing 20 m/s eats 3 of the 12 m.
    expect(emergencyBrake({ ...self, vLat: 2 }, [slow])).toBe(0);
    // Moving toward it: no such luck.
    expect(emergencyBrake({ ...self, vLat: -2 }, [slow])).toBeGreaterThan(0.5);
  });

  // A plan with its line now at the car's d + `from`, holding it 0.25 s, then moving `move` m right in 0.25 s.
  const right = (from: number, move = 1.5) => ({
    plan: { points: [{ t: 0, s: 0, d: self.d + from, v: 45 }, { t: 0.25, s: 11.25, d: self.d + from, v: 45 }, { t: 0.5, s: 22.5, d: self.d + from + move, v: 45 }, { t: 8, s: 360, d: self.d + from + move, v: 45 }] },
    age: 0,
  });

  it('not for a car its plan takes it past: where the plan has it when it gets there is clear', () => {
    // Not moving yet (straight on it overlaps), but the plan is 1.2 m clear of it by then (12 m at 20 m/s: 0.6 s).
    expect(emergencyBrake(self, [slow])).toBeGreaterThan(0.5);
    expect(emergencyBrake(self, [slow], 0, [right(0), right(0)])).toBe(0);
  });

  it('only when the plans before it agree: one changing its mind is not believed', () => {
    expect(emergencyBrake(self, [slow], 0, [right(0)])).toBeGreaterThan(0.5); // one plan alone
    expect(emergencyBrake(self, [slow], 0, [right(0), right(0, 0)])).toBeGreaterThan(0.5); // the one before stayed put
  });

  it('wholly behind the car it brakes as ever, whatever the plans say', () => {
    const behind = { ...slow, dMin: self.d - 0.925, dMax: self.d + 0.925 };
    expect(emergencyBrake(self, [behind], 0, [right(0, 3), right(0, 3)])).toBeGreaterThan(0.5);
  });

  it('counting how far off the plan it is now', () => {
    // The plan's line passes it 0.62 m clear, but the car is 0.9 m left of that line: moving the 0.5 m the plan does
    // it passes only 0.2 m clear - under pathMargin.
    expect(emergencyBrake(self, [slow], 0, [right(0.9, 0.5), right(0.9, 0.5)])).toBeGreaterThan(0.5);
    expect(emergencyBrake(self, [slow], 0, [right(0, 1.4), right(0, 1.4)])).toBe(0); // on the line, 1.4 m: 1.1 m clear
  });

  it('counting the sideways speed it lags the plan by', () => {
    // The plan already moving right at 3 m/s, the car not yet: 0.9 m short by the time it gets there.
    const moving = { plan: { points: [{ t: 0, s: 0, d: self.d, v: 45 }, { t: 0.5, s: 22.5, d: self.d + 1.5, v: 45 }, { t: 8, s: 360, d: self.d + 1.5, v: 45 }] }, age: 0 };
    expect(emergencyBrake(self, [slow], 0, [moving, moving])).toBeGreaterThan(0.5);
    expect(emergencyBrake({ ...self, vLat: 3 }, [slow], 0, [moving, moving])).toBe(0); // keeping up
  });

  it('believes no plan it is well off (or sliding)', () => {
    expect(emergencyBrake(self, [slow], 0, [right(-1.2), right(-1.2)])).toBeGreaterThan(0.5); // its line 1.2 m right of the car
    expect(emergencyBrake({ ...self, yaw: -0.4 }, [slow], 0, [right(0), right(0)])).toBeGreaterThan(0.5);
  });

  it('once braking it holds on down to a lower need', () => {
    const me = { ...self, d: laneCenter(1), vLong: 50 };
    const ahead = [{ id: 1, s: 2.2 + 1.5 + 40 + 2.25, dMin: laneCenter(1) - 0.925, dMax: laneCenter(1) + 0.925, v: 25, length: 4.5 }];
    expect(emergencyBrake(me, ahead)).toBe(0); // needs 7.8 m/s²
    expect(emergencyBrake(me, ahead, 0, [], 9.5 * 0.6)).toBeCloseTo(7.8 / 11, 1);
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
