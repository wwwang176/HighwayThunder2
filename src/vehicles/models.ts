import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural low-poly vehicles. Every model's origin is the center of its
 * physics box (so ground is at y = -height/2) and its front points to -Z.
 */

export interface VehicleLights {
  left: THREE.Object3D[];
  right: THREE.Object3D[];
  brake: THREE.Mesh[];
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
function basic(color: number): THREE.MeshBasicMaterial {
  const key = `b${color}`;
  let m = matCache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    matCache.set(key, m);
  }
  return m;
}

export const BRAKE_DIM = std(0x5a0a0a, 0.5);
export const BRAKE_ON = basic(0xff2020);
const INDICATOR = basic(0xffa500);
const GLASS = std(0x1a2430, 0.15, 0.6);
const TIRE = std(0x151515, 0.9);
const RIM = std(0x9a9a9a, 0.4, 0.6);
const HEADLIGHT = basic(0xfff6d8);
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
) {
  for (const side of [-1, 1]) {
    const list = side < 0 ? lights.left : lights.right;
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

/** Generic sedan / player car. */
export function buildCar(w: number, h: number, l: number, color: number, sporty = false): VehicleModel {
  const root = new THREE.Group();
  const lights: VehicleLights = { left: [], right: [], brake: [] };
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
  wheels(root, g, w / 2 - 0.1, [-l * 0.32, l * 0.32], 0.33);
  addLights(root, lights, w / 2, g + 0.28 + bodyH * 0.7, -l / 2, l / 2);
  return { root, lights };
}

export function buildTruck(w: number, h: number, l: number, color: number): VehicleModel {
  const root = new THREE.Group();
  const lights: VehicleLights = { left: [], right: [], brake: [] };
  const g = -h / 2;
  const cabL = 2.3;
  const cab = std(color, 0.5);
  box(root, w * 0.97, 0.5, l, DARK, 0, g + 0.75, 0); // chassis
  box(root, w * 0.97, 2.0, cabL, cab, 0, g + 1.0 + 1.0, -l / 2 + cabL / 2);
  box(root, w * 0.92, 0.75, 0.05, GLASS, 0, g + 2.35, -l / 2 - 0.01, false);
  const cargoL = l - cabL - 0.2;
  box(root, w, h - 1.05, cargoL, std(0xe6e6e6, 0.7), 0, g + 1.05 + (h - 1.05) / 2, l / 2 - cargoL / 2);
  box(root, w + 0.01, 0.35, cargoL * 0.9, cab, 0, g + 2.2, l / 2 - cargoL / 2, false); // stripe
  wheels(root, g, w / 2 - 0.2, [-l / 2 + 1.3, l / 2 - 2.2, l / 2 - 1.2], 0.5, 0.35);
  addLights(root, lights, w / 2, g + 0.9, -l / 2, l / 2);
  return { root, lights };
}

/** Container truck: separate cab and trailer models (each centered on its own body). */
export function buildContainerCab(w: number, h: number, cabL: number, color: number): VehicleModel {
  const root = new THREE.Group();
  const lights: VehicleLights = { left: [], right: [], brake: [] };
  const g = -h / 2;
  const paint = std(color, 0.4, 0.3);
  box(root, w * 0.9, 0.5, cabL, DARK, 0, g + 0.8, 0); // frame
  box(root, w, 2.4, 2.4, paint, 0, g + 1.05 + 1.2, -cabL / 2 + 1.2);
  box(root, w * 0.94, 0.8, 0.05, GLASS, 0, g + 2.6, -cabL / 2 - 0.01, false);
  box(root, w * 0.9, 0.5, 0.8, paint, 0, g + 3.5, -cabL / 2 + 1.6); // roof fairing
  box(root, w * 0.8, 0.12, 0.6, CHROME, 0, g + 0.65, -cabL / 2 - 0.05, false); // bumper
  box(root, 1.3, 0.15, 1.4, DARK, 0, g + 1.1, cabL / 2 - 1.0); // fifth wheel
  wheels(root, g, w / 2 - 0.2, [-cabL / 2 + 1.1, cabL / 2 - 1.5, cabL / 2 - 0.5], 0.52, 0.35);
  addLights(root, lights, w / 2, g + 1.0, -cabL / 2, cabL / 2 - 0.3);
  return { root, lights };
}

export function buildContainerTrailer(w: number, h: number, trailerL: number, color: number): VehicleModel {
  const root = new THREE.Group();
  const lights: VehicleLights = { left: [], right: [], brake: [] };
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
  wheels(root, g, w / 2 - 0.2, [trailerL / 2 - 3.0, trailerL / 2 - 2.0, trailerL / 2 - 1.0], 0.5, 0.35);
  addLights(root, lights, w / 2, g + 1.0, null, trailerL / 2);
  return { root, lights };
}

export function setIndicators(lights: VehicleLights, left: boolean, right: boolean): void {
  for (const m of lights.left) m.visible = left;
  for (const m of lights.right) m.visible = right;
}

export function setBrake(lights: VehicleLights, on: boolean): void {
  for (const m of lights.brake) m.material = on ? BRAKE_ON : BRAKE_DIM;
}

/**
 * Merge a model's static parts into one mesh per material (lights stay separate
 * so they can blink), to keep draw calls low with dozens of vehicles on screen.
 */
export function compactModel(model: VehicleModel): VehicleModel {
  const { root, lights } = model;
  const keep = new Set<THREE.Object3D>([...lights.left, ...lights.right, ...lights.brake]);
  for (const m of lights.left) m.userData.role = 'L';
  for (const m of lights.right) m.userData.role = 'R';
  for (const m of lights.brake) m.userData.role = 'B';
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
  const lights: VehicleLights = { left: [], right: [], brake: [] };
  root.traverse((o) => {
    const role = o.userData.role;
    if (role === 'L') lights.left.push(o);
    else if (role === 'R') lights.right.push(o);
    else if (role === 'B') lights.brake.push(o as THREE.Mesh);
  });
  return { root, lights };
}
