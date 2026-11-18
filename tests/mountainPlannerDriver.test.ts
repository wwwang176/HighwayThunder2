import { describe, it, expect } from 'vitest';
import { bend, Centerline, straight } from '../src/road/centerline';
import { MountainDriver } from '../src/ai/mountainDriver';
import { MountainPlannerDriver } from '../src/ai/mountainPlannerDriver';
import { applyMountainNet, MOUNTAIN_NET_INPUTS, MOUNTAIN_NET_LAYERS, mountainNetInputs, quietMountainNet } from '../src/ai/mountainNet';
import { lineAt } from '../src/ai/mountainLine';
import { mulberry32 } from '../src/ai/rng';
import type { SelfState, TrafficBox } from '../src/ai/sensors';
import { STREET_RACER } from '../src/vehicles/cars';
import { KMH } from '../src/config';

const ROAD = new Centerline([...straight(400), ...bend(40, 90, 15), ...straight(300)], { turnBack: true });
const P = STREET_RACER.params;

function onLine(m: MountainDriver, s: number, dv = 0): SelfState {
  const at = lineAt(m.line!, s);
  return { s, d: at.d, yaw: 0, vLong: at.v + dv, vLat: 0, yawRate: 0, speedCap: 300 * KMH };
}

function pair(): { old: MountainDriver; neu: MountainPlannerDriver } {
  const old = new MountainDriver();
  old.setRoad(ROAD, STREET_RACER.ai);
  const neu = new MountainPlannerDriver();
  neu.setRoad(ROAD, STREET_RACER.ai);
  neu.net = null; // (its car's trained network left out: the driver alone)
  return { old, neu };
}

