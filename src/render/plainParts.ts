import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GlowKind } from './heatGlow';
import type { VehicleModel } from '../vehicles/models';

/**
 * A vehicle's parts drawn as few as they can be, the picture the same: its plain parts (a colour, a roughness, a
 * metalness: nothing else their own) as one mesh, its shadow casters as one more only the shadow-casting lights see.
 * Used by BodyInstances (the traffic, instanced) and mergePlainParts (a racer, its own meshes).
 */

/** The layer only shadow-casting lights' cameras see (shadow casters drawn apart; the view's camera doesn't). */
export const SHADOW_LAYER = 1;

/** A plain part's colour (linear) and its roughness and metalness, on each of its vertices (plainMaterial). */
const PLAIN_COLOR = 'plainColor';
const PLAIN_RM = 'plainRM';

/** A part and where it sits in its vehicle's space. */
export interface Part {
  mesh: THREE.Mesh;
  local: THREE.Matrix4;
}

/**
 * Plain parts drawn as one: their colour, roughness and metalness off their vertices instead of the material's -
 * flat (each triangle's own, not blended across it: the very numbers their own materials had). One a side.
 */
const plainMaterials = new Map<THREE.Side, THREE.MeshStandardMaterial>();
export function plainMaterial(side: THREE.Side): THREE.MeshStandardMaterial {
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
export function isPlain(m: THREE.Material, glow: GlowKind | undefined): m is THREE.MeshStandardMaterial {
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
    !s.alphaToCoverage && s.colorWrite && s.clippingPlanes === null && s.visible
  );
}

/**
 * Whether a part's shadow is only where it is (nothing of its material's cuts into it: no alpha test, no map moving
 * its surface): cast as well by its shape alone, in shadowMaterial.
 */
export function shadowByShape(mesh: THREE.Mesh): boolean {
  const s = mesh.material as THREE.MeshStandardMaterial;
  return (
    !mesh.customDepthMaterial && s.visible && s.alphaTest === 0 && !s.alphaHash && !s.alphaMap && !s.displacementMap &&
    s.clippingPlanes === null && Object.keys(mesh.geometry.morphAttributes).length === 0
  );
}

/** The side a part's material draws into a shadow map (PCF: its shadowSide, else its side turned round). */
export function depthSide(m: THREE.Material): THREE.Side {
  if (m.shadowSide !== null) return m.shadowSide;
  return m.side === THREE.FrontSide ? THREE.BackSide : m.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide;
}

/** Shadow casters drawn as one: their shapes only, `side` into the shadow maps. One a side. */
const shadowMaterials = new Map<THREE.Side, THREE.MeshBasicMaterial>();
export function shadowMaterial(side: THREE.Side): THREE.MeshBasicMaterial {
  let m = shadowMaterials.get(side);
  if (!m) {
    m = new THREE.MeshBasicMaterial();
    m.shadowSide = side;
    shadowMaterials.set(side, m);
  }
  return m;
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

/** Plain parts' geometry as one, for plainMaterial: each part's colour, roughness and metalness on its vertices. */
export function plainGeometry(parts: Part[]): THREE.BufferGeometry {
  return mergeGeometries(
    parts.map(({ mesh, local }) => {
      const g = placed(mesh.geometry, local, true);
      const m = mesh.material as THREE.MeshStandardMaterial;
      constant(g, PLAIN_COLOR, [m.color.r, m.color.g, m.color.b]);
      constant(g, PLAIN_RM, [m.roughness, m.metalness]);
      return g;
    }),
  )!;
}

/** Shadow casters' shapes as one (positions only), for shadowMaterial. */
export function shadowGeometry(parts: Part[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map(({ mesh, local }) => placed(mesh.geometry, local, false)))!;
}

/** Parts others find by name (the police's light bars, flashed by src/game/police.ts): left as they are. */
const LOOKED_UP = /^lightbar-/;

/**
 * A racer's still parts (all but its lamps; its wheels are drawn apart, hidden here) drawn as few as can be: its
 * plain parts as one mesh a side (plainMaterial), its shadow casters as one a side they draw into the shadow maps
 * (shadowMaterial, on SHADOW_LAYER: game.ts' shadowLights see it) - the parts themselves then casting none. 9 draws
 * a racer were 6, its 4 into each shadow map 1. Groups of one left as they were. Call once the model is built
 * (mergeStillParts done: its lamps' places, its exhausts' read off it).
 */
export function mergePlainParts(model: VehicleModel): void {
  const root = model.root;
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const l = model.lights;
  const lamps = new Set<THREE.Object3D>([...l.left, ...l.right, ...l.brake, ...l.third]);
  const parts: Part[] = [];
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || lamps.has(m) || LOOKED_UP.test(m.name)) return;
    if (Array.isArray(m.material) || m.children.length > 0) return;
    if (m.matrixWorld.determinant() < 0) return; // (mirrored: its faces would turn inside out baked)
    parts.push({ mesh: m, local: new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld) });
  });
  const groups = <K>(of: (p: Part) => K | undefined) => {
    const out = new Map<K, Part[]>();
    for (const p of parts) {
      const k = of(p);
      if (k !== undefined) (out.get(k) ?? out.set(k, []).get(k)!).push(p);
    }
    return [...out].filter(([, ps]) => ps.length > 1);
  };
  const own = (mesh: THREE.Mesh) => {
    mesh.userData.ownGeometry = true; // (this car's alone: freed with it - PlayerCar.dispose)
    root.add(mesh);
  };
  // The shadow casters first (a part whose shadow went to them casts none itself, whatever is drawn of it).
  for (const [side, set] of groups((p) => (p.mesh.castShadow && shadowByShape(p.mesh) ? depthSide(p.mesh.material as THREE.Material) : undefined))) {
    const mesh = new THREE.Mesh(shadowGeometry(set), shadowMaterial(side));
    mesh.name = 'shadows';
    mesh.castShadow = true;
    mesh.layers.set(SHADOW_LAYER);
    own(mesh);
    for (const p of set) p.mesh.castShadow = false;
  }
  for (const [, set] of groups((p) => {
    const m = p.mesh;
    return isPlain(m.material as THREE.Material, m.userData.glow) ? `${(m.material as THREE.Material).side}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}` : undefined;
  })) {
    const first = set[0].mesh;
    const mesh = new THREE.Mesh(plainGeometry(set), plainMaterial((first.material as THREE.Material).side));
    mesh.name = 'plain';
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    own(mesh);
    for (const p of set) {
      p.mesh.removeFromParent();
      if (p.mesh.userData.ownGeometry) p.mesh.geometry.dispose(); // (mergeStillParts' merge, merged on)
    }
  }
}
