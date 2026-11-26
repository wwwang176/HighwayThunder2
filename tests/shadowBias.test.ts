import { describe, expect, it } from 'vitest';
import { depthBias } from '../src/render/shadowBias';

/** A spot light's shadow map's depth (0 at near, 1 at far) of a point `z` m out (three's perspective depth). */
const depth = (z: number, near: number, far: number) => ((z - near) * far) / (z * (far - near));

describe('shadow bias in metres', () => {
  it('is the depth a world offset makes at a distance: as many metres behind there, whatever near and far', () => {
    for (const [near, far, z] of [[1, 120, 20], [0.3, 120, 40], [30, 55, 50], [0.5, 43, 40]] as const) {
      const b = depthBias(0.02, z, near, far);
      expect(b).toBeGreaterThan(0);
      expect(depth(z + 0.02, near, far) - depth(z, near, far)).toBeCloseTo(b, 6);
    }
  });

  it('the same depth bias is far more metres far off with a near plane close to the lamp (why shadows came loose)', () => {
    const b = 0.0004; // (the headlights' first bias)
    const metres = (z: number, near: number, far: number) => (b * z * z * (far - near)) / (near * far);
    expect(metres(40, 0.3, 120)).toBeGreaterThan(2); // (2 m behind a car 40 m ahead)
    expect(depthBias(metres(40, 0.3, 120), 40, 0.3, 120)).toBeCloseTo(b, 9);
  });
});
