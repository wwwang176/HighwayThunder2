import { afterEach, describe, it, expect } from 'vitest';
import { OUR_FRAME, ONCOMING_FRAME, useRoad } from '../src/road/frame';
import { bend, Centerline, straight, STRAIGHT_ROAD } from '../src/road/centerline';
import { laneCenter } from '../src/road/coords';
import { ONCOMING_X } from '../src/config';

describe('RoadFrame', () => {
  it('our carriageway: x = d, z = -s', () => {
    expect(OUR_FRAME.toWorld(100, 2)).toEqual({ x: 2, z: -100 });
    expect(OUR_FRAME.fromWorld(2, -100)).toEqual({ s: 100, d: 2 });
  });

  it('oncoming carriageway runs the other way, its inner lane next to the median', () => {
    const p = ONCOMING_FRAME.toWorld(100, 0);
    expect(p.z).toBe(100);
    expect(p.x).toBe(ONCOMING_X);
    // Their lane 0 (fast lane) is the one nearest our carriageway (larger x).
    expect(ONCOMING_FRAME.toWorld(0, laneCenter(0)).x).toBeGreaterThan(ONCOMING_FRAME.toWorld(0, laneCenter(3)).x);
    const back = ONCOMING_FRAME.fromWorld(p.x, p.z);
    expect(back.s).toBeCloseTo(100);
    expect(back.d).toBeCloseTo(0);
  });

  // On the straight road and on a bent one (both ways), at a few places along it.
  const BENT = new Centerline([...straight(50), ...bend(1600, 30, 150), ...straight(100), ...bend(1800, -20, 150)]);
  afterEach(() => useRoad(STRAIGHT_ROAD));
  const cases = [STRAIGHT_ROAD, BENT].flatMap((line) => [0, 120, 600, -700, 900].map((s) => ({ line, s })));

  it('heading: frame yaw 0 points down the frame, + yaw turns to the frame’s right', () => {
    for (const { line, s } of cases) {
      useRoad(line);
      for (const f of [OUR_FRAME, ONCOMING_FRAME]) {
        const fwd = f.forwardWorld(0, s);
        const h = 1e-3;
        const a = f.toWorld(s, 0);
        const b = f.toWorld(s + h, 0);
        // (its way along: off our middle line the road's length per s is a little more or less)
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        expect(fwd.x).toBeCloseTo((b.x - a.x) / len, 5);
        expect(fwd.z).toBeCloseTo((b.z - a.z) / len, 5);
        const right = f.forwardWorld(Math.PI / 2, s);
        const r = f.toWorld(s, 1);
        expect(right.x).toBeCloseTo(r.x - a.x, 6);
        expect(right.z).toBeCloseTo(r.z - a.z, 6);
        expect(f.yawFromWorldForward(fwd.x, fwd.z, s)).toBeCloseTo(0);
        expect(f.yawFromWorldForward(right.x, right.z, s)).toBeCloseTo(Math.PI / 2);
        // And back from the world.
        const p = f.toWorld(s, 2.5);
        const q = f.fromWorld(p.x, p.z);
        expect(q.s).toBeCloseTo(s, 6);
        expect(q.d).toBeCloseTo(2.5, 6);
        expect(f.speedAlong(fwd.x * 30, fwd.z * 30, s)).toBeCloseTo(30, 9);
      }
    }
  });

  it('curvature: the frame’s heading turning, toward its +d when > 0', () => {
    useRoad(BENT);
    for (const f of [OUR_FRAME, ONCOMING_FRAME])
      for (const s of [120, 600, -120, -600]) {
        // (its heading's change along its own way)
        const h = 1e-3;
        expect(f.curvature(s)).toBeCloseTo((f.heading(s + h) - f.heading(s - h)) / (2 * h), 9);
        // Going straight on from the frame's middle line at yaw 0, the road bending toward +d leaves it to the -d side.
        const a = f.toWorld(s, 0);
        const fwd = f.forwardWorld(0, s);
        const ahead = { x: a.x + fwd.x * 100, z: a.z + fwd.z * 100 };
        const seen = f.fromWorld(ahead.x, ahead.z, s + 100);
        if (Math.abs(f.curvature(s)) > 1e-6) expect(Math.sign(-seen.d)).toBe(Math.sign(f.curvature(s)));
      }
  });

  it('rotationY matches a mesh whose nose is -Z', () => {
    for (const { line, s } of cases) {
      useRoad(line);
      for (const f of [OUR_FRAME, ONCOMING_FRAME]) {
        const ry = f.rotationY(0.2, s);
        // Nose (0,0,-1) rotated about Y by ry.
        const nx = -Math.sin(ry);
        const nz = -Math.cos(ry);
        const fwd = f.forwardWorld(0.2, s);
        expect(nx).toBeCloseTo(fwd.x);
        expect(nz).toBeCloseTo(fwd.z);
      }
    }
  });
});

import { boxToFrame } from '../src/road/frame';
describe('boxToFrame', () => {
  it('a car on our side seen from the oncoming frame', () => {
    // Our car at s=100 in lane 1, heading down our road at 30 m/s.
    const box = { x: laneCenter(1), z: -100, fx: 0, fz: -1, w: 1.8, l: 4.5, vx: 0, vz: -30 };
    const ours = boxToFrame(OUR_FRAME, box);
    expect(ours.s).toBeCloseTo(100);
    expect(ours.v).toBeCloseTo(30);
    expect(ours.length).toBeCloseTo(4.5);
    const onc = boxToFrame(ONCOMING_FRAME, box);
    expect(onc.s).toBeCloseTo(-100);
    expect(onc.v).toBeCloseTo(-30); // coming straight at them
    expect(onc.length).toBeCloseTo(4.5);
  });
});
