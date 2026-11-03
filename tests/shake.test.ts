import { describe, expect, it } from 'vitest';
import { ShakeManager } from '../src/render/shake';

const SIDE = { x: 1, y: 0, z: 0 };

describe('camera shake', () => {
  it('a shake smaller than what is left of the one going is dropped; a bigger one takes over', () => {
    const s = new ShakeManager();
    expect(s.add({ dir: SIDE, amplitude: 0.2, frequency: 10, seconds: 0.4, wave: 'noise' })).toBe(true);
    s.update(0.2); // half way: half of it left
    expect(s.level()).toBeCloseTo(0.1);
    expect(s.add({ dir: SIDE, amplitude: 0.09, frequency: 6, seconds: 0.3, wave: 'sine' })).toBe(false);
    expect(s.add({ dir: SIDE, amplitude: 0.12, frequency: 6, seconds: 0.3, wave: 'sine' })).toBe(true);
    expect(s.level()).toBeCloseTo(0.12);
  });

  it('a sine swings along its direction from rest and is gone after its seconds', () => {
    const s = new ShakeManager();
    s.add({ dir: { x: 0, y: 0, z: -2 }, amplitude: 0.1, frequency: 5, seconds: 0.25, wave: 'sine' });
    expect(s.offset().z).toBeCloseTo(0); // from rest: no jump
    s.update(0.05); // a quarter swing, 0.8 of it left
    const o = s.offset();
    expect(o.z).toBeCloseTo(-0.1 * 0.8);
    expect(o.x).toBeCloseTo(0);
    s.update(0.2);
    expect(s.level()).toBe(0);
    expect(s.offset()).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('a rumble (set each frame) shakes up and down and sways across the road, and gives way to a bigger shake', () => {
    const s = new ShakeManager();
    let up = 0;
    let x = 0;
    let z = 0;
    let roll = 0;
    for (let i = 0; i < 30; i++) {
      s.rumble(0.02, 15);
      s.update(1 / 60);
      const o = s.offset();
      expect(Math.hypot(o.x, o.y, o.z)).toBeLessThanOrEqual(0.02 * 1.5);
      up += Math.abs(o.y);
      x += Math.abs(o.x);
      z += Math.abs(o.z);
      roll = Math.max(roll, Math.abs(s.roll()));
    }
    expect(up).toBeGreaterThan(0);
    expect(x).toBeGreaterThan(z); // across the road more than along it
    expect(roll).toBeGreaterThan(0.002); // and the camera tilts with the sway (a sideways move alone is hardly seen)
    expect(roll).toBeLessThan(0.03);
    s.add({ dir: SIDE, amplitude: 0.2, frequency: 6, seconds: 0.3, wave: 'sine' });
    s.rumble(0.02, 15);
    s.update(1 / 60);
    const sine = 0.2 * (1 - 1 / 60 / 0.3) * Math.sin((2 * Math.PI * 6) / 60);
    expect(s.offset()).toEqual({ x: expect.closeTo(sine), y: 0, z: 0 }); // the rumble gives way
    s.rumble(0, 15);
    s.stop();
    s.update(1 / 60);
    expect(s.offset()).toEqual({ x: 0, y: 0, z: 0 }); // off the grass: still
    expect(s.roll()).toBe(0);
  });

  it('noise stays within its swing, mostly along its direction', () => {
    const s = new ShakeManager();
    s.add({ dir: SIDE, amplitude: 0.1, frequency: 12, seconds: 1, wave: 'noise' });
    let along = 0;
    let across = 0;
    for (let i = 0; i < 30; i++) {
      s.update(1 / 60);
      const o = s.offset();
      expect(Math.hypot(o.x, o.y, o.z)).toBeLessThanOrEqual(0.1 * 1.2);
      along += Math.abs(o.x);
      across += Math.abs(o.y) + Math.abs(o.z);
    }
    expect(along).toBeGreaterThan(across);
  });
});
