import { describe, it, expect } from 'vitest';
import { bend, Centerline, straight } from '../src/road/centerline';
import { alignThrottle, driftTurnWant, hairpinRuns, MOUNTAIN_DRIVER, MountainDriver } from '../src/ai/mountainDriver';
import { lineAt } from '../src/ai/mountainLine';
import type { SelfState, TrafficBox } from '../src/ai/sensors';
import { STREET_RACER } from '../src/vehicles/cars';
import { KMH } from '../src/config';

const ROAD = new Centerline([...straight(400), ...bend(40, 90, 15), ...straight(300)], { turnBack: true });
const P = STREET_RACER.params;

function driver(): MountainDriver {
  const m = new MountainDriver();
  m.setRoad(ROAD, STREET_RACER.ai);
  return m;
}

/** The car on the line at s, `dv` m/s off the line's speed there, heading along it. */
function onLine(m: MountainDriver, s: number, dv = 0): SelfState {
  const at = lineAt(m.line!, s);
  return { s, d: at.d, yaw: 0, vLong: at.v + dv, vLat: 0, yawRate: 0, speedCap: 300 * KMH };
}

describe('MountainDriver', () => {
  it('on a straight, on its line, holds the wheel straight', () => {
    const m = driver();
    const self = onLine(m, 150);
    expect(Math.abs(m.drive(self, [], P).steer)).toBeLessThan(0.05);
  });

  it('brakes when faster than its line allows, and drives on when slower', () => {
    const m = driver();
    const over = m.drive(onLine(m, 380, 20 * KMH), [], P);
    expect(over.brake).toBeGreaterThan(0);
    expect(over.throttle).toBe(0);
    const under = m.drive(onLine(m, 380, -20 * KMH), [], P);
    expect(under.throttle).toBeGreaterThan(0);
    expect(under.brake).toBe(0);
  });

  it('steers into a right bend (steer > 0) - its wheel turned no faster than drift.steerRate a second - as a hand turns it)', () => {
    const m = driver();
    const first = m.drive(onLine(m, 420), [], P).steer;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(MOUNTAIN_DRIVER.drift.steerRate / 120 + 1e-9);
    let steer = first;
    for (let i = 0; i < 60; i++) steer = m.drive(onLine(m, 420), [], P).steer;
    expect(steer).toBeGreaterThan(0.05);
  });

  it('a slower car ahead on its line (to one side of it): it aims for the side with more room', () => {
    const m = driver();
    const self = onLine(m, 100);
    const ahead: TrafficBox = { id: 7, s: 120, dMin: self.d + 0.1, dMax: self.d + 2, v: self.vLong - 8, length: 4.4 };
    for (let i = 0; i < 240; i++) m.drive(self, [ahead], P);
    const lineD = lineAt(m.line!, 120).d;
    const roomLeft = ahead.dMin + m.room;
    const roomRight = m.room - ahead.dMax;
    const toward = roomRight > roomLeft ? 1 : -1;
    expect((m.aimD - lineD) * toward).toBeGreaterThan(1.2);
  });

  it('a slower car in the middle of the road (no room either side): it follows, not passes', () => {
    const m = driver();
    const self = onLine(m, 100);
    const w = m.room - 1.5; // (the road 1.5 lanes a side: a car's width either side of it not room enough)
    const ahead: TrafficBox = { id: 7, s: 112, dMin: -w, dMax: w, v: self.vLong - 8, length: 4.4 };
    const input = m.drive(self, [ahead], P);
    expect(input.throttle).toBe(0);
  });

  it('has no `plan` (the game draws a driver\'s `plan`, the planner\'s path, on the road)', () => {
    expect((driver() as unknown as { plan?: unknown }).plan).toBeUndefined();
  });

  it('past the finish it brakes down (the road runs out), whatever speed it is let keep', () => {
    const m = driver();
    const self = { ...onLine(m, ROAD.length + 20), vLong: 40, speedCap: 40 };
    expect(m.drive(self, [], P).brake).toBeGreaterThan(0);
  });

  it('well past the finish it stops (the road runs out 500 m on)', () => {
    const m = driver();
    const self = { ...onLine(m, ROAD.length + 320), vLong: 5, speedCap: 40 };
    const input = m.drive(self, [], P);
    expect(input.throttle).toBe(0);
    expect(input.brake).toBeGreaterThan(0);
  });

  it('the push (falling behind) raises the speed it aims at, up to the grip itself', () => {
    const m = driver();
    m.budget = 0.85;
    const slow = lineAt(m.line!, 430).v;
    m.push = 1;
    expect(m.speedAt(430)).toBeGreaterThan(slow);
  });
});

