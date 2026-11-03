import * as THREE from 'three';
import { unitWheelGeometry } from './models';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * All NPC wheels in one InstancedMesh (one draw call). Slots are allocated per wheel (a twin tyre two); out of
 * room, it grows twice as big (a container truck alone takes 22: 800 ran out with traffic thick with them).
 */
export class WheelInstances {
  private current: THREE.InstancedMesh;
  private free: number[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    capacity = 1200,
  ) {
    this.current = this.make(capacity);
    for (let i = capacity - 1; i >= 0; i--) {
      this.current.setMatrixAt(i, HIDDEN);
      this.free.push(i);
    }
    scene.add(this.current);
  }

  get mesh(): THREE.InstancedMesh {
    return this.current;
  }

  alloc(): number {
    if (this.free.length === 0) this.grow();
    return this.free.pop()!;
  }

  release(i: number): void {
    this.current.setMatrixAt(i, HIDDEN);
    this.free.push(i);
  }

  set(i: number, m: THREE.Matrix4): void {
    this.current.setMatrixAt(i, m);
  }

  commit(): void {
    this.current.instanceMatrix.needsUpdate = true;
  }

  private make(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      unitWheelGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
      capacity,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Twice the room: the wheels so far copied over, the new slots free. */
  private grow(): void {
    const old = this.current;
    const n = old.count;
    const mesh = this.make(n * 2);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array);
    for (let i = n * 2 - 1; i >= n; i--) {
      mesh.setMatrixAt(i, HIDDEN);
      this.free.push(i);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.remove(old);
    old.geometry.dispose();
    (old.material as THREE.Material).dispose();
    old.dispose();
    this.scene.add(mesh);
    this.current = mesh;
  }
}
