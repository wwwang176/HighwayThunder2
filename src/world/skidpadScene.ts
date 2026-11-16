import * as THREE from 'three';
import { makeFlareMaterial } from '../render/lightFlares';
import { Centerline, STRAIGHT_ROAD } from '../road/centerline';
import { SKIDPAD } from '../road/skidpad';
import type { Scenery } from './roadScene';

/** Daylight: the sky, its light, the sun - the lines on the ground seen far (at night only in the headlights). */
const DAY = { sky: 0x9cc6ef, hemiSky: 0xdfefff, hemiGround: 0x5a5a50, hemi: 1.3, sun: 2.4, fogNear: 300, fogFar: 1400 };
/** The tarmac's colour and its lines' (white), the rings' (yellow), the walls'. */
const COLOURS = { tarmac: '#4a4c50', line: '#e8e8e8', ring: 0xffd23a, wall: 0xb8b4aa };
/** Lines' widths (m): every `minor` m thin, every `major` m bold. */
const LINE = { minor: 0.12, major: 0.3 };
/** The texture's pixels to a `major` tile. */
const TILE_PX = 512;

/** One `major`-square tile of the ground: the bold line on its edges, thin ones every `minor`. */
function gridTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = TILE_PX;
  const g = c.getContext('2d')!;
  g.fillStyle = COLOURS.tarmac;
  g.fillRect(0, 0, TILE_PX, TILE_PX);
  const px = TILE_PX / SKIDPAD.major;
  g.fillStyle = COLOURS.line;
  for (let m = SKIDPAD.minor; m < SKIDPAD.major - 1e-6; m += SKIDPAD.minor) {
    const w = LINE.minor * px;
    g.fillRect(m * px - w / 2, 0, w, TILE_PX);
    g.fillRect(0, m * px - w / 2, TILE_PX, w);
  }
  // (the bold one on the tile's edges: half each side, the next tile the other half)
  const w = (LINE.major * px) / 2;
  g.fillRect(0, 0, w, TILE_PX);
  g.fillRect(TILE_PX - w, 0, w, TILE_PX);
  g.fillRect(0, 0, TILE_PX, w);
  g.fillRect(0, TILE_PX - w, TILE_PX, w);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

/** A number painted flat on the ground (m), its top toward the way the road runs. */
function label(text: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = COLOURS.line;
  g.font = 'bold 96px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.9, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

/**
 * The drift practice ground (?skidpad; road/skidpad): flat tarmac lined every SKIDPAD.minor m, bold every major m with
 * its distance from the start painted along the middle and across the start, two rings round a point ahead (a
 * hairpin's sizes), walls along its sides; daylight.
 */
export class SkidpadScene implements Scenery {
  readonly lampFlareMaterial = makeFlareMaterial(2.5);
  readonly groundMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly group = new THREE.Group();
  private readonly grid: THREE.CanvasTexture;
  private line: Centerline = STRAIGHT_ROAD;

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
  ) {
    scene.background = new THREE.Color(DAY.sky);
    scene.fog = new THREE.Fog(DAY.sky, DAY.fogNear, DAY.fogFar);
    scene.add(new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemi));
    const sun = new THREE.DirectionalLight(0xfff6e8, DAY.sun);
    sun.position.set(300, 500, 200);
    scene.add(sun);
    this.grid = gridTexture(renderer);
    scene.add(this.group);
  }

  setRoad(line: Centerline): void {
    this.line = line;
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
    }
    this.groundMaterials.length = 0;
    const P = SKIDPAD;
    const at = (s: number, d: number) => line.toWorld(s, d);
    const h = (s: number) => line.height(s);
    // The ground: one quad, its texture in metres from the start (a tile a major square).
    const s0 = -100, s1 = P.length + 100, d0 = -P.half - 40, d1 = P.half + 40;
    const corners: [number, number][] = [[s0, d0], [s0, d1], [s1, d1], [s1, d0]];
    const pos: number[] = [];
    const uv: number[] = [];
    for (const [s, d] of corners) {
      const w = at(s, d);
      pos.push(w.x, h(s), w.z);
      uv.push(d / P.major, (s - P.start) / P.major);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    geo.computeVertexNormals();
    if (geo.getAttribute('normal').getY(0) < 0) geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.grid, roughness: 0.92 }));
    this.groundMaterials.push(ground.material as THREE.MeshStandardMaterial);
    this.group.add(ground);
    const heading = line.heading(P.start);
    // Distances painted: along the middle every major m from the start, and across the start.
    const put = (m: THREE.Mesh, s: number, d: number) => {
      const w = at(s, d);
      m.position.set(w.x, h(s) + 0.02, w.z);
      m.rotation.z = -heading;
      this.group.add(m);
    };
    for (let k = Math.ceil((0 - P.start) / P.major); k * P.major <= P.length - P.start; k++) put(label(`${k * P.major}`), P.start + k * P.major + 1.2, 2.2);
    for (let k = -Math.floor(P.half / P.major); k * P.major <= P.half; k++) if (k !== 0) put(label(`${Math.abs(k * P.major)}`), P.start - 1.2, k * P.major + 2.2);
    // The rings round a point ahead.
    for (const r of P.rings) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - LINE.major / 2, r + LINE.major / 2, 160), new THREE.MeshStandardMaterial({ color: COLOURS.ring, roughness: 0.8 }));
      const w = at(P.start + P.ringAt, 0);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(w.x, h(P.start + P.ringAt) + 0.015, w.z);
      this.group.add(ring);
    }
    // Walls along its sides (the physics' rails).
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, P.length + 200), new THREE.MeshStandardMaterial({ color: COLOURS.wall, roughness: 0.9 }));
      const w = at(P.length / 2, side * (P.half + 0.5));
      wall.position.set(w.x, h(P.length / 2) + 0.6, w.z);
      wall.rotation.y = -line.heading(P.length / 2);
      this.group.add(wall);
    }
  }

  update(): void {}

  activeLights(): THREE.SpotLight[] {
    return [];
  }

  /** (kept for tidiness: the road it was laid along) */
  get road(): Centerline {
    return this.line;
  }

  dispose(): void {
    this.scene.remove(this.group);
  }
}