describe('MountainDriver open to a planner (external offsets, its reference)', () => {
  it('external offsets of 0 and no cap: the same inputs as without (no cars, along the bend)', () => {
    const a = driver();
    const b = driver();
    b.external = { offsetAt: () => 0, vAt: () => 1e9 };
    for (let s = 380; s <= 440; s += 0.3) {
      const ia = a.drive(onLine(a, s), [], P);
      const ib = b.drive(onLine(a, s), [], P);
      expect(ib.steer).toBe(ia.steer);
      expect(ib.throttle).toBe(ia.throttle);
      expect(ib.brake).toBe(ia.brake);
    }
  });

  it('an external offset steers toward it: +1.5 m - its aim 1.5 m right of its reference there', () => {
    const m = driver();
    m.external = { offsetAt: () => 1.5, vAt: () => 1e9 };
    const self = onLine(m, 120);
    m.drive(self, [], P);
    const look = Math.min(MOUNTAIN_DRIVER.lookMax, MOUNTAIN_DRIVER.lookBase + MOUNTAIN_DRIVER.lookTime * self.vLong);
    expect(m.aimD).toBeCloseTo(Math.min(m.roomAt(120 + look), m.refAt(120 + look) + 1.5), 6);
  });

  it('an external speed cap slows it: aimed under its speed, it brakes', () => {
    const m = driver();
    m.external = { offsetAt: () => 0, vAt: () => 5 };
    const input = m.drive(onLine(m, 150), [], P);
    expect(input.throttle).toBe(0);
    expect(input.brake).toBeGreaterThan(0);
  });

  it("refAt(s) is its path with no passing offset: on a straight, the line's d", () => {
    const m = driver();
    m.drive(onLine(m, 150), [], P);
    expect(m.refAt(150)).toBeCloseTo(lineAt(m.line!, 150).d, 9);
  });

  it('refSpeed: the speed it aims at - the line ahead, slower coming to a hairpin than on the straight before', () => {
    const m = driver();
    expect(m.refSpeed(150, 0)).toBeCloseTo(m.speedAt(150 + MOUNTAIN_DRIVER.leadMin), 9);
  });

  it('standing start sliding sideways (vLat 0.5, vLong 1): the throttle is not cut (the slide cut only past drift.minSpeed)', () => {
    const m = driver();
    const self = { ...onLine(m, 5), vLong: 1, vLat: 0.5 };
    expect(m.drive(self, [], P).throttle).toBeGreaterThan(0.9);
  });

  it('standing start 1.5 m off its line: the wheel not on full lock (softer at low speed)', () => {
    const m = driver();
    const self = { ...onLine(m, 5), d: lineAt(m.line!, 5).d + 1.5, vLong: 0.5 };
    let steer = 0;
    for (let i = 0; i < 60; i++) steer = m.drive(self, [], P).steer;
    expect(Math.abs(steer)).toBeLessThan(0.6);
  });
});

