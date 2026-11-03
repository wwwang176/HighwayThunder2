import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CarStyle } from './cars/types';

/**
 * Car bodies made in Blender (tools/models/*.py → public/models/*.glb, see
 * docs/car-models.md), loaded once at start-up. A style without a file here
 * (or before loading, or in the tests) keeps its procedural body from models.ts.
 *
 * What a file holds (by node name): `body` (materials `paint`, `glass`); lamps
 * `head_L` `head_R`, `tail_L` `tail_R` (also the brake lights; extras `bar`: a
 * light bar), `ind_FL` `ind_FR` `ind_RL` `ind_RR`; and one `wheel` at the
 * origin, axle along X, its rim facing +X (extras: where the wheels go, `x`,
 * `front`, `rear` along the nose, and its radius `r`); maybe a `caliper`, where
 * it sits on that wheel (it steers with the wheel but doesn't roll; mirrored on
 * the left). The body's origin is the centre of the physics box (ground at
 * -0.55), its nose toward -Z.
 *
 * Beside it, `<file without .glb>/liveries.json`: the paint jobs, each a texture
 * for the `paint` material (the first is the car's own).
 *
 * The traffic's bodies too (`sedan`, `truck`: models.ts buildTrafficBody), their
 * own wheels and lamps from the same file; a truck's box is `plain` (no livery).
 */
export type TrafficModel = 'sedan' | 'truck';
type ModelName = CarStyle | TrafficModel;

const FILES: Partial<Record<ModelName, string>> = {
  super: 'models/supercar.glb',
  muscle: 'models/muscle-car.glb',
  jdm: 'models/jdm.glb',
  sedan: 'models/sedan.glb',
  truck: 'models/truck.glb',
};

/** Where a file car's wheels go (model space; nose toward -Z) and their radius. */
export interface WheelSpots {
  x: number;
  front: number;
  rear: number;
  r: number;
}

export interface CarTemplate {
  /** Everything but the wheel. */
  body: THREE.Object3D;
  wheel: THREE.Object3D | null;
  /** On the wheel, not rolling with it. */
  caliper: THREE.Object3D | null;
  spots: WheelSpots | null;
  /** Paint jobs by name, in the file's order (the first is the car's own). */
  liveries: Map<string, THREE.Texture>;
}

interface LiveryEntry {
  name: string;
  file: string;
}

const templates = new Map<ModelName, CarTemplate>();

export function carTemplate(style: ModelName): CarTemplate | undefined {
  return templates.get(style);
}

/** One of a style's paint jobs at random (none for a car without them). */
export function randomLivery(style: CarStyle): string | undefined {
  const names = [...(templates.get(style)?.liveries.keys() ?? [])];
  return names.length ? names[Math.floor(Math.random() * names.length)] : undefined;
}

/** Load every car file; one that fails to load leaves its car procedural. */
export async function loadCarModels(base = import.meta.env.BASE_URL): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    Object.entries(FILES).map(async ([style, file]) => {
      try {
        const [gltf, liveries] = await Promise.all([loader.loadAsync(base + file), loadLiveries(base + file.replace(/\.glb$/, '/'))]);
        const wheel = gltf.scene.getObjectByName('wheel') ?? null;
        wheel?.removeFromParent();
        const caliper = gltf.scene.getObjectByName('caliper') ?? null;
        caliper?.removeFromParent();
        const spots = wheel && 'r' in wheel.userData ? (wheel.userData as WheelSpots) : null;
        templates.set(style as ModelName, { body: gltf.scene, wheel, caliper, spots, liveries });
      } catch (e) {
        console.warn(`car model ${file} not loaded, using the built-in shape`, e);
      }
    }),
  );
}

/** The paint jobs in `dir` (none if it has no liveries.json). */
async function loadLiveries(dir: string): Promise<Map<string, THREE.Texture>> {
  const out = new Map<string, THREE.Texture>();
  const res = await fetch(dir + 'liveries.json');
  if (!res.ok) return out;
  const list = (await res.json()) as LiveryEntry[];
  const loader = new THREE.TextureLoader();
  const textures = await Promise.all(list.map((l) => loader.loadAsync(dir + l.file)));
  list.forEach((l, i) => {
    const t = textures[i];
    t.flipY = false; // glTF's UV convention
    t.colorSpace = THREE.SRGBColorSpace;
    out.set(l.name, t);
  });
  return out;
}
