import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BEAM_LAMP_H } from './headlight';
import type { BeamSpot } from '../render/npcBeams';
import type { CarStyle } from './cars/types';
import { carTemplate, type CarTemplate, type TrafficModel, type WheelSpots } from './carModels';

/**
 * Procedural low-poly vehicles. Every model's origin is the center of its
 * physics box (so ground is at y = -height/2) and its front points to -Z.
 */

export interface VehicleLights {
  left: THREE.Object3D[];
  right: THREE.Object3D[];
  brake: THREE.Mesh[];
  /** The third brake light (`brake_C`): a dark red lens, lit only braking. */
  third: THREE.Mesh[];
}

export interface VehicleModel {
  root: THREE.Group;
  lights: VehicleLights;
}

const geoCache = new Map<string, THREE.BoxGeometry>();
function boxGeo(w: number, h: number, l: number): THREE.BoxGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${l.toFixed(3)}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, l);
    geoCache.set(key, g);
  }
  return g;
}

const matCache = new Map<string, THREE.Material>();
function std(color: number, roughness = 0.6, metalness = 0.1): THREE.MeshStandardMaterial {
  const key = `s${color}|${roughness}|${metalness}`;
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    matCache.set(key, m);
  }
  return m;
}

/** Self-lit material with HDR brightness (values > 1 feed the bloom glow at night). */
function glowMat(r: number, g: number, b: number, extra: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ toneMapped: false, ...extra });
  m.color.setRGB(r, g, b);
  return m;
}

// Night: tail lights always on (dim), brake lights bright, headlights brightest.
// The glow itself comes from flare sprites (render/lightFlares), so these stay in range - but a brake light on and
// the headlights: past the bloom's threshold (render/postFx POST.threshold 2.05; their luminance ~2.26, ~2.33), their
// lamps glowing too.
export const BRAKE_DIM = glowMat(0.45, 0.01, 0.01);
export const BRAKE_ON = glowMat(9, 0.45, 0.3);
/** The third brake light off: its lens a dark red, seen but not glowing (on: BRAKE_ON). */
export const BRAKE3_OFF = glowMat(0.12, 0.008, 0.008);
// An indicator on: its glow the bloom's alone (no flare), far past its threshold (luminance ~7.8 against 2.05: a wide halo),
// its green held down so it stays amber (the tone mapping whitens what is this bright).
const INDICATOR = glowMat(20, 5, 0.2);
const GLASS = std(0x1a2430, 0.15, 0.6);
const TIRE = std(0x151515, 0.9);
const RIM = std(0x9a9a9a, 0.4, 0.6);
const HEADLIGHT = glowMat(2.4, 2.33, 2.11);

/** Where a model's lights glow (model-local), stored in root.userData.flares. */
export interface FlareSpot {
  x: number;
  y: number;
  z: number;
  kind: 'head' | 'tail';
}

const DARK = std(0x222222, 0.8);
const CHROME = std(0xcccccc, 0.3, 0.8);

const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
wheelGeo.rotateZ(Math.PI / 2);

function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  l: number,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  shadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo(w, h, l), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}

function wheels(parent: THREE.Object3D, groundY: number, halfTrack: number, zs: number[], r: number, width = 0.28) {
  for (const z of zs) {
    for (const side of [-1, 1]) {
      const t = new THREE.Mesh(wheelGeo, TIRE);
      t.scale.set(width, r, r);
      t.position.set(side * halfTrack, groundY + r, z);
      parent.add(t);
      const rim = new THREE.Mesh(wheelGeo, RIM);
      rim.scale.set(width + 0.02, r * 0.55, r * 0.55);
      rim.position.copy(t.position);
      parent.add(rim);
    }
  }
}

