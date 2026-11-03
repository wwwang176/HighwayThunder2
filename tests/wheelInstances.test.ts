import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WheelInstances } from '../src/vehicles/wheelInstances';

describe('WheelInstances', () => {
  it('out of room it grows (twice as big), its wheels where they were, still one mesh in the scene', () => {
    const scene = new THREE.Scene();
    const pool = new WheelInstances(scene, 4);
    const slots = [0, 1, 2, 3].map(() => pool.alloc());
    const at = new THREE.Matrix4().makeTranslation(1, 2, 3);
    pool.set(slots[2], at);
    const fifth = pool.alloc();
    expect(slots).not.toContain(fifth);
    expect(pool.mesh.count).toBe(8);
    expect(scene.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh)).toEqual([pool.mesh]);
    const m = new THREE.Matrix4();
    pool.mesh.getMatrixAt(slots[2], m);
    expect(m.equals(at)).toBe(true);
    // The rest of the new room is free too.
    const more = [0, 1, 2].map(() => pool.alloc());
    expect(new Set([...slots, fifth, ...more]).size).toBe(8);
  });
});