describe('drifting round the hairpins (MOUNTAIN_DRIVER.drift)', () => {
  /** A right hairpin (R 20) between straights. */
  const PIN = new Centerline([...straight(300), ...bend(20, 180, 10), ...straight(300)], { turnBack: true });
  const ARC = 20 * Math.PI + 10;
  const D = MOUNTAIN_DRIVER.drift;

  it('finds the hairpins: their tight runs, which way', () => {
    const runs = hairpinRuns(PIN, D.tight);
    expect(runs.length).toBe(1);
    expect(runs[0].dir).toBe(1); // (a right bend)
    expect(runs[0].from).toBeGreaterThan(300);
    expect(runs[0].from).toBeLessThan(300 + 10); // (in its clothoid)
    expect(runs[0].to).toBeGreaterThan(300 + ARC - 10);
    expect(runs[0].to).toBeLessThan(300 + ARC);
    expect(hairpinRuns(ROAD, D.tight).length).toBe(0); // (R 40: not one)
  });

  it('driftTurnWant: how fast its course should turn (rad/s) - round its line as the road bends there, toward it from where it is, damped by how fast it moves across', () => {
    const W = { posGain: 1.5, velGain: 3 };
    expect(driftTurnWant(1 / 20, 0, 0, 20, 0, W)).toBeCloseTo(1, 9); // (on its line, a R 20 bend at 20 m/s)
    expect(driftTurnWant(1 / 20, 2, 2, 18, 0, W)).toBeCloseTo(1, 9); // (its line 2 m in: a tighter circle, R 18)
    expect(driftTurnWant(0, 1, 0, 10, 0, W)).toBeCloseTo(0.15, 9); // (1 m off its line: turned toward it)
    expect(driftTurnWant(0, 0, 0, 10, 1, W)).toBeCloseTo(-0.3, 9); // (moving across at 1 m/s: turned against it)
  });

  it('pulls the handbrake coming into a hairpin at speed, turning in; not on the straight before, nor crawling', () => {
    const m = new MountainDriver();
    m.setRoad(PIN, STREET_RACER.ai);
    const at = (s: number, v: number): SelfState => ({ s, d: lineAt(m.line!, s).d, yaw: 0, vLong: v, vLat: 0, yawRate: 0, speedCap: 300 * KMH });
    const from = hairpinRuns(PIN, D.tight)[0].from;
    expect(m.drive(at(200, 15), [], P).handbrake).toBeFalsy();
    let into = m.drive(at(from - 15 * D.kickEarly + 1, 15), [], P);
    for (let i = 0; i < 18; i++) into = m.drive(at(from - 15 * D.kickEarly + 1, 15), [], P); // (0.15 s: the wheel turning in)
    expect(into.handbrake).toBe(true);
    expect(into.steer).toBeGreaterThan(0.3);
    const slow = new MountainDriver();
    slow.setRoad(PIN, STREET_RACER.ai);
    expect(slow.drive(at(from - 1, 5), [], P).handbrake).toBeFalsy();
  });

  it('kicked into the next hairpin still settling out of the last: done with the last (its straight not held to after this one)', () => {
    const m = new MountainDriver();
    m.setRoad(PIN, STREET_RACER.ai);
    const at = (s: number, v: number): SelfState => ({ s, d: lineAt(m.line!, s).d, yaw: 0, vLong: v, vLat: 0, yawRate: 0, speedCap: 300 * KMH });
    const from = hairpinRuns(PIN, D.tight)[0].from;
    const inner = m as unknown as { settling: boolean; alignTo: number | null };
    inner.settling = true;
    inner.alignTo = PIN.heading(from) + 2.4; // (the last hairpin's straight)
    m.drive(at(from - 15 * D.kickEarly + 1, 15), [], P);
    expect(inner.alignTo).toBeNull();
    expect(inner.settling).toBe(false);
  });
});

describe('alignThrottle', () => {
  const D = { alignGas: 1, alignGasFrom: 0.05, alignGasSpan: 0.25, alignGasLeast: 0.3 };
  it('its nose parallel to the straight: full', () => {
    expect(alignThrottle(0, D)).toBe(1);
    expect(alignThrottle(-0.05, D)).toBe(1);
  });
  it('its nose swung past it either way: less, to alignGasLeast at alignGasFrom + alignGasSpan', () => {
    expect(alignThrottle(0.175, D)).toBeCloseTo(0.65, 5);
    expect(alignThrottle(-0.3, D)).toBeCloseTo(0.3, 5);
    expect(alignThrottle(0.6, D)).toBeCloseTo(0.3, 5);
  });
  it('alignGasSpan 0: alignGas throughout (as before)', () => {
    expect(alignThrottle(0.6, { ...D, alignGasSpan: 0 })).toBe(1);
  });
});

describe('alignThrottle, its slide', () => {
  const D = { alignGas: 1, alignGasFrom: 0.05, alignGasSpan: 0.25, alignGasLeast: 0.3, alignSlideFrom: 0.15, alignSlideSpan: 0.3 };
  it('its nose parallel, still sliding: less, to alignGasLeast at alignSlideFrom + alignSlideSpan', () => {
    expect(alignThrottle(0, D, 0.1)).toBe(1);
    expect(alignThrottle(0, D, -0.3)).toBeCloseTo(0.65, 5);
    expect(alignThrottle(0, D, 0.8)).toBeCloseTo(0.3, 5);
  });
  it('the less of its nose and its slide', () => {
    expect(alignThrottle(0.3, D, 0.3)).toBeCloseTo(0.3, 5);
  });
});
