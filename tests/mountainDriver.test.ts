import { describe, it, expect } from 'vitest';
import { bend, Centerline, straight } from '../src/road/centerline';
import { MountainDriver } from '../src/ai/mountainDriver';
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

  it('steers into a right bend (steer > 0)', () => {
    const m = driver();
    expect(m.drive(onLine(m, 420), [], P).steer).toBeGreaterThan(0.05);
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