function addLights(
  parent: THREE.Object3D,
  lights: VehicleLights,
  halfW: number,
  y: number,
  frontZ: number | null,
  rearZ: number,
  groundY?: number, // when given, the headlights light the road ahead
) {
  if (frontZ !== null && groundY !== undefined) {
    // NPC low beams light the road in its shader (render/npcBeams); the pattern
    // on the ground scales with the lamps' height.
    const beam: BeamSpot = { frontZ, groundY, k: (y - groundY) / BEAM_LAMP_H };
    parent.userData.beam = beam;
  }
  const flares: FlareSpot[] = (parent.userData.flares ??= []);
  for (const side of [-1, 1]) {
    const list = side < 0 ? lights.left : lights.right;
    flares.push({ x: side * (halfW - 0.35), y, z: rearZ + 0.1, kind: 'tail' });
    if (frontZ !== null) flares.push({ x: side * (halfW - 0.4), y, z: frontZ - 0.1, kind: 'head' });
    // Rear indicator + brake light.
    const ind = box(parent, 0.18, 0.14, 0.06, INDICATOR, side * (halfW - 0.12), y + 0.2, rearZ + 0.03, false);
    ind.visible = false;
    list.push(ind);
    lights.brake.push(box(parent, 0.32, 0.16, 0.06, BRAKE_DIM, side * (halfW - 0.35), y, rearZ + 0.03, false));
    if (frontZ !== null) {
      const f = box(parent, 0.16, 0.12, 0.06, INDICATOR, side * (halfW - 0.1), y, frontZ - 0.03, false);
      f.visible = false;
      list.push(f);
      box(parent, 0.34, 0.14, 0.05, HEADLIGHT, side * (halfW - 0.4), y, frontZ - 0.03, false);
    }
  }
}

export const CAR_COLORS = [0xe8e8e8, 0x2b2b2b, 0x8a8f96, 0x1d4e89, 0xb3261e, 0x2e6b3a, 0xd9c7a3, 0x5b5f97, 0xf0b429, 0x6c3b2a];
export const CONTAINER_COLORS = [0x1f5fa8, 0xb8352a, 0x2f7d4a, 0xd88a1a, 0x6b6b6b, 0x8a2f6e, 0x0f8a8a];
export const TRUCK_COLORS = [0xf2f2f2, 0x2a5aa0, 0x2d7a46, 0xd6c13a];
// The same colours' paint jobs in the traffic's files (tools/models/sedan.py, truck.py and cab.py: their cabs), in
// their order. (The trailer's container, trailer.py, is painted the colour itself.)
export const CAR_LIVERIES = ['white', 'black', 'silver', 'blue', 'red', 'green', 'beige', 'indigo', 'yellow', 'brown'];
export const TRUCK_LIVERIES = ['white', 'blue', 'green', 'yellow'];

/**
 * Generic sedan (`style` false) or a racer's body: `true` / 'super' the low
 * supercar with a wing, 'muscle' a long-hooded muscle car. A style with a file
 * (carModels.ts) wears one of its paint jobs, `livery` (its own by default),
 * rather than `color`.
 */
export function buildCar(
  w: number,
  h: number,
  l: number,
  color: number,
  style: CarStyle | boolean = false,
  withWheels = true,
  beam = true,
  livery?: string,
): VehicleModel {
  const made = typeof style === 'string' ? carTemplate(style) : undefined;
  if (made) return fromTemplate(made, h, l, color, withWheels, beam, livery);
  if (style === 'muscle') return buildMuscleCar(w, h, l, color, withWheels, beam);
  if (style === 'jdm') return buildJdmCar(w, h, l, color, withWheels, beam);
  const sporty = style !== false;
  const root = new THREE.Group();
  const lights: VehicleLights = { left: [], right: [], brake: [], third: [] };
  const g = -h / 2;
  const paint = std(color, sporty ? 0.25 : 0.45, sporty ? 0.5 : 0.25);
  const bodyH = sporty ? 0.55 : 0.62;
  box(root, w, bodyH, l, paint, 0, g + 0.28 + bodyH / 2, 0);
  const cabinH = sporty ? 0.42 : 0.5;
  const cabinL = l * (sporty ? 0.42 : 0.5);
  const cabinY = g + 0.28 + bodyH + cabinH / 2;
  box(root, w * 0.82, cabinH, cabinL, paint, 0, cabinY, l * 0.04);
  box(root, w * 0.84, cabinH * 0.78, cabinL * 0.9, GLASS, 0, cabinY - 0.02, l * 0.04, false);
  if (sporty) {
    box(root, w * 0.9, 0.06, 0.35, DARK, 0, g + 0.28 + bodyH + 0.22, l / 2 - 0.25); // spoiler
    box(root, 0.1, 0.2, 0.1, DARK, -w * 0.35, g + 0.28 + bodyH + 0.1, l / 2 - 0.25);
    box(root, 0.1, 0.2, 0.1, DARK, w * 0.35, g + 0.28 + bodyH + 0.1, l / 2 - 0.25);
    box(root, 0.35, 0.01, l * 0.98, std(0xffffff, 0.3), -0.25, g + 0.28 + bodyH + 0.005, 0, false);
    box(root, 0.35, 0.01, l * 0.98, std(0xffffff, 0.3), 0.25, g + 0.28 + bodyH + 0.005, 0, false);
  }
  if (withWheels) wheels(root, g, w / 2 - 0.1, [-l * 0.32, l * 0.32], 0.33);
  addLights(root, lights, w / 2, g + 0.28 + bodyH * 0.7, -l / 2, l / 2, beam ? g : undefined);
  return { root, lights };
}

