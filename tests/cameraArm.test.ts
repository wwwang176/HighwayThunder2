import { describe, expect, it } from 'vitest';
import { armFollow, armPlace, armReach, CAMERA_ARM } from '../src/render/cameraArm';

const flat = () => 0;
/** A wall (the ground `top` m high) from x = `at` on. */
const wall = (at: number, top: number) => (x: number) => (x >= at ? top : 0);
const pivot = { x: 0, y: 1, z: 0 };

describe('camera arm (the camera kept clear of the ground, not of the road\'s edges)', () => {
  it('nothing in the way: all the way out (off the road too)', () => {
    expect(armReach(pivot, { x: 8, y: 1.3, z: 0 }, flat)).toBe(1);
    expect(armPlace(pivot, { x: 8, y: 1.3, z: 0 }, 1, flat)).toEqual({ x: 8, y: 1.3, z: 0 });
  });

  it('a wall part way: in to short of it, clear of it by CAMERA_ARM.clear', () => {
    const f = armReach(pivot, { x: 8, y: 1.3, z: 0 }, wall(5, 3));
    const p = armPlace(pivot, { x: 8, y: 1.3, z: 0 }, f, wall(5, 3));
    expect(p.x).toBeLessThan(5);
    expect(p.x).toBeGreaterThan(5 - 0.5);
  });

  it('the ground rising under it: in to where it is clear by CAMERA_ARM.clear', () => {
    const slope = (x: number) => Math.max(0, x - 4); // (rising 1 a metre from x = 4)
    const f = armReach(pivot, { x: 8, y: 1.3, z: 0 }, slope);
    const p = armPlace(pivot, { x: 8, y: 1.3, z: 0 }, f, slope);
    expect(p.y - slope(p.x)).toBeGreaterThanOrEqual(CAMERA_ARM.clear - 1e-6);
    expect(p.y - slope(p.x)).toBeLessThan(CAMERA_ARM.clear + 0.1);
  });

  it('blocked even close in: no nearer than CAMERA_ARM.least, lifted clear there', () => {
    const f = armReach(pivot, { x: 8, y: 1.3, z: 0 }, wall(0.5, 3));
    expect(f * 8).toBeCloseTo(CAMERA_ARM.least, 1);
    const p = armPlace(pivot, { x: 8, y: 1.3, z: 0 }, f, wall(0.5, 3));
    expect(p.y).toBeCloseTo(3 + CAMERA_ARM.clear, 6);
  });

  it('in at once (not through the ground), back out over CAMERA_ARM.ease s', () => {
    expect(armFollow(1, 0.4, 1 / 60)).toBe(0.4);
    const back = armFollow(0.4, 1, 1 / 60);
    expect(back).toBeGreaterThan(0.4);
    expect(back).toBeLessThan(0.5);
    expect(armFollow(0.4, 1, 0)).toBe(0.4); // (paused: held)
  });
});
