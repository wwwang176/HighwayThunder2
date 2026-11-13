import * as THREE from 'three';
import { BRAKE3_OFF, BRAKE_DIM, BRAKE_ON, type VehicleLights } from '../vehicles/models';
import { GLOW_ATTRIBUTE, glowMaterial, type GlowKind } from './heatGlow';

/** The layer only shadow-casting lights' cameras see (BodyInstances' shadow casters; the view's camera doesn't). */
export const SHADOW_LAYER = 1;

/** How BodyInstances.add drew a vehicle: in view, casting a shadow (both, either, or 0: not at all). */
export const SEEN = 1;
export const CASTS = 2;

const AT = new THREE.Matrix4();
const SPHERE = new THREE.Sphere();

/** One instanced mesh: a geometry in a material, as many times as vehicles show it this frame. */
interface Pool {
  mesh: THREE.InstancedMesh;
  n: number;
  /** A glowing part's (render/heatGlow): each instance's glow. */
  glow?: THREE.InstancedBufferAttribute;
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
  role: 'body' | 'L' | 'R' | 'B' | 'C';
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
   * How it is drawn (SEEN: in view; CASTS: casting a shadow; 0: not at all). `as`: a part of a vehicle already
   * added inside its bounds (a wheel) - drawn as that was, not culled itself: what is outside the view or a beam is
   * not seen there either way. `glow`: its glowing parts' (render/heatGlow; a wheel's hot brake), 0 to 1.
   */
  add(key: string, root: THREE.Object3D, matrix: THREE.Matrix4, lights: VehicleLights, as?: number, glow = 0): number {
    const t = this.templates.get(key) ?? this.register(key, root);
    let seen: boolean;
    let casts: boolean;
    if (as === undefined) {
      SPHERE.copy(t.bounds).applyMatrix4(matrix);
      seen = !this.cull || this.frustum.intersectsSphere(SPHERE);
      casts = false;
      for (const f of this.lightFrusta) if (f.intersectsSphere(SPHERE)) { casts = true; break; }
    } else {
      seen = (as & SEEN) !== 0;
      casts = (as & CASTS) !== 0;
    }
    if (!seen && !casts) return 0;
    const braking = lights.brake.length > 0 && lights.brake[0].material === BRAKE_ON;
    const left = lights.left.length > 0 && lights.left[0].visible;
    const right = lights.right.length > 0 && lights.right[0].visible;
    for (const p of t.pieces) {
      if (casts && p.shadow) this.put(p.shadow, matrix, p.local);
      if (!seen || (p.role === 'L' && !left) || (p.role === 'R' && !right)) continue;
      this.put((p.role === 'B' || p.role === 'C') && braking ? p.on! : p.pool, matrix, p.local, glow);
    }
    return (seen ? SEEN : 0) | (casts ? CASTS : 0);
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
      if (p.glow) {
        p.glow.clearUpdateRanges();
        p.glow.addUpdateRange(0, p.n);
        p.glow.needsUpdate = true;
      }
    }
  }

  private put(pool: Pool, matrix: THREE.Matrix4, local: THREE.Matrix4, glow = 0): void {
    if (pool.n === pool.mesh.instanceMatrix.count) this.grow(pool);
    pool.glow?.setX(pool.n, glow);
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
      const glow = m.userData.glow as GlowKind | undefined;
      pieces.push({
        local,
        pool: this.pool(m.geometry, role === 'B' ? BRAKE_DIM : role === 'C' ? BRAKE3_OFF : material, false, glow),
        on: role === 'B' || role === 'C' ? this.pool(m.geometry, BRAKE_ON, false) : undefined,
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
  private pool(geometry: THREE.BufferGeometry, material: THREE.Material, shadow: boolean, glow?: GlowKind): Pool {
    const key = `${geometry.uuid}|${material.uuid}|${shadow}|${glow ?? ''}`;
    let p = this.pools.get(key);
    if (!p) {
      // A glowing part: its geometry its own (each instance's glow on it), its material the glowing copy.
      const mesh = glow
        ? this.make(geometry.clone(), glowMaterial(material, glow), shadow, this.capacity)
        : this.make(geometry, material, shadow, this.capacity);
      p = { mesh, n: 0, glow: glow ? this.glowOn(mesh) : undefined };
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

  /** A glowing part's pool: room for each instance's glow, on its geometry. */
  private glowOn(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count), 1);
    a.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute(GLOW_ATTRIBUTE, a);
    return a;
  }

  /** Twice the room, this frame's instances so far copied over. */
  private grow(p: Pool): void {
    const old = p.mesh;
    const mesh = this.make(old.geometry, old.material as THREE.Material, old.castShadow, old.instanceMatrix.count * 2);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array);
    if (p.glow) {
      const was = p.glow;
      p.glow = this.glowOn(mesh); // (the same geometry: its glow made roomier)
      p.glow.array.set(was.array);
    }
    this.scene.remove(old);
    old.dispose(); // (its geometry and material stay: shared with the templates)
    this.scene.add(mesh);
    p.mesh = mesh;
  }
}