// A body from a file (carModels.ts) stands on the ground at this depth below its origin.
const MODEL_GROUND = 0.55;
// Where a file car's wheels go when it brings its own (the garage) and the file doesn't say: the player car's.
const MODEL_WHEELS: WheelSpots = { x: 0.8, front: 1.3, rear: -1.3, r: 0.34 };

const paintCache = new Map<string, THREE.Material>();
/**
 * The inside of a file body's shell (its paint's back faces: seen up the wheel wells, which are open above),
 * near black like the underside.
 */
const SHELL_INSIDE = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.9, side: THREE.BackSide });
/** The paint (its front faces): one of the file's paint jobs (`livery`, or its own), or for a file without them `color`. */
function paintFor(base: THREE.Material, t: CarTemplate, color: number, livery: string | undefined): THREE.Material {
  const name = livery !== undefined && t.liveries.has(livery) ? livery : t.liveries.keys().next().value;
  const key = `${base.uuid}|${name ?? color}`;
  let m = paintCache.get(key);
  if (!m) {
    const p = base.clone() as THREE.MeshStandardMaterial;
    p.side = THREE.FrontSide;
    if (name !== undefined) {
      p.map = t.liveries.get(name)!;
      p.color.setHex(0xffffff);
    } else p.color.setHex(color);
    m = p;
    paintCache.set(key, m);
  }
  return m;
}

/**
 * A traffic body from its file (carModels.ts), in the paint job `livery` (a file
 * without paint jobs, the trailer's: plain `color`), the file's origin (midway
 * between its axles; the trailer's, its middle) `z` along the physics box; no wheels
 * (the traffic's are shared). Undefined until the files are loaded (and in the
 * tests): the caller's procedural body then.
 */
export function buildTrafficBody(name: TrafficModel, h: number, l: number, z: number, livery?: string, color = 0): VehicleModel | undefined {
  const t = carTemplate(name);
  return t && fromTemplate(t, h, l, color, false, true, livery, z, true);
}

/**
 * A car body made in Blender: painted (its paint job `livery`, its own by
 * default; or `color`), its named lamps wired up like addLights' (glow
 * materials, indicators off, brake lights, flare spots - none on a light bar
 * unless `barFlares` -, the NPC-style beam). Its origin `z` along the box.
 */
