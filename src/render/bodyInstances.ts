import * as THREE from 'three';
import { BRAKE_DIM, BRAKE_ON, type VehicleLights } from '../vehicles/models';

const AT = new THREE.Matrix4();
const SPHERE = new THREE.Sphere();

/** One instanced mesh: a geometry in a material, as many times as vehicles show it this frame. */
interface Pool {
  mesh: THREE.InstancedMesh;
  n: number;
}

/** A part of a template: where it sits on the vehicle, its pool (a brake light two: dim and on). */
interface Piece {
  local: THREE.Matrix4;
  pool: Pool;
  on?: Pool;
  role: 'body' | 'L' | 'R' | 'B';
}

interface Template {
  pieces: Piece[];
  bounds: THREE.Sphere; // template space
}

/**
 * The traffic's bodies drawn instanced: each part of a vehicle model (its compacted template's meshes) one
 * InstancedMesh for every vehicle showing it, so draw calls go by kinds of part, not by vehicles (89 cars of
 * 8 parts each were ~700 draws). Refilled every frame (begin, add each vehicle, end), the lights by their state
 * (indicators shown when on, brake lights dim or on); vehicles outside the camera's view left out.
 */
export class BodyInstances {
  private readonly templates = new Map<string, Template>();
  private readonly pools = new Map<string, Pool>();
  private readonly frustum = new THREE.Frustum();
  private cull = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly capacity = 32,
  ) {}

  /** Start a frame; with a camera, vehicles out of its view are left out. */
  begin(camera?: THREE.Camera): void {
    for (const p of this.pools.values()) p.n = 0;
    this.cull = !!camera;
    if (camera) {
      camera.updateMatrixWorld();
      AT.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(AT);
    }
  }

  /** A vehicle of model `key` (its template `root`, the first time) at `matrix`, its lights as `lights`. */
  add(key: string, root: THREE.Object3D, matrix: THREE.Matrix4, lights: VehicleLights): void {
    const t = this.templates.get(key) ?? this.register(key, root);
    if (this.cull && !this.frustum.intersectsSphere(SPHERE.copy(t.bounds).applyMatrix4(matrix))) return;
    const braking = lights.brake.length > 0 && lights.brake[0].material === BRAKE_ON;
    const left = lights.left.length > 0 && lights.left[0].visible;
    const right = lights.right.length > 0 && lights.right[0].visible;
    for (const p of t.pieces) {
      if ((p.role === 'L' && !left) || (p.role === 'R' && !right)) continue;
      const pool = p.role === 'B' && braking ? p.on! : p.pool;
      if (pool.n === pool.mesh.instanceMatrix.count) this.grow(pool);
      pool.mesh.setMatrixAt(pool.n++, AT.multiplyMatrices(matrix, p.local));
    }
  }

  end(): void {
    for (const p of this.pools.values()) {
      p.mesh.count = p.n; // (drawn: this frame's, not its whole room)
      p.mesh.visible = p.n > 0;
      if (p.n === 0) continue;
      const m = p.mesh.instanceMatrix;
      m.clearUpdateRanges();
      m.addUpdateRange(0, p.n * 16);
      m.needsUpdate = true;
    }
  }

  private register(key: string, root: THREE.Object3D): Template {
    root.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const pieces: Piece[] = [];
    const box = new THREE.Box3();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const role = (m.userData.role as Piece['role'] | undefined) ?? 'body';
      const local = new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld);
      const material = m.material as THREE.Material;
      const pool = this.pool(m.geometry, role === 'B' ? BRAKE_DIM : material, m.castShadow);
      pieces.push({ local, pool, on: role === 'B' ? this.pool(m.geometry, BRAKE_ON, m.castShadow) : undefined, role });
      m.geometry.computeBoundingBox();
      box.union(m.geometry.boundingBox!.clone().applyMatrix4(local));
    });
    const t = { pieces, bounds: box.getBoundingSphere(new THREE.Sphere()) };
    this.templates.set(key, t);
    return t;
  }

  private pool(geometry: THREE.BufferGeometry, material: THREE.Material, castShadow: boolean): Pool {
    const key = `${geometry.uuid}|${material.uuid}|${castShadow}`;
    let p = this.pools.get(key);
    if (!p) {
      p = { mesh: this.make(geometry, material, castShadow, this.capacity), n: 0 };
      this.pools.set(key, p);
      this.scene.add(p.mesh);
    }
    return p;
  }

  private make(geometry: THREE.BufferGeometry, material: THREE.Material, castShadow: boolean, room: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, room);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = castShadow;
    mesh.frustumCulled = false; // (culled by vehicle in add)
    mesh.visible = false;
    return mesh;
  }

  /** Twice the room, this frame's instances so far copied over. */
  private grow(p: Pool): void {
    const old = p.mesh;
    const mesh = this.make(old.geometry, old.material as THREE.Material, old.castShadow, old.instanceMatrix.count * 2);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array);
    this.scene.remove(old);
    old.dispose(); // (its geometry and material stay: shared with the templates)
    this.scene.add(mesh);
    p.mesh = mesh;
  }
}
