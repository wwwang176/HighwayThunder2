import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRAKE3_OFF, BRAKE_DIM, BRAKE_ON, type VehicleLights } from '../vehicles/models';
import { GLOW_ATTRIBUTE, glowMaterial, type GlowKind } from './heatGlow';

/** The layer only shadow-casting lights' cameras see (BodyInstances' shadow casters; the view's camera doesn't). */
export const SHADOW_LAYER = 1;

/** How BodyInstances.add drew a vehicle: in view, casting a shadow (both, either, or 0: not at all). */
export const SEEN = 1;
export const CASTS = 2;

const AT = new THREE.Matrix4();
const SPHERE = new THREE.Sphere();
const IDENTITY = new THREE.Matrix4();

/** A plain part's colour (linear) and its roughness and metalness, on each of its vertices (plainMaterial). */
const PLAIN_COLOR = 'plainColor';
const PLAIN_RM = 'plainRM';

/**
 * Plain parts (a colour, a roughness, a metalness: no maps, nothing else their own) drawn as one: their colour,
 * roughness and metalness off their vertices instead of the material's - flat (each triangle's own, not blended
 * across it: the very numbers their own materials had). One a side.
 */
const plainMaterials = new Map<THREE.Side, THREE.MeshStandardMaterial>();
function plainMaterial(side: THREE.Side): THREE.MeshStandardMaterial {
  let m = plainMaterials.get(side);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, side });
  m.customProgramCacheKey = () => 'plainParts';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 ${PLAIN_COLOR};\nattribute vec2 ${PLAIN_RM};\nflat varying vec3 vPlainColor;\nflat varying vec2 vPlainRM;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvPlainColor = ${PLAIN_COLOR};\nvPlainRM = ${PLAIN_RM};`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nflat varying vec3 vPlainColor;\nflat varying vec2 vPlainRM;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vPlainColor;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPlainRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPlainRM.y;');
  };
  plainMaterials.set(side, m);
  return m;
}

/** Whether a part's material is plain (plainMaterial): drawn with the others like it. */
function isPlain(m: THREE.Material, glow: GlowKind | undefined): m is THREE.MeshStandardMaterial {
  const s = m as THREE.MeshStandardMaterial;
  return (
    s.type === 'MeshStandardMaterial' &&
    !glow &&
    m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile &&
    !s.map && !s.emissiveMap && !s.normalMap && !s.roughnessMap && !s.metalnessMap && !s.aoMap && !s.lightMap &&
    !s.alphaMap && !s.bumpMap && !s.displacementMap && !s.envMap &&
    s.emissive.getHex() === 0 && s.envMapIntensity === 1 && !s.vertexColors && !s.flatShading && !s.transparent &&
    s.opacity === 1 && s.alphaTest === 0 && s.depthWrite && s.depthTest && s.fog && s.toneMapped &&
    s.blending === THREE.NormalBlending && !s.polygonOffset && !s.wireframe && !s.dithering && !s.premultipliedAlpha &&
    !s.alphaToCoverage && s.colorWrite && s.clippingPlanes === null
  );
}

/** The side a part's material draws into a shadow map (PCF: its shadowSide, else its side turned round). */
function depthSide(m: THREE.Material): THREE.Side {
  if (m.shadowSide !== null) return m.shadowSide;
  return m.side === THREE.FrontSide ? THREE.BackSide : m.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide;
}

/** An attribute's numbers as plain floats (a file's may be packed: integers standing for fractions). */
function floats(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
  return new THREE.BufferAttribute(out, a.itemSize);
}

/**
 * A part's geometry, in the vehicle's space (`local`), with only `position` (and `normal`: its own, else worked
 * out): indexed (merged so).
 */
function placed(geometry: THREE.BufferGeometry, local: THREE.Matrix4, withNormals: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', floats(geometry.getAttribute('position')));
  g.setIndex(geometry.index ? [...geometry.index.array] : [...Array(g.getAttribute('position').count).keys()]);
  if (withNormals) {
    const n = geometry.getAttribute('normal');
    if (n) g.setAttribute('normal', floats(n));
    else g.computeVertexNormals();
  }
  return g.applyMatrix4(local);
}

/** One number pair or triple on every vertex of `g`. */
function constant(g: THREE.BufferGeometry, name: string, values: number[]): void {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * values.length);
  for (let i = 0; i < n; i++) a.set(values, i * values.length);
  g.setAttribute(name, new THREE.BufferAttribute(a, values.length));
}

/** One instanced mesh: a geometry in a material, as many times as vehicles show it this frame. */
interface Pool {
  mesh: THREE.InstancedMesh;
  n: number;
  /** A glowing part's (render/heatGlow): each instance's glow. */
  glow?: THREE.InstancedBufferAttribute;
}

/** A part of a template: where it sits on the vehicle, its pool (a brake light two: dim and on). */
interface Piece {
  local: THREE.Matrix4;
  pool: Pool;
  on?: Pool;
  role: 'body' | 'L' | 'R' | 'B' | 'C';
}

/**
 * A vehicle model as drawn: its parts (its plain ones as one a side: plainMaterial), and its shadow casters as one a
 * side they draw into the shadow maps (a shadow is the same whatever the paint: only where the part is, and which
 * of its faces). Models with the same parts in other paint share those pools.
 */
interface Template {
  pieces: Piece[];
  shadows: Pool[];
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
    if (casts) for (const s of t.shadows) this.put(s, matrix, IDENTITY);
    if (!seen) return CASTS;
    const braking = lights.brake.length > 0 && lights.brake[0].material === BRAKE_ON;
    const left = lights.left.length > 0 && lights.left[0].visible;
    const right = lights.right.length > 0 && lights.right[0].visible;
    for (const p of t.pieces) {
      if ((p.role === 'L' && !left) || (p.role === 'R' && !right)) continue;
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
    const plain = new Map<THREE.Side, { mesh: THREE.Mesh; local: THREE.Matrix4 }[]>();
    const casters = new Map<THREE.Side, { mesh: THREE.Mesh; local: THREE.Matrix4 }[]>();
    const box = new THREE.Box3();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const role = (m.userData.role as Piece['role'] | undefined) ?? 'body';
      const local = new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld);
      const material = m.material as THREE.Material;
      const glow = m.userData.glow as GlowKind | undefined;
      if (role === 'body' && m.castShadow) {
        const side = depthSide(material);
        (casters.get(side) ?? casters.set(side, []).get(side)!).push({ mesh: m, local });
      }
      if (role === 'body' && isPlain(material, glow)) (plain.get(material.side) ?? plain.set(material.side, []).get(material.side)!).push({ mesh: m, local });
      else {
        pieces.push({
          local,
          pool: this.pool(m.geometry, role === 'B' ? BRAKE_DIM : role === 'C' ? BRAKE3_OFF : material, false, glow),
          on: role === 'B' || role === 'C' ? this.pool(m.geometry, BRAKE_ON, false) : undefined,
          role,
        });
      }
      m.geometry.computeBoundingBox();
      box.union(m.geometry.boundingBox!.clone().applyMatrix4(local));
    });
    for (const [side, parts] of plain) pieces.push({ local: IDENTITY, pool: this.plainPool(side, parts), role: 'body' });
    const shadows = [...casters].map(([side, parts]) => this.shadowPool(side, parts));
    const t = { pieces, shadows, bounds: box.getBoundingSphere(new THREE.Sphere()) };
    this.templates.set(key, t);
    return t;
  }

  /** The pool of a model's plain parts on `side` as one (shared by every model with these parts so placed). */
  private plainPool(side: THREE.Side, parts: { mesh: THREE.Mesh; local: THREE.Matrix4 }[]): Pool {
    const key = `plain|${side}|` + parts.map((p) => `${p.mesh.geometry.uuid}:${(p.mesh.material as THREE.Material).uuid}:${p.local.elements.join(',')}`).join(';');
    let p = this.pools.get(key);
    if (!p) {
      const geometry = mergeGeometries(
        parts.map(({ mesh, local }) => {
          const g = placed(mesh.geometry, local, true);
          const m = mesh.material as THREE.MeshStandardMaterial;
          constant(g, PLAIN_COLOR, [m.color.r, m.color.g, m.color.b]);
          constant(g, PLAIN_RM, [m.roughness, m.metalness]);
          return g;
        }),
      )!;
      p = { mesh: this.make(geometry, plainMaterial(side), false, this.capacity), n: 0 };
      this.pools.set(key, p);
      this.scene.add(p.mesh);
    }
    return p;
  }

  /** The pool of a model's shadow casters drawing `side` into the shadow maps, as one (shared likewise). */
  private shadowPool(side: THREE.Side, parts: { mesh: THREE.Mesh; local: THREE.Matrix4 }[]): Pool {
    const key = `shadow|${side}|` + parts.map((p) => `${p.mesh.geometry.uuid}:${p.local.elements.join(',')}`).join(';');
    let p = this.pools.get(key);
    if (!p) {
      const geometry = mergeGeometries(parts.map(({ mesh, local }) => placed(mesh.geometry, local, false)))!;
      const material = new THREE.MeshBasicMaterial();
      material.shadowSide = side;
      p = { mesh: this.make(geometry, material, true, this.capacity), n: 0 };
      this.pools.set(key, p);
      this.scene.add(p.mesh);
    }
    return p;
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