function fromTemplate(
  t: CarTemplate,
  h: number,
  l: number,
  color: number,
  withWheels: boolean,
  beam: boolean,
  livery?: string,
  z = 0,
  barFlares = false,
): VehicleModel {
  const root = new THREE.Group();
  const lights: VehicleLights = { left: [], right: [], brake: [], third: [] };
  const g = -h / 2;
  const body = t.body.clone(true);
  body.position.set(0, g + MODEL_GROUND, z);
  root.add(body);
  const painted: THREE.Mesh[] = [];
  body.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    if (mat.name === 'paint') {
      m.material = paintFor(mat, t, color, livery);
      painted.push(m);
    }
    m.castShadow = mat.name !== 'glass';
  });
  for (const m of painted) m.add(new THREE.Mesh(m.geometry, SHELL_INSIDE)); // its back faces, dark
  root.updateMatrixWorld(true);
  const flares: FlareSpot[] = (root.userData.flares = []);
  const lamp = (name: string, mat: THREE.Material) => {
    const m = body.getObjectByName(name) as THREE.Mesh | undefined;
    if (!m) return undefined;
    m.material = mat;
    m.castShadow = false;
    return { mesh: m, box: new THREE.Box3().setFromObject(m) };
  };
  const c = new THREE.Vector3();
  const glow = new THREE.Vector3();
  for (const side of ['L', 'R'] as const) {
    const head = lamp(`head_${side}`, HEADLIGHT);
    if (head) {
      head.box.getCenter(c);
      // Its glow: where the file's listed (carModels' HEAD_GLOW; the lamp sits at the file's origin), else just
      // ahead of its box.
      if (t.headGlow) glow.copy(t.headGlow).setX(side === 'L' ? t.headGlow.x : -t.headGlow.x).applyMatrix4(head.mesh.matrixWorld);
      else glow.set(c.x, c.y, head.box.min.z - 0.1);
      flares.push({ x: glow.x, y: glow.y, z: glow.z, kind: 'head' });
      if (beam) root.userData.beam = { frontZ: -l / 2, groundY: g, k: (c.y - g) / BEAM_LAMP_H } satisfies BeamSpot;
    }
    const tail = lamp(`tail_${side}`, BRAKE_DIM);
    if (tail) {
      tail.box.getCenter(c);
      if (barFlares || !tail.mesh.userData.bar) flares.push({ x: c.x, y: c.y, z: tail.box.max.z + 0.1, kind: 'tail' });
      lights.brake.push(tail.mesh);
    }
    for (const end of ['F', 'R']) {
      const ind = lamp(`ind_${end}${side}`, INDICATOR);
      if (!ind) continue;
      ind.mesh.visible = false;
      (side === 'L' ? lights.left : lights.right).push(ind.mesh);
    }
  }
  // The third brake light, up at the rear window's top (the cars'; none on the trucks): dark till braking, no flare.
  const third = lamp('brake_C', BRAKE3_OFF);
  if (third) lights.third.push(third.mesh);
  // Its exhaust pipes' tips (root space), where the flames come out (exhaustFlames.ts).
  const exhausts: THREE.Vector3[] = (root.userData.exhausts = []);
  body.traverse((o) => {
    if (/^exhaust_\d+$/.test(o.name)) exhausts.push(o.getWorldPosition(new THREE.Vector3())); // (not its per-material parts)
  });
  if (withWheels && t.wheel) {
    const s = t.spots ?? MODEL_WHEELS;
    for (const along of [s.front, s.rear]) {
      for (const x of [-s.x, s.x]) {
        const w = templateWheel(t, s.r, x < 0);
        w.position.set(x, g + s.r, -along); // the nose is -z
        root.add(w);
        const c = templateCaliper(t, s.r, x < 0);
        if (c) {
          c.position.copy(w.position);
          root.add(c);
        }
      }
    }
  }
  return { root, lights };
}

