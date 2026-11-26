import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BeaconGlow, MAX_GLOWS } from '../src/render/beaconGlow';

describe('beaconGlow', () => {
  const light = { intensity: 120, distance: 30, decay: 1.6 };
  const shade = { roof: { y: 1.12, x: 0.7, z0: -0.35, z1: 1.9 }, body: { y: 0.62, x: 1.05, z0: -2, z1: 2.4 }, soft: 0.12 };

  it('takes the light bars as point lights (colour by intensity), each with its car, at most MAX_GLOWS, none once cleared', () => {
    const g = new BeaconGlow();
    expect(g.uniforms.glowDecay.value).toBe(-1); // (no point light's till set: none left out of the ground)
    const spots = Array.from({ length: MAX_GLOWS + 2 }, (_, i) => ({
      pos: new THREE.Vector3(i, 1.5, -i * 10),
      local: new THREE.Vector3(0.35, 1.48, 0.29),
      inv: new THREE.Matrix4().makeTranslation(-i, 0, i * 10),
    }));
    g.set(spots, spots.length, 0xffffff, light, shade);
    const u = g.uniforms;
    expect(u.glowCount.value).toBe(MAX_GLOWS);
    expect(u.glowPos.value[1].toArray()).toEqual([1, 1.5, -10]);
    expect(u.glowLocal.value[1].toArray()).toEqual([0.35, 1.48, 0.29]);
    expect(new THREE.Vector3(1, 1.5, -10).applyMatrix4(u.glowInv.value[1]).toArray()).toEqual([0, 1.5, 0]);
    expect(u.glowColor.value.r).toBeCloseTo(120);
    expect(u.glowCutoff.value).toBe(30);
    expect(u.glowDecay.value).toBe(1.6);
    expect(u.glowRoof.value.toArray()).toEqual([1.12, 0.7, -0.35, 1.9]);
    expect(u.glowBody.value.toArray()).toEqual([0.62, 1.05, -2, 2.4]);
    g.set(spots, 1, 0xffffff, light, shade);
    expect(u.glowCount.value).toBe(1);
    g.clear();
    expect(u.glowCount.value).toBe(0);
  });
});
