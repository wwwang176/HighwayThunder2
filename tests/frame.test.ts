import { describe, it, expect } from 'vitest';
import { OUR_FRAME, ONCOMING_FRAME } from '../src/road/frame';
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

  it('heading: frame yaw 0 points down the frame, + yaw turns to the frame’s right', () => {
    for (const f of [OUR_FRAME, ONCOMING_FRAME]) {
      const fwd = f.forwardWorld(0);
      const a = f.toWorld(0, 0);
      const b = f.toWorld(1, 0);
      expect(fwd.x).toBeCloseTo(b.x - a.x);
      expect(fwd.z).toBeCloseTo(b.z - a.z);
      const right = f.forwardWorld(Math.PI / 2);
      const r = f.toWorld(0, 1);
      expect(right.x).toBeCloseTo(r.x - a.x);
      expect(right.z).toBeCloseTo(r.z - a.z);
      expect(f.yawFromWorldForward(fwd.x, fwd.z)).toBeCloseTo(0);
      expect(f.yawFromWorldForward(right.x, right.z)).toBeCloseTo(Math.PI / 2);
    }
  });

  it('rotationY matches a mesh whose nose is -Z', () => {
    for (const f of [OUR_FRAME, ONCOMING_FRAME]) {
      const ry = f.rotationY(0.2);
      // Nose (0,0,-1) rotated about Y by ry.
      const nx = -Math.sin(ry);
      const nz = -Math.cos(ry);
      const fwd = f.forwardWorld(0.2);
      expect(nx).toBeCloseTo(fwd.x);
      expect(nz).toBeCloseTo(fwd.z);
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
