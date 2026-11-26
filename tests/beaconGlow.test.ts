import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BeaconGlow, MAX_GLOWS } from '../src/render/beaconGlow';

describe('beaconGlow', () => {
  const light = { intensity: 120, distance: 30, decay: 1.6 };

  it('takes the light bars as point lights (colour by intensity), at most MAX_GLOWS, none once cleared', () => {
    const g = new BeaconGlow();
    const at = Array.from({ length: MAX_GLOWS + 2 }, (_, i) => new THREE.Vector3(i, 1.5, -i * 10));
    g.set(at, at.length, 0xffffff, light);
    expect(g.uniforms.glowCount.value).toBe(MAX_GLOWS);
    expect(g.uniforms.glowPos.value[1].toArray()).toEqual([1, 1.5, -10]);
    expect(g.uniforms.glowColor.value.r).toBeCloseTo(120);
    expect(g.uniforms.glowCutoff.value).toBe(30);
    expect(g.uniforms.glowDecay.value).toBe(1.6);
    g.set(at, 1, 0xffffff, light);
    expect(g.uniforms.glowCount.value).toBe(1);
    g.clear();
    expect(g.uniforms.glowCount.value).toBe(0);
  });
});
