import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { blurAmount, motionCenter } from '../src/render/speedBlur';

const P = { from: 120, full: 300, strength: 0.05, nitro: 1.5 };

describe('blurAmount', () => {
  it('none up to `from` km/h, rising to `strength` at `full`, more with the nitro', () => {
    expect(blurAmount(100, false, P)).toBe(0);
    expect(blurAmount(210, false, P)).toBeCloseTo(0.025);
    expect(blurAmount(400, false, P)).toBeCloseTo(0.05);
    expect(blurAmount(210, true, P)).toBeCloseTo(0.0375);
  });
});

describe('motionCenter', () => {
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 1000);
  camera.position.set(0, 2, 0);
  camera.lookAt(0, 2, -10);
  camera.updateMatrixWorld();

  it('going where the camera looks: the middle of the screen', () => {
    const c = motionCenter(camera, new THREE.Vector3(0, 0, -50))!;
    expect(c.x).toBeCloseTo(0.5);
    expect(c.y).toBeCloseTo(0.5);
  });

  it('sliding to the right of where it looks: right of the middle', () => {
    const c = motionCenter(camera, new THREE.Vector3(10, 0, -50))!;
    expect(c.x).toBeCloseTo(0.5 + (0.2 / (2 * Math.tan(Math.PI / 6))) / 2); // (tan 11.3 deg over the half-width tan, 2:1)
    expect(c.y).toBeCloseTo(0.5);
  });

  it('going backwards (or standing): none', () => {
    expect(motionCenter(camera, new THREE.Vector3(0, 0, 30))).toBeNull();
    expect(motionCenter(camera, new THREE.Vector3(0, 0, 0))).toBeNull();
  });
});