/** The file's wheel at radius `r`, its rim facing out (left wheels turned round). */
function templateWheel(t: CarTemplate, r: number, left: boolean): THREE.Object3D {
  const w = t.wheel!.clone(true);
  w.scale.setScalar(r / (t.spots ?? MODEL_WHEELS).r);
  w.rotation.set(0, left ? Math.PI : 0, 0);
  w.traverse((o) => void ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
  return w;
}

/** The file's brake caliper for a wheel at radius `r` (none if it has none): mirrored on the left, so behind the axle on both sides. */
function templateCaliper(t: CarTemplate, r: number, left: boolean): THREE.Object3D | null {
  if (!t.caliper) return null;
  const c = t.caliper.clone(true);
  const k = r / (t.spots ?? MODEL_WHEELS).r;
  c.scale.set(left ? -k : k, k, k);
  return c;
}

/** Muscle car: a tall slab of a body, long hood with a scoop, small cabin set back, twin stripes, a ducktail. (The nose is -z.) */
function buildMuscleCar(w: number, h: number, l: number, color: number, withWheels: boolean, beam: boolean): VehicleModel {
  const root = new THREE.Group();
  const lights: VehicleLights = { left: [], right: [], brake: [], third: [] };
  const g = -h / 2;
  const paint = std(color, 0.3, 0.45);
  const bodyH = 0.64;
  const top = g + 0.28 + bodyH;
  box(root, w, bodyH, l, paint, 0, g + 0.28 + bodyH / 2, 0);
  const cabinH = 0.4;
  const cabinL = l * 0.34;
  const cabinZ = l * 0.12; // well back: the hood is long
  box(root, w * 0.8, cabinH, cabinL, paint, 0, top + cabinH / 2, cabinZ);
  box(root, w * 0.82, cabinH * 0.78, cabinL * 0.9, GLASS, 0, top + cabinH / 2 - 0.02, cabinZ, false);
  box(root, w * 0.32, 0.09, l * 0.2, DARK, 0, top + 0.045, -l * 0.26); // hood scoop
  const stripe = std(0xffb347, 0.4);
  for (const x of [-0.17, 0.17]) box(root, 0.2, 0.012, l * 0.99, stripe, x, top + 0.006, 0, false); // over hood, roof and boot
  for (const x of [-0.17, 0.17]) box(root, 0.2, 0.012, cabinL * 0.98, stripe, x, top + cabinH + 0.006, cabinZ, false);
  box(root, w * 0.94, 0.07, 0.12, paint, 0, top + 0.035, l / 2 - 0.08); // ducktail
  for (const z of [-l / 2, l / 2]) box(root, w * 1.01, 0.12, 0.1, CHROME, 0, g + 0.36, z, false); // bumpers
  if (withWheels) wheels(root, g, w / 2 - 0.1, [-l * 0.32, l * 0.32], 0.35);
  addLights(root, lights, w / 2, g + 0.28 + bodyH * 0.7, -l / 2, l / 2, beam ? g : undefined);
  return { root, lights };
}

/** Tuned JDM coupe: low and wide (fender flares), a rounded-off cabin mid-car, a front lip and a tall rear wing. (The nose is -z.) */
function buildJdmCar(w: number, h: number, l: number, color: number, withWheels: boolean, beam: boolean): VehicleModel {
  const root = new THREE.Group();
  const lights: VehicleLights = { left: [], right: [], brake: [], third: [] };
  const g = -h / 2;
  const paint = std(color, 0.22, 0.55);
  const bodyH = 0.5;
  const top = g + 0.26 + bodyH;
  box(root, w * 0.94, bodyH, l, paint, 0, g + 0.26 + bodyH / 2, 0);
  for (const z of [-l * 0.32, l * 0.32]) for (const x of [-1, 1]) box(root, 0.1, 0.34, 0.95, paint, x * (w / 2 - 0.05), g + 0.42, z); // flares over the wheels
  const cabinH = 0.44;
  const cabinL = l * 0.4;
  box(root, w * 0.78, cabinH, cabinL, paint, 0, top + cabinH / 2, l * 0.03);
  box(root, w * 0.8, cabinH * 0.8, cabinL * 0.92, GLASS, 0, top + cabinH / 2 - 0.02, l * 0.03, false);
  box(root, w * 0.96, 0.06, 0.2, DARK, 0, g + 0.26, -l / 2 - 0.05, false); // front lip
  const wingY = top + 0.38;
  box(root, w * 0.98, 0.05, 0.36, DARK, 0, wingY, l / 2 - 0.22); // wing
  for (const x of [-1, 1]) {
    box(root, 0.06, 0.38, 0.12, DARK, x * w * 0.3, top + 0.19, l / 2 - 0.22); // its stands
    box(root, 0.03, 0.18, 0.4, DARK, x * w * 0.49, wingY + 0.05, l / 2 - 0.22); // end plates
  }
  box(root, w * 0.6, 0.04, l * 0.25, std(0x111111, 0.5), 0, top + 0.02, -l * 0.3, false); // carbon hood panel
  if (withWheels) wheels(root, g, w / 2 - 0.08, [-l * 0.32, l * 0.32], 0.33);
  addLights(root, lights, w / 2, g + 0.26 + bodyH * 0.7, -l / 2, l / 2, beam ? g : undefined);
  return { root, lights };
}

export function buildTruck(w: number, h: number, l: number, color: number, withWheels = true): VehicleModel {
  const root = new THREE.Group();
  const lights: VehicleLights = { left: [], right: [], brake: [], third: [] };
  const g = -h / 2;
  const cabL = 2.3;
  const cab = std(color, 0.5);
  box(root, w * 0.97, 0.5, l, DARK, 0, g + 0.75, 0); // chassis
  box(root, w * 0.97, 2.0, cabL, cab, 0, g + 1.0 + 1.0, -l / 2 + cabL / 2);
  box(root, w * 0.92, 0.75, 0.05, GLASS, 0, g + 2.35, -l / 2 - 0.01, false);
  const cargoL = l - cabL - 0.2;
  box(root, w, h - 1.05, cargoL, std(0xe6e6e6, 0.7), 0, g + 1.05 + (h - 1.05) / 2, l / 2 - cargoL / 2);
  box(root, w + 0.01, 0.35, cargoL * 0.9, cab, 0, g + 2.2, l / 2 - cargoL / 2, false); // stripe
  if (withWheels) wheels(root, g, w / 2 - 0.2, [-l / 2 + 1.3, l / 2 - 2.2, l / 2 - 1.2], 0.5, 0.35);
  addLights(root, lights, w / 2, g + 0.9, -l / 2, l / 2, g);
  return { root, lights };
}

/** Container truck: separate cab and trailer models (each centered on its own body). */
export function buildContainerCab(w: number, h: number, cabL: number, color: number, withWheels = true): VehicleModel {
  const root = new THREE.Group();
  const lights: VehicleLights = { left: [], right: [], brake: [], third: [] };
  const g = -h / 2;
  const paint = std(color, 0.4, 0.3);
  box(root, w * 0.9, 0.5, cabL, DARK, 0, g + 0.8, 0); // frame
  box(root, w, 2.4, 2.4, paint, 0, g + 1.05 + 1.2, -cabL / 2 + 1.2);
  box(root, w * 0.94, 0.8, 0.05, GLASS, 0, g + 2.6, -cabL / 2 - 0.01, false);
  box(root, w * 0.9, 0.5, 0.8, paint, 0, g + 3.5, -cabL / 2 + 1.6); // roof fairing
  box(root, w * 0.8, 0.12, 0.6, CHROME, 0, g + 0.65, -cabL / 2 - 0.05, false); // bumper
  box(root, 1.3, 0.15, 1.4, DARK, 0, g + 1.1, cabL / 2 - 1.0); // fifth wheel
  if (withWheels) wheels(root, g, w / 2 - 0.2, [-cabL / 2 + 1.1, cabL / 2 - 1.5, cabL / 2 - 0.5], 0.52, 0.35);
  addLights(root, lights, w / 2, g + 1.0, -cabL / 2, cabL / 2 - 0.3, g);
  return { root, lights };
}

export function buildContainerTrailer(w: number, h: number, trailerL: number, color: number, withWheels = true): VehicleModel {
  const root = new THREE.Group();
  const lights: VehicleLights = { left: [], right: [], brake: [], third: [] };
  const g = -h / 2;
  box(root, w * 0.9, 0.35, trailerL, DARK, 0, g + 1.2, 0); // chassis
  const ch = h - 1.4;
  const cont = std(color, 0.75, 0.15);
  box(root, w, ch, trailerL - 0.2, cont, 0, g + 1.38 + ch / 2, 0);
  // Ribs so the container reads as corrugated.
  const rib = std(0x000000, 1);
  (rib as THREE.MeshStandardMaterial).transparent = true;
  (rib as THREE.MeshStandardMaterial).opacity = 0.18;
  for (let z = -trailerL / 2 + 0.6; z < trailerL / 2 - 0.4; z += 0.9) {
    box(root, w + 0.02, ch * 0.92, 0.08, rib, 0, g + 1.38 + ch / 2, z, false);
  }
  if (withWheels) wheels(root, g, w / 2 - 0.2, [trailerL / 2 - 3.0, trailerL / 2 - 2.0, trailerL / 2 - 1.0], 0.5, 0.35);
  addLights(root, lights, w / 2, g + 1.0, null, trailerL / 2);
  return { root, lights };
}

/**
 * A single wheel for the player car: `steer` turns about Y, `spin` (child) rolls
 * about the axle. Spokes make the rotation visible. (A file's brake caliper
 * steers but doesn't roll.)
 */
/**
 * A wheel: its steering pivot and, in it, what rolls. A file's wheel (`file`) is hidden, its place only: it is
 * drawn instanced with every wheel like it (render/bodyInstances, by `file.key`; 7 parts a wheel, each its own
 * material, were 28 draws a car).
 */
export function buildWheel(
  r: number,
  width: number,
  style?: CarStyle,
  left = false,
): { steer: THREE.Group; spin: THREE.Group; file?: { key: string; wheel: THREE.Object3D } } {
  const steer = new THREE.Group();
  const spin = new THREE.Group();
  steer.add(spin);
  const fromFile = style ? carTemplate(style) : undefined;
  if (fromFile?.wheel) {
    const wheel = templateWheel(fromFile, r, left);
    wheel.visible = false;
    spin.add(wheel);
    const c = templateCaliper(fromFile, r, left);
    if (c) steer.add(c);
    return { steer, spin, file: { key: `wheel|${style}`, wheel } };
  }
  const tire = new THREE.Mesh(wheelGeo, TIRE);
  tire.scale.set(width, r, r);
  tire.castShadow = true;
  spin.add(tire);
  const rim = new THREE.Mesh(wheelGeo, RIM);
  rim.scale.set(width + 0.02, r * 0.6, r * 0.6);
  spin.add(rim);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(boxGeo(width + 0.04, r * 1.1, 0.07), DARK);
    spoke.rotation.x = (i * Math.PI) / 3;
    spin.add(spoke);
  }
  return { steer, spin };
}

