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
 * light bar), `ind_FL` `ind_FR` `ind_RL` `ind_RR`, maybe `brake_C` (the third brake light, at the
 * rear window's top: the cars, not the trucks); and one `wheel` at the
 * origin, axle along X, its rim facing +X (extras: where the wheels go, `x`,
 * `front`, `rear` along the nose, and its radius `r`); maybe a `caliper`, where
 * it sits on that wheel (it steers with the wheel but doesn't roll; mirrored on
 * the left); maybe exhaust pipes, `exhaust_0`, `exhaust_1`, ..., each with its
 * origin at its tip (models.ts: root.userData.exhausts). The body's origin is the centre of the physics box (ground at
 * -0.55), its nose toward -Z.
 *
 * Beside it, `<file without .glb>/liveries.json`: the paint jobs, each a texture
 * for the `paint` material (the first is the car's own).
 *
 * The traffic's bodies too (`sedan`, `truck`, the container truck's `cab` and
 * `trailer`: models.ts buildTrafficBody), their own wheels and lamps from the
 * same file; a truck's box is `plain` (no livery), what of a body has no paint on
 * it `trim` (the generated texture).
 */
export type TrafficModel = 'sedan' | 'truck' | 'cab' | 'trailer';
type ModelName = CarStyle | TrafficModel;

const FILES: Partial<Record<ModelName, string>> = {
  super: 'models/supercar.glb',
  muscle: 'models/muscle-car.glb',
  jdm: 'models/jdm.glb',
  sedan: 'models/sedan.glb',
  truck: 'models/truck.glb',
  cab: 'models/cab.glb',
  trailer: 'models/trailer.glb',
};

/**
 * Where each file's headlight glows (its flare sprite, render/lightFlares): the left lamp's, in the file's space
 * (nose toward -Z; the right lamp's mirrored), just ahead of the lamp's face. Measured off the files' head_L meshes -
 * UPDATE THESE WHEN A MODEL'S HEADLIGHTS MOVE OR CHANGE SHAPE (a file not listed: its lamp's box, which a strip
 * swept back across the nose, the supercar's, leaves floating ahead of it).
 */
const HEAD_GLOW: Partial<Record<ModelName, [number, number, number]>> = {
  super: [-0.694, -0.05, -2.011], // (the swept strip's middle)
  muscle: [-0.607, 0.101, -2.119],
  jdm: [-0.6, -0.012, -2.025],
  sedan: [-0.527, 0.074, -2.025],
  truck: [-0.884, 0.504, -3.665],
  cab: [-0.896, 0.294, -3.441],
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
  /** Its left headlight's glow (file space: HEAD_GLOW), if listed. */
  headGlow: THREE.Vector3 | null;
  /** Paint jobs by name, in the file's order (the first is the car's own). */
  liveries: Map<string, THREE.Texture>;
  /** The same, what they are (their colours: the garage's swatches). */
  paints: PaintJob[];
}

/** A paint job: its name, its paint and stripes (none: plain), as CSS colours. */
export interface PaintJob {
  name: string;
  paint: string;
  stripe: string | null;
}

interface LiveryEntry extends PaintJob {
  file: string;
}

const templates = new Map<ModelName, CarTemplate>();

export function carTemplate(style: ModelName): CarTemplate | undefined {
  return templates.get(style);
}

/** A style's paint jobs (none before its file is loaded, or without one). */
export function paintJobs(style: CarStyle): PaintJob[] {
  return templates.get(style)?.paints ?? [];
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
        // Double-sided parts cast shadows from their back faces only, as single-sided ones do: three picks a
        // shadow shader per side by the order things are drawn in, and the double-sided one came along
        // mid-race, compiled there (~60 ms) whatever was drawn ahead of the race (Game.prewarm).
        gltf.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (m && m.side === THREE.DoubleSide) m.shadowSide = THREE.BackSide;
        });
        const wheel = gltf.scene.getObjectByName('wheel') ?? null;
        wheel?.removeFromParent();
        const caliper = gltf.scene.getObjectByName('caliper') ?? null;
        caliper?.removeFromParent();
        const spots = wheel && 'r' in wheel.userData ? (wheel.userData as WheelSpots) : null;
        const glow = HEAD_GLOW[style as ModelName];
        const headGlow = glow ? new THREE.Vector3(...glow) : null;
        templates.set(style as ModelName, { body: gltf.scene, wheel, caliper, spots, headGlow, ...liveries });
      } catch (e) {
        console.warn(`car model ${file} not loaded, using the built-in shape`, e);
      }
    }),
  );
}

/** The paint jobs in `dir` (none if it has no liveries.json): their textures by name, and what they are. */
async function loadLiveries(dir: string): Promise<{ liveries: Map<string, THREE.Texture>; paints: PaintJob[] }> {
  const liveries = new Map<string, THREE.Texture>();
  const res = await fetch(dir + 'liveries.json');
  if (!res.ok) return { liveries, paints: [] };
  const list = (await res.json()) as LiveryEntry[];
  const loader = new THREE.TextureLoader();
  const textures = await Promise.all(list.map((l) => loader.loadAsync(dir + l.file)));
  list.forEach((l, i) => {
    const t = textures[i];
    t.flipY = false; // glTF's UV convention
    t.colorSpace = THREE.SRGBColorSpace;
    liveries.set(l.name, t);
  });
  return { liveries, paints: list.map(({ name, paint, stripe }) => ({ name, paint, stripe })) };
}