describe('MountainPlannerDriver', () => {
  it('no cars, no net: the same inputs as MountainDriver step by step (on its line, along the bend)', () => {
    const { old, neu } = pair();
    expect(neu.net).toBeNull();
    for (let s = 380; s <= 440; s += 0.3) {
      const a = old.drive(onLine(old, s), [], P);
      const b = neu.drive(onLine(old, s), [], P);
      expect(b.steer).toBe(a.steer);
      expect(b.throttle).toBe(a.throttle);
      expect(b.brake).toBe(a.brake);
    }
  });

  it('a quiet net (its output layer 0) changes nothing', () => {
    const { old, neu } = pair();
    neu.net = quietMountainNet(mulberry32(3));
    for (let s = 380; s <= 440; s += 0.3) {
      const a = old.drive(onLine(old, s), [], P);
      const b = neu.drive(onLine(old, s), [], P);
      expect(b.steer).toBe(a.steer);
      expect(b.throttle).toBe(a.throttle);
    }
  });

  it('a standing car on its line ahead (it going at speed: not a start): its first plan goes beside it', () => {
    const { neu } = pair();
    const self = onLine(neu.inner, 100);
    const ahead: TrafficBox = { id: 7, s: 140, dMin: self.d - 1, dMax: self.d + 1, v: 0, length: 4.4 };
    neu.drive(self, [ahead], P);
    expect(neu.mplan).not.toBeNull();
    expect(Math.abs(neu.mplan!.offsetAt(140))).toBeGreaterThan(1.5);
  });

  it('on the grid behind a car that never sets off (stalled): within half a second of its own launch it plans round it', () => {
    const { neu } = pair();
    const stalled: TrafficBox = { id: -1, s: -3, dMin: 0.88, dMax: 2.88, v: 0, length: 4.4 };
    let self: SelfState = { s: -11, d: 1.88, yaw: 0, vLong: 0, vLat: 0, yawRate: 0, speedCap: 80 };
    neu.drive(self, [stalled], P); // (standing on the grid)
    for (let i = 0; i < 60; i++) {
      self = { ...self, vLong: self.vLong + 4 / 120, s: self.s + self.vLong / 120 };
      neu.drive(self, [stalled], P);
    }
    const p = neu.mplan!;
    const at = (s: number) => neu.inner.pathRefAt(s) + p.offsetAt(s);
    expect(p.blocked || Math.min(at(-5), at(-3), at(-1)) < 0.88 - 1 + 0.1, `${p.blocked} ${[-9, -7, -5, -3, -1, 1].map((s) => at(s).toFixed(2))} s ${self.s.toFixed(2)}`).toBe(true);
  });

  it('stopped mid-race behind a stalled car (not the start): the car ahead is not taken to set off - no full throttle into it', () => {
    const { neu } = pair();
    let self = onLine(neu.inner, 80);
    for (let i = 0; i < 240; i++) neu.drive(self, [], P); // (racing two seconds: past its launch)
    self = { ...self, s: 100, vLong: 0 }; // (then stopped, as after a crash)
    const stalled: TrafficBox = { id: 9, s: 100 + 2.2 + 2.5 + 2.2, dMin: self.d - 1, dMax: self.d + 1, v: 0, length: 4.4 };
    let input = neu.drive(self, [stalled], P);
    for (let i = 0; i < 120; i++) input = neu.drive(self, [stalled], P);
    const p = neu.mplan!;
    expect(p.blocked || Math.abs(p.offsetAt(stalled.s)) > 1 || input.throttle < 0.5).toBe(true);
  });

  it('drifting it carries no plan of before: no speed cap from it (a followed car\'s speed held through the drift)', () => {
    const { neu } = pair();
    const self = onLine(neu.inner, 100);
    const slow: TrafficBox = { id: 7, s: 112, dMin: -4, dMax: 4, v: 5, length: 4.4 };
    neu.drive(self, [slow], P);
    expect(neu.mplan!.blocked).toBe(true);
    (neu.inner as unknown as { mode: string }).mode = 'drift'; // (as if it kicked into a hairpin)
    neu.drive(self, [slow], P);
    expect(neu.inner.external!.vAt(200)).toBe(Infinity);
  });

  it('its `plan` (the game draws it on the road, the I key) is a path by time, as the highway\'s: its path across, its speed, none before it plans', () => {
    const { neu } = pair();
    expect(neu.plan).toBeNull();
    const self = onLine(neu.inner, 100);
    const ahead: TrafficBox = { id: 7, s: 140, dMin: self.d - 1, dMax: self.d + 1, v: 0, length: 4.4 };
    neu.drive(self, [ahead], P);
    const m = neu.mplan!, plan = neu.plan!;
    expect(plan.points.length).toBeGreaterThan(10);
    expect(plan.points[0].s).toBe(m.s0);
    plan.points.forEach((p, i) => {
      expect(p.t).toBeCloseTo(i * 0.1, 9); // (evenly in time: planAt's way)
      if (i > 0) expect(p.s).toBeGreaterThan(plan.points[i - 1].s);
      expect(p.d).toBeCloseTo(neu.inner.pathRefAt(p.s) + m.offsetAt(p.s), 9);
      expect(p.v).toBeLessThanOrEqual(neu.inner.speedAt(p.s) + 1e-9);
    });
    expect(plan.points[plan.points.length - 1].s).toBeGreaterThan(140); // (past the car it goes round)
    expect(neu.plan).toBe(plan); // (made once a plan)
    // (a plan of one station - a kick point right where it is - draws nothing: one point, the drawing threw and froze)
    neu.mplan = { ...m, offsets: new Float64Array(1), vCap: new Float64Array(1) };
    expect(neu.plan).toBeNull();
  });

  it('reset drops the plan (put back elsewhere: not followed from the old place)', () => {
    const { neu } = pair();
    neu.drive(onLine(neu.inner, 100), [], P);
    expect(neu.mplan).not.toBeNull();
    neu.reset(1.8);
    expect(neu.mplan).toBeNull();
  });

  it('the network steers, takes the throttle anywhere from none to more, brakes as hard as it likes; a whisper of an output, or quiet, changes nothing', () => {
    const b = quietMountainNet(mulberry32(5));
    const hidden = MOUNTAIN_NET_LAYERS[MOUNTAIN_NET_LAYERS.length - 2];
    const brakeBias = b.weights.length - 1; // (each output its weights then its bias: the third's last)
    const throttleBias = brakeBias - (hidden + 1);
    const base = { throttle: 0.6, brake: 0, steer: 0.1 };
    const run = () => applyMountainNet(b, new Float32Array(MOUNTAIN_NET_INPUTS), base);
    expect(run()).toEqual(base);
    b.weights[throttleBias] = -0.05; // (a whisper: nothing)
    expect(run().throttle).toBe(0.6);
    b.weights[throttleBias] = -0.6; // (some off: some)
    expect(run().throttle).toBeGreaterThan(0.05);
    expect(run().throttle).toBeLessThan(0.55);
    b.weights[throttleBias] = -5; // (all off)
    expect(run().throttle).toBeLessThan(0.01);
    b.weights[throttleBias] = 5;
    expect(run().throttle).toBeGreaterThan(0.6);
    b.weights[throttleBias] = 0;
    b.weights[brakeBias] = 0.05;
    expect(run().brake).toBe(0);
    b.weights[brakeBias] = 0.6; // (some brake)
    expect(run().brake).toBeGreaterThan(0.05);
    expect(run().brake).toBeLessThan(0.95);
    b.weights[brakeBias] = 5;
    expect(run().brake).toBeGreaterThan(0.99);
  });

  it('mountainNetInputs: finite and the right length at s = -11 (the grid), standing', () => {
    const { neu } = pair();
    const self: SelfState = { s: -11, d: -1.88, yaw: 0, vLong: 0, vLat: 0, yawRate: 0, speedCap: 80 };
    const out = new Float32Array(MOUNTAIN_NET_INPUTS);
    mountainNetInputs(self, { d: (s) => neu.inner.refAt(s), kappa: (s) => neu.inner.refKappa(s) }, ROAD, (s) => neu.inner.roomAt(s), { throttle: 1, brake: 0, steer: 0 }, out);
    expect(MOUNTAIN_NET_LAYERS[0]).toBe(MOUNTAIN_NET_INPUTS);
    expect(Array.from(out).every(Number.isFinite)).toBe(true);
  });
});