export function setIndicators(lights: VehicleLights, left: boolean, right: boolean): void {
  for (const m of lights.left) m.visible = left;
  for (const m of lights.right) m.visible = right;
}

export function setBrake(lights: VehicleLights, on: boolean): void {
  for (const m of lights.brake) m.material = on ? BRAKE_ON : BRAKE_DIM;
  for (const m of lights.third) m.material = on ? BRAKE_ON : BRAKE3_OFF;
}

/**
 * Merge a model's static parts into one mesh per material (lights stay separate
 * so they can blink), to keep draw calls low with dozens of vehicles on screen.
 */
export function compactModel(model: VehicleModel): VehicleModel {
  const { root, lights } = model;
  const keep = new Set<THREE.Object3D>([...lights.left, ...lights.right, ...lights.brake, ...lights.third]);
  for (const m of lights.left) m.userData.role = 'L';
  for (const m of lights.right) m.userData.role = 'R';
  for (const m of lights.brake) m.userData.role = 'B';
  for (const m of lights.third) m.userData.role = 'C';
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of [...root.children]) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || keep.has(mesh)) continue;
    mesh.updateMatrix();
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    const mat = mesh.material as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(g);
    root.remove(mesh);
  }
  for (const [mat, geos] of byMat) {
    const merged = new THREE.Mesh(mergeGeometries(geos), mat);
    merged.castShadow = mat !== GLASS;
    root.add(merged);
    geos.forEach((g) => g.dispose());
  }
  return model;
}

