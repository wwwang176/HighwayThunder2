import * as THREE from 'three';
import { BRAKE_DIM, BRAKE_ON, type VehicleLights } from '../vehicles/models';

/** The layer only shadow-casting lights' cameras see (BodyInstances' shadow casters; the view's camera doesn't). */
export const SHADOW_LAYER = 1;

const AT = new THREE.Matrix4();
const SPHERE = new THREE.Sphere();

/** One instanced mesh: a geometry in a material, as many times as vehicles show it this frame. */
interface Pool {
  mesh: THREE.InstancedMesh;
  n: number;
}

/**
 * A part of a template: where it sits on the vehicle, its pool (a brake light two: dim and on), and its shadow
 * casters' (a part casting shadows).
 */
interface Piece {
  local: THREE.Matrix4;
  pool: Pool;
  on?: Pool;
  shadow?: Pool;
  role: 'body' | 'L' | 'R' | 'B';
}

interface Template {
  pieces: Piece[];
  bounds: THREE.Sphere; // template space
}

/**
 * Vehicles drawn instanced: each part of a vehicle model (its compacted template's meshes) one InstancedMesh for
 * every vehicle showing it, so draw calls go by kinds of part, not by vehicles (89 cars of 8 parts each were ~700
 * draws). Refilled every frame (begin, add each vehicle, end), the lights by their state (indicators shown when
 * on, brake lights dim or on). Culled by vehicle: drawn if in the camera's view; casting shadows (a second set of
 * pools, on SHADOW_LAYER: only the shadow-casting lights see it) if in such a light's reach - an InstancedMesh
 * isn't culled by the lights itself, and every one in view drew into each headlight's shadow map.
 */
export class BodyInstances {
  private readonly templates = new Map<string, Template>();
  private readonly pools = new Map<string, Pool>();
  private readonly frustum = new THREE.Frustum();
  private readonly lightFrusta: THREE.Frustum[] = [];
  private cull = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly capacity = 32,
  ) {}

  /**
   * Start a frame; with a camera, vehicles out of its view are left out. Vehicles cast shadows only for
   * `shadowLights` (their shadow cameras made to see SHADOW_LAYER), where those reach.
   */
  begin(camera?: THREE.Camera, shadowLights: THREE.SpotLight[] = []): void {
    for (const p of this.pools.values()) p.n = 0;
    this.cull = !!camera;
    if (camera) {
      camera.updateMatrixWorld();
      AT.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(AT);
    }
    this.lightFrusta.length = 0;
    for (const l of shadowLights) {
      if (!l.castShadow || !l.visible) continue;
      l.updateWorldMatrix(true, false);
      l.target.updateWorldMatrix(true, false);
      l.shadow.updateMatrices(l);
      l.shadow.camera.layers.enable(SHADOW_LAYER);
      this.lightFrusta.push(l.shadow.getFrustum());
    }
  }

  /**
   * A vehicle of model `key` (its template `root`, the first time) at `matrix`, its lights as `lights`.
   * Whether it is drawn at all (in view, or casting a shadow).
   */
  add(key: string, root: THREE.Object3D, matrix: THREE.Matrix4, lights: VehicleLights): boolean {
    const t = this.templates.get(key) ?? this.register(key, root);
    SPHERE.copy(t.bounds).applyMatrix4(matrix);
    const seen = !this.cull || this.frustum.intersectsSphere(SPHERE);
    const casts = this.lightFrusta.some((f) => f.intersectsSphere(SPHERE));
    if (!seen && !casts) return false;
    const braking = lights.brake.length > 0 && lights.brake[0].material === BRAKE_ON;
    const left = lights.left.length > 0 && lights.left[0].visible;
    const right = lights.right.length > 0 && lights.right[0].visible;
    for (const p of t.pieces) {
      if (casts && p.shadow) this.put(p.shadow, matrix, p.local);
      if (!seen || (p.role === 'L' && !left) || (p.role === 'R' && !right)) continue;
      this.put(p.role === 'B' && braking ? p.on! : p.pool, matrix, p.local);
    }
    return true;
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

  private put(pool: Pool, matrix: THREE.Matrix4, local: THREE.Matrix4): void {
    if (pool.n === pool.mesh.instanceMatrix.count) this.grow(pool);
    pool.mesh.setMatrixAt(pool.n++, AT.multiplyMatrices(matrix, local));
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
      pieces.push({
        local,
        pool: this.pool(m.geometry, role === 'B' ? BRAKE_DIM : material, false),
        on: role === 'B' ? this.pool(m.geometry, BRAKE_ON, false) : undefined,
        shadow: role === 'body' && m.castShadow ? this.pool(m.geometry, material, true) : undefined,
        role,
      });
      m.geometry.computeBoundingBox();
      box.union(m.geometry.boundingBox!.clone().applyMatrix4(local));
    });
    const t = { pieces, bounds: box.getBoundingSphere(new THREE.Sphere()) };
    this.templates.set(key, t);
    return t;
  }

  /** The pool of a geometry in a material: seen (by the camera), or casting shadows (seen only by the lights). */
  private pool(geometry: THREE.BufferGeometry, material: THREE.Material, shadow: boolean): Pool {
    const key = `${geometry.uuid}|${material.uuid}|${shadow}`;
    let p = this.pools.get(key);
    if (!p) {
      p = { mesh: this.make(geometry, material, shadow, this.capacity), n: 0 };
      this.pools.set(key, p);
      this.scene.add(p.mesh);
    }
    return p;
  }

  private make(geometry: THREE.BufferGeometry, material: THREE.Material, shadow: boolean, room: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, room);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = shadow;
    if (shadow) mesh.layers.set(SHADOW_LAYER);
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
