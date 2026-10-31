import * as THREE from 'three';
import { unitWheelGeometry } from './models';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** All NPC wheels in one InstancedMesh (one draw call). Slots are allocated per wheel. */
export class WheelInstances {
  readonly mesh: THREE.InstancedMesh;
  private free: number[] = [];

  constructor(scene: THREE.Scene, capacity = 800) {
    this.mesh = new THREE.InstancedMesh(
      unitWheelGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
      capacity,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    for (let i = capacity - 1; i >= 0; i--) {
      this.mesh.setMatrixAt(i, HIDDEN);
      this.free.push(i);
    }
    scene.add(this.mesh);
  }

  alloc(): number {
    const i = this.free.pop();
    if (i === undefined) throw new Error('WheelInstances: out of capacity');
    return i;
  }

  release(i: number): void {
    this.mesh.setMatrixAt(i, HIDDEN);
    this.free.push(i);
  }

  set(i: number, m: THREE.Matrix4): void {
    this.mesh.setMatrixAt(i, m);
  }

  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