/** Clone a (compacted) template, re-collecting its light meshes. */
export function cloneModel(template: VehicleModel): VehicleModel {
  const root = template.root.clone(true);
  const lights: VehicleLights = { left: [], right: [], brake: [], third: [] };
  root.traverse((o) => {
    const role = o.userData.role;
    if (role === 'L') lights.left.push(o);
    else if (role === 'R') lights.right.push(o);
    else if (role === 'B') lights.brake.push(o as THREE.Mesh);
    else if (role === 'C') lights.third.push(o as THREE.Mesh);
  });
  return { root, lights };
}

/**
 * Unit wheel (radius 1, width 1, axle along X) as one vertex-coloured geometry,
 * so every NPC wheel can share a single InstancedMesh.
 */
export function unitWheelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, color: number) => {
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  parts.push(paint(new THREE.CylinderGeometry(1, 1, 1, 14).rotateZ(Math.PI / 2), 0x151515));
  parts.push(paint(new THREE.CylinderGeometry(0.6, 0.6, 1.06, 12).rotateZ(Math.PI / 2), 0x9a9a9a));
  for (let i = 0; i < 3; i++) {
    parts.push(paint(new THREE.BoxGeometry(1.1, 1.15, 0.16).rotateX((i * Math.PI) / 3), 0x2a2a2a));
  }
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
  parts.forEach((g) => g.dispose());
  return merged;
}
