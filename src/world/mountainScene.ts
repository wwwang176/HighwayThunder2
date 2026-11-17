import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeFlareMaterial } from '../render/lightFlares';
import { Centerline, STRAIGHT_ROAD } from '../road/centerline';
import { insideReach, MOUNTAIN, roadEdges } from '../road/mountain';
import { rolling, TERRAIN, terrainOf, type Terrain } from '../road/terrain';
import { roadRows } from '../road/surface';
import { repeating, type Scenery, withAsphalt } from './roadScene';

/** Night on the mountain: no street lights - the cars' lamps, the moon and the stars. */
const SKY = 0x04060d;
const FOG = 0x06080f;
const LIGHT = {
  // (the player's: no street lights, a little more about - 0.5 and 0.35 at first)
  hemi: 0.9,
  moon: 0.5,
};
/** The road's markings: the centre's double yellow line (d, m). */
const CENTRE_LINE = { off: 0.12, width: 0.1 };
/**
 * The ground (terrainOf: the natural ground through the road's heights, the road cut into it or built up on it): its
 * colour by how steep it is - grass, earth, rock (a cut's face) - and the strip along each edge, its points `cols` m past
 * it (to TERRAIN.seam), that meets the road's edge exactly - the grid's own nodes `sink` m under it wherever a triangle of
 * theirs (`overlap` m across) would still be under the strip: never both seen (the player's: one showed through the other).
 * Both lit by the ground's own normals (Terrain.normal) - the strip's own past `lit` m, eased in: no crease where they meet.
 */
const GROUND = { grass: 0x46503a, rock: 0x6a635a, steep: 0.62, flat: 0.86, sink: 0.8, overlap: 4.3, lit: [2.5, 6], cols: [0, 0.3, 0.6, 0.9, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.25, TERRAIN.seam] };
/** A rail where the ground does not rise `rail` m by `railAt` m past the edge (a cut's face is barrier enough), in runs no shorter than `railRun` m. */
const RAIL_WHERE = { rail: 1, railAt: 2.5, railRun: 16 };
/** The guardrail: its beam's bottom and top over the road, posts and reflectors (m apart). */
const RAIL = { y0: 0.5, y1: 0.82, post: 4, reflector: 8 };
/**
 * Chevron boards outside the bends, two to a post (one for each way): `width` m wide, `tall` m high (3:4 upright, as
 * the real one-chevron alignment sign's: 45 x 60 cm, 60 x 75 - not square), `height` m up, each turned to the
 * drivers coming its way - toward the road `sight` m back along it, so the
 * two open out away from the road at an angle (the sharper the bend, the wider), their inner edges `gap` m apart at
 * the post. No light of their own: they reflect what reaches them `reflect` times as strongly as paint (a reflective
 * sheeting's) - faint under the moon, bright in the low beam, glaring in the high beam (the player's real lamps).
 */
const CHEVRON = { width: 0.6, tall: 0.8, height: 1.1, reflect: 3.5, roughness: 0.35, sight: 40, gap: 0.02 };
/**
 * How sharp a bend is, by its tightest radius (m): how far apart its boards stand (m; one chevron each, whatever the
 * bend - the user's: as the road's own signs) - a big bend (to R 130: at 150 km/h it wants more grip than the cars
 * have from R 100 down) every 16 m, a hairpin every 6.
 */
export const CHEVRON_LEVELS = [
  { radius: 130, spacing: 16 },
  { radius: 80, spacing: 10 },
  { radius: 40, spacing: 6 },
];

/** Where the chevron boards stand along the road: each bend tighter than the first level's radius, by its tightest. */
export function chevronSpots(road: Centerline): { s: number; dir: number; level: number }[] {
  const spots: { s: number; dir: number; level: number }[] = [];
  const kMin = 1 / CHEVRON_LEVELS[0].radius;
  let s = 0;
  while (s < road.length) {
    const k = road.curvature(s);
    if (Math.abs(k) <= kMin) {
      s += 1;
      continue;
    }
    const dir = Math.sign(k);
    let end = s;
    let tightest = Infinity;
    while (end < road.length && Math.abs(road.curvature(end)) > kMin && Math.sign(road.curvature(end)) === dir) {
      tightest = Math.min(tightest, 1 / Math.abs(road.curvature(end)));
      end += 1;
    }
    let level = 1;
    CHEVRON_LEVELS.forEach((l, i) => {
      if (tightest <= l.radius) level = i + 1;
    });
    for (let t = s; t <= end; t += CHEVRON_LEVELS[level - 1].spacing) spots.push({ s: t, dir, level });
    s = end + 1;
  }
  return spots;
}
/**
 * The amber lamp blinking on top of each chevron board: no light of its own, only bright enough (over white: the
 * bloom's) to glow. Its colour times `bright` lit, `dim` between; lit `on` of every `period` s (race time).
 */
/**
 * What grows on the mountain (the player's: a forest off the road, brush between it and the road). Trees past `treeFrom`
 * m from the road's edge and within `treeTo` m of its centre line (the player's: none far off it, never seen), one a
 * `treeStep` m square at most (jittered), in stands - where value noise `stand` m across
 * runs over `cover` (less of them toward its edge) - none where the ground is steeper than `steep` (its normal's up);
 * `tree` their size (m) and colours. Grass (the player's: a patch of little grass, the ground made of many blades - not
 * lumps, they looked like stones): tufts of `blades` thin blades, `grassFrom` to `grassTo` m off the edge in patches -
 * one a `patchStep` m square at most, the likelier the nearer the trees and where noise `patchSize` m across runs high,
 * `patch` tufts within `patchR` m - and between them single tufts here and there out to `looseTo` m, one a `looseStep` m
 * square at most at `loose` odds; none on ground steeper than `grassSteep` (a cut's face).
 */
const PLANTS = {
  treeStep: 6.5,
  treeFrom: 14,
  treeTo: 150,
  stand: 150,
  cover: 0.05,
  steep: 0.8,
  tree: { trunk: 2.2, low: 4.4, high: 3.6, wide: 2.1, bark: 0x3a2a1e, needles: 0x23331f },
  grassFrom: 1.5,
  grassTo: 22,
  patchStep: 4,
  patchSize: 30,
  patch: [20, 40],
  patchR: 2.2,
  looseTo: 40,
  looseStep: 2.5,
  loose: 0.5,
  grassSteep: 0.6,
  blades: 7,
  grass: { root: 0x22301a, tip: 0x5c7330, height: [0.35, 0.7] },
  /** Grass drawn in blocks `block` m square, only those within `show` m of the player (the player's: far off it is not seen). */
  block: 50,
  show: 110,
};
const BEACON = { color: new THREE.Color(1, 0.68, 0.06), bright: 6, dim: 0.06, period: 1, on: 0.45, radius: 0.09 };

const RUN_FROM = -MOUNTAIN.before;
const RUN_TO = () => MOUNTAIN.length + MOUNTAIN.after;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The markings over the asphalt: 2 x edge m across (shoulder to shoulder), 20 m along. */
function markingsTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const W = 512; // (the yellow lines a couple of px wide across the wider road)
  const H = 512;
  const span = 2 * MOUNTAIN.edge;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const x = (d: number) => ((d + MOUNTAIN.edge) / span) * W;
  g.fillStyle = '#45474b';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#4f5054'; // (the shoulders)
  g.fillRect(0, 0, x(-MOUNTAIN.halfWidth), H);
  g.fillRect(x(MOUNTAIN.halfWidth), 0, W - x(MOUNTAIN.halfWidth), H);
  g.fillStyle = '#e0b020';
  for (const s of [-1, 1]) g.fillRect(x(s * CENTRE_LINE.off - CENTRE_LINE.width / 2), 0, (CENTRE_LINE.width / span) * W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A yellow chevron board pointing right (a left bend's: flipped), as tall as CHEVRON's (3:4). */
function chevronTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#111';
  g.fillRect(0, 0, 96, 128);
  g.fillStyle = '#f2c200';
  g.beginPath();
  g.moveTo(20, 14);
  g.lineTo(56, 64);
  g.lineTo(20, 114);
  g.lineTo(40, 114);
  g.lineTo(76, 64);
  g.lineTo(40, 14);
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A strip along the road: at each row (s), a cross-section of points (`cols(s, i)`: road d and height over the road),
 * joined row to row. `u` along the cross-section's points (0..1; or each point's own, `us`), `v` along the road (s / vScale).
 */
function strip(road: Centerline, rows: number[], ncol: number, cols: (s: number, i: number, out: [number, number][]) => void, vScale: number, us?: number[]): THREE.BufferGeometry {
  const n = rows.length;
  const pos = new Float32Array(n * ncol * 3);
  const uv = new Float32Array(n * ncol * 2);
  const pts: [number, number][] = Array.from({ length: ncol }, () => [0, 0]);
  rows.forEach((s, r) => {
    cols(s, r, pts);
    for (let j = 0; j < ncol; j++) {
      const d = pts[j][0];
      const w = road.toWorld(s, d);
      const k = r * ncol + j;
      pos[3 * k] = w.x;
      pos[3 * k + 1] = edgeHeight(road, s, d) + pts[j][1];
      pos[3 * k + 2] = w.z;
      uv[2 * k] = us ? us[j] : j / (ncol - 1);
      uv[2 * k + 1] = s / vScale;
    }
  });
  const idx: number[] = [];
  for (let r = 0; r + 1 < n; r++)
    for (let j = 0; j + 1 < ncol; j++) {
      const a = r * ncol + j;
      const b = a + 1;
      const c = a + ncol;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * The height things are set on at (s, d): the road's banked surface, its bank carried no further than its edge there
 * (roadEdges: a shoulder's too) - the ground off the road goes on from where it ends, not tilted on out with it.
 */
function edgeHeight(road: Centerline, s: number, d: number): number {
  const e = roadEdges(road);
  return road.surfaceHeight(s, Math.max(-e.at(s, -1), Math.min(e.at(s, 1), d)));
}

/**
 * The edge's strip lit as the ground past it is: each row's points past GROUND.lit[0] m from the edge turning to the
 * ground's own normals by GROUND.lit[1] m (nearer the road, the ditch and the cut's foot, its own).
 */
function litLikeTheGround(geo: THREE.BufferGeometry, t: Terrain, ncol: number): void {
  // (its triangles turned face up first: a strip on the road's left is wound the other way - lit from below, mixed
  // with the ground's normals it went black)
  let up = 0;
  const n0 = geo.getAttribute('normal');
  for (let i = 0; i < n0.count; i++) up += n0.getY(i);
  if (up < 0) {
    const idx = geo.getIndex()!;
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
    idx.needsUpdate = true;
    geo.computeVertexNormals();
  }
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const [a, b] = GROUND.lit;
  for (let i = 0; i < pos.count; i++) {
    const past = GROUND.cols[i % ncol];
    const w = Math.max(0, Math.min(1, (past - a) / (b - a)));
    if (w <= 0) continue;
    const g = t.normal(pos.getX(i), pos.getZ(i));
    const x = nrm.getX(i) * (1 - w) + g[0] * w, y = nrm.getY(i) * (1 - w) + g[1] * w, z = nrm.getZ(i) * (1 - w) + g[2] * w;
    const l = Math.hypot(x, y, z) || 1;
    nrm.setXYZ(i, x / l, y / l, z / l);
  }
  nrm.needsUpdate = true;
}

/** Colours a ground mesh by how steep it is (its normals): grass where gentle, rock where steep (a cut's face). */
function shadeBySlope(geo: THREE.BufferGeometry): void {
  const nrm = geo.getAttribute('normal');
  const col = new Float32Array(nrm.count * 3);
  const grass = new THREE.Color(GROUND.grass), rock = new THREE.Color(GROUND.rock), c = new THREE.Color();
  for (let i = 0; i < nrm.count; i++) {
    const up = Math.abs(nrm.getY(i));
    const t = Math.max(0, Math.min(1, (GROUND.flat - up) / (GROUND.flat - GROUND.steep)));
    c.copy(grass).lerp(rock, t * t * (3 - 2 * t));
    col[3 * i] = c.r;
    col[3 * i + 1] = c.g;
    col[3 * i + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/**
 * The mountain road's scenery, the whole course laid once a race (setRoad): the asphalt with its markings, the ground
 * (terrainOf: the mountainside, the road cut into it and built up on it), the guardrail with its reflectors where the
 * ground does not rise beside it, chevron boards outside the tight bends, the forest and the grass; the night sky, the
 * moon, far ridges.
 */
export class MountainScene implements Scenery {
  readonly lampFlareMaterial = makeFlareMaterial(2.5);
  readonly groundMaterials: THREE.MeshStandardMaterial[] = [];
  private line: Centerline = STRAIGHT_ROAD;
  private readonly course = new THREE.Group();
  private readonly far = new THREE.Group();
  private readonly roadMat: THREE.MeshStandardMaterial;
  private readonly groundMat: THREE.MeshStandardMaterial;
  private readonly seamMat: THREE.MeshStandardMaterial;
  private readonly plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  private readonly grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  private readonly railMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
  private readonly postMat = new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.4, roughness: 0.5 });
  /**
   * The rail's reflectors: retroreflective as the chevron boards (headlight's RETRO) - not lit of their own; a tenth as
   * bright as a board's (low on the rail: in the beam, where a board above it has only its stray light).
   */
  private readonly reflectorMat = Object.assign(
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0xffa640).multiplyScalar(CHEVRON.reflect * 0.1), roughness: CHEVRON.roughness }),
    { defines: { HT2_RETRO: '' } },
  );
  private readonly chevronMat: THREE.MeshStandardMaterial;
  private readonly beaconMat = new THREE.MeshBasicMaterial({ color: BEACON.color.clone(), toneMapped: false, fog: false });
  /** Race time (s) the beacons blink by. */
  private time = 0;
  /** The grass's blocks (their centres): shown only near the player (PLANTS.show). */
  private grassBlocks: { mesh: THREE.InstancedMesh; x: number; z: number }[] = [];

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(FOG, 50, 520);
    scene.add(new THREE.HemisphereLight(0x22304c, 0x07080a, LIGHT.hemi));
    const moon = new THREE.DirectionalLight(0x9fb2e0, LIGHT.moon);
    moon.position.set(-300, 400, 150);
    scene.add(moon);
    this.roadMat = withAsphalt(new THREE.MeshStandardMaterial({ map: markingsTexture(renderer), roughness: 0.92 }), renderer);
    this.groundMaterials.push(this.roadMat);
    const dirt = repeating('grass-small.jpg');
    dirt.repeat.set(1, 1);
    // (the grid pushed back a little: where it and the edge's strip lie together, the strip is seen)
    this.groundMat = new THREE.MeshStandardMaterial({ map: dirt, vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    this.seamMat = new THREE.MeshStandardMaterial({ map: dirt, vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    this.chevronMat = new THREE.MeshStandardMaterial({
      map: chevronTexture(),
      color: new THREE.Color(1, 1, 1).multiplyScalar(CHEVRON.reflect),
      roughness: CHEVRON.roughness,
      // (its face only: a board's chevron pointing the other way is a board of its texture mirrored, not of its matrix -
      // mirrored by a negative scale (an instance's, which three.js does not see), drawn from either side, its face was
      // taken for its back, its normal turned away and the lamps' light on it lost: one board of each post dark)
    });
    // (retroreflective sheeting: a lamp's light sent back toward it, bright to the driver behind it - headlight's RETRO)
    this.chevronMat.defines = { HT2_RETRO: '' };
    this.buildFar();
    scene.add(this.course, this.far);
  }

  activeLights(): THREE.SpotLight[] {
    return [];
  }

  setRoad(line: Centerline): void {
    this.line = line;
    this.clearCourse();
    const road = line;
    const rows = roadRows(road, RUN_FROM, RUN_TO());

    // The road (shoulder to shoulder; roadEdges: wider in a bend, on a tight bend's outside a shoulder more): the
    // markings' columns where they are on a straight, their asphalt and shoulder stretched across the rest.
    const E0 = MOUNTAIN.edge, H0 = MOUNTAIN.halfWidth, C = 0.5; // (C: past the centre lines)
    const edges = roadEdges(road);
    const reach = insideReach(road);
    const ground = terrainOf(road, edges);
    this.course.add(this.groundMesh(ground));
    const uOf = (d: number) => (d + E0) / (2 * E0);
    const roadGeo = strip(road, rows, 6, (s, _i, p) => {
      const half = H0 + edges.widen(s);
      p[0] = [-edges.at(s, -1), 0.01];
      p[1] = [-half, 0.01];
      p[2] = [-C, 0.01];
      p[3] = [C, 0.01];
      p[4] = [half, 0.01];
      p[5] = [edges.at(s, 1), 0.01];
    }, 20, [uOf(-E0), uOf(-H0), uOf(-C), uOf(C), uOf(H0), uOf(E0)]);
    const roadMesh = new THREE.Mesh(roadGeo, this.roadMat);
    roadMesh.receiveShadow = true;
    this.course.add(roadMesh);

    // Both sides: the ground from the road's edge out (the earthwork: a cut's ditch and face, or a fill's verge and
    // slope) meeting the grid - and the rail where the ground does not rise (a cut's face is barrier enough).
    const cutAt: Record<1 | -1, Uint8Array> = { [1]: new Uint8Array(rows.length), [-1]: new Uint8Array(rows.length) };
    for (const side of [-1, 1] as const) {
      const cut = cutAt[side];
      const seam = strip(road, rows, GROUND.cols.length, (s, i, p) => {
        const E = edges.at(s, side);
        const base = edgeHeight(road, s, side * E);
        const lim = reach(s, side); // (short of a bend's centre on its inside: past it the rows fold over)
        GROUND.cols.forEach((past, j) => {
          const d = side * Math.min(E + past, Math.max(E, lim));
          const w = road.toWorld(s, d);
          const y = ground.earthwork(ground.natural(w.x, w.z), base, Math.abs(d) - E);
          p[j] = [d, y - base];
          if (past === RAIL_WHERE.railAt) cut[i] = y - base >= RAIL_WHERE.rail ? 1 : 0;
        });
      }, 8);
      litLikeTheGround(seam, ground, GROUND.cols.length);
      shadeBySlope(seam);
      this.course.add(new THREE.Mesh(seam, this.seamMat));

      // The rail's beam (a ribbon), its posts and reflectors - only where the ground does not rise.
      const runs = this.railRuns(rows, cut);
      for (const [a, b] of runs) {
        const rr = rows.filter((s) => s >= a && s <= b);
        if (rr.length < 2) continue;
        const beam = strip(road, rr, 3, (s, _i, p) => {
          const E = edges.at(s, side);
          p[0] = [side * (E + 0.05), RAIL.y0];
          p[1] = [side * (E + 0.12), (RAIL.y0 + RAIL.y1) / 2];
          p[2] = [side * (E + 0.05), RAIL.y1];
        }, 4);
        this.course.add(new THREE.Mesh(beam, this.railMat));
      }
      this.addPosts(road, runs, side);
    }
    this.addChevrons(road, rows, cutAt);
    this.addPlants(ground, Math.round(road.length * 13) % 997);
  }

  update(playerS: number, play = 0): void {
    this.time += play;
    const lit = this.time % BEACON.period < BEACON.on;
    this.beaconMat.color.copy(BEACON.color).multiplyScalar(lit ? BEACON.bright : BEACON.dim);
    // (the far ridges and the sky go along with the player: as far off whichever way it turns)
    const c = this.line.center(playerS);
    this.far.position.set(c.x, this.line.height(playerS), c.z);
    // (the grass near the player only: a block's centre within PLANTS.show plus half its diagonal)
    const r = PLANTS.show + PLANTS.block * 0.71;
    for (const b of this.grassBlocks) b.mesh.visible = (b.x - c.x) ** 2 + (b.z - c.z) ** 2 < r * r;
  }

  /** Stretches (s from, to) for a side's rail: where no cut rises by it (`cut`, row by row) - gaps and bits shorter than RAIL_WHERE.railRun m not left. */
  private railRuns(rows: number[], cut: Uint8Array): [number, number][] {
    const raw: [number, number][] = [];
    let from: number | null = null;
    rows.forEach((s, i) => {
      const rail = !cut[i];
      if (rail && from === null) from = s;
      if (!rail && from !== null) {
        raw.push([from, rows[i - 1]]);
        from = null;
      }
    });
    if (from !== null) raw.push([from, rows[rows.length - 1]]);
    const joined: [number, number][] = [];
    for (const r of raw) {
      const last = joined[joined.length - 1];
      if (last && r[0] - last[1] < RAIL_WHERE.railRun) last[1] = r[1];
      else joined.push([r[0], r[1]]);
    }
    return joined.filter(([a, b]) => b - a >= RAIL_WHERE.railRun);
  }

  /** The ground's grid: its nodes near and under the road sunk out of sight (the road and the edge's strip there). */
  private groundMesh(t: Terrain): THREE.Mesh {
    const { nx, nz, step, x0, z0 } = t;
    const pos = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        pos[3 * k] = x0 + i * step;
        pos[3 * k + 1] = t.h[k] - (t.past[k] < 0 || t.past[k] < t.cover[k] - GROUND.overlap ? GROUND.sink : 0);
        pos[3 * k + 2] = z0 + j * step;
        uv[2 * k] = (x0 + i * step) / 8;
        uv[2 * k + 1] = (z0 + j * step) / 8;
      }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let n = 0;
    for (let j = 0; j + 1 < nz; j++)
      for (let i = 0; i + 1 < nx; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx[n++] = a; idx[n++] = c; idx[n++] = b;
        idx[n++] = b; idx[n++] = c; idx[n++] = d;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const nrm = new Float32Array(nx * nz * 3);
    for (let k = 0; k < nx * nz; k++) {
      const [ax, ay, az] = t.normal(pos[3 * k], pos[3 * k + 2]);
      nrm[3 * k] = ax;
      nrm[3 * k + 1] = ay;
      nrm[3 * k + 2] = az;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    shadeBySlope(geo);
    const mesh = new THREE.Mesh(geo, this.groundMat);
    mesh.receiveShadow = true;
    return mesh;
  }

  private addPosts(road: Centerline, runs: [number, number][], side: number): void {
    const posts: number[] = [];
    const reflectors: number[] = [];
    for (const [a, b] of runs) {
      for (let s = Math.ceil(a / RAIL.post) * RAIL.post; s <= b; s += RAIL.post) {
        posts.push(s);
        if (Math.round(s / RAIL.post) % (RAIL.reflector / RAIL.post) === 0) reflectors.push(s);
      }
    }
    const edges = roadEdges(road);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const place = (mesh: THREE.InstancedMesh, list: number[], off: number, y: number) => {
      list.forEach((s, i) => {
        const d = side * (edges.at(s, side as 1 | -1) + off); // (at the rail: a shoulder's)
        const w = road.toWorld(s, d);
        q.setFromAxisAngle(up, -road.heading(s));
        m.compose(p.set(w.x, edgeHeight(road, s, d) + y, w.z), q, one);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.course.add(mesh);
    };
    place(new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.95, 0.12), this.postMat, Math.max(1, posts.length)), posts, 0.2, 0.47);
    // (its face 0.1 m wide toward the cars coming each way: the lamps' light sent back from it)
    place(new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.09, 0.04), this.reflectorMat, Math.max(1, reflectors.length)), reflectors, 0.02, RAIL.y1 + 0.06);
  }

  /**
   * Chevron boards outside each bend (chevronSpots: closer together the sharper it is), two on each post - each turned
   * to the cars coming its way (CHEVRON.sight), opening out from the post away from the road, its chevron pointing
   * round the bend (toward the road) - and the amber lamp on top.
   */
  private addChevrons(road: Centerline, rows: number[], cutAt: Record<1 | -1, Uint8Array>): void {
    const spots = chevronSpots(road);
    // (a cut on a side at s: the nearest row's)
    const cutNear = (s: number, side: 1 | -1) => {
      let lo = 0, hi = rows.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (rows[mid] <= s) lo = mid;
        else hi = mid;
      }
      return cutAt[side][s - rows[lo] < rows[hi] - s ? lo : hi];
    };
    const edges = roadEdges(road);
    const poles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, CHEVRON.height, 0.06), this.postMat, Math.max(1, spots.length));
    const beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(BEACON.radius, 10, 8), this.beaconMat, Math.max(1, spots.length));
    // (a board's chevron pointing right of its face, or - its texture mirrored - left)
    const plane = new THREE.PlaneGeometry(CHEVRON.width, CHEVRON.tall);
    const mirrored = plane.clone();
    const uv = mirrored.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    const boards = [new THREE.InstancedMesh(plane, this.chevronMat, Math.max(1, 2 * spots.length)), new THREE.InstancedMesh(mirrored, this.chevronMat, Math.max(1, 2 * spots.length))];
    const counts = [0, 0];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    spots.forEach(({ s, dir }, i) => {
      // (outside the bend: past its shoulder - or at its edge, before the cut's face where the hill is on the outside)
      const out = -dir as 1 | -1;
      const d = out * (edges.at(s, out) + (cutNear(s, out) ? 0.05 : 0.5));
      const w = road.toWorld(s, d);
      const h = edgeHeight(road, s, d);
      const th = road.heading(s);
      const y = h + CHEVRON.height + CHEVRON.tall / 2;
      // (away from the road, across it here)
      const away = road.toWorld(s, d + out);
      const ax = away.x - w.x;
      const az = away.z - w.z;
      // A board toward the cars coming up the road (from CHEVRON.sight m back) and one toward those coming down it:
      // its face turned to them, the board out from the post away from the road, its chevron toward the road.
      for (const way of [-1, 1]) {
        const seen = road.toWorld(Math.max(-MOUNTAIN.before, Math.min(MOUNTAIN.length + MOUNTAIN.after, s + way * CHEVRON.sight)), 0);
        const yaw = Math.atan2(seen.x - w.x, seen.z - w.z); // (its face, local +z, toward them)
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw); // (its local +x)
        const outward = Math.sign(rx * ax + rz * az) || 1; // (its local +x away from the road: 1)
        const half = CHEVRON.gap / 2 + CHEVRON.width / 2;
        q.setFromEuler(e.set(0, yaw, 0));
        m.compose(p.set(w.x + outward * rx * half, y, w.z + outward * rz * half), q, sc.set(1, 1, 1));
        // (its texture's chevron points to its local +x: that away from the road, the board of the mirrored texture)
        const k = outward > 0 ? 1 : 0;
        boards[k].setMatrixAt(counts[k]++, m);
      }
      q.setFromEuler(e.set(0, -th, 0));
      m.compose(p.set(w.x, h + CHEVRON.height / 2, w.z), q, sc.set(1, 1, 1));
      poles.setMatrixAt(i, m);
      m.compose(p.set(w.x, h + CHEVRON.height + CHEVRON.tall + BEACON.radius + 0.03, w.z), q, sc.set(1, 1, 1));
      beacons.setMatrixAt(i, m);
    });
    boards.forEach((b, k) => (b.count = counts[k]));
    for (const mesh of [...boards, poles, beacons]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.course.add(mesh);
    }
  }

  /** The forest and the grass (PLANTS) on the ground, by how far each spot is from the road's edge and how steep it is. */
  private addPlants(t: Terrain, seed: number): void {
    const rnd = seeded(seed + 101);
    const pastAt = (x: number, z: number) => {
      const i = Math.round((x - t.x0) / t.step), j = Math.round((z - t.z0) / t.step);
      if (i < 0 || j < 0 || i >= t.nx || j >= t.nz) return -1;
      return t.past[j * t.nx + i];
    };
    const W = (t.nx - 1) * t.step, D = (t.nz - 1) * t.step;
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();

    // Trees: a low-poly pine - a trunk, two cones of needles (one mesh, its parts by colour).
    const P = PLANTS.tree;
    const trees: THREE.Matrix4[] = [];
    const tints: number[] = [];
    for (let z = 0; z < D; z += PLANTS.treeStep)
      for (let x = 0; x < W; x += PLANTS.treeStep) {
        const wx = t.x0 + x + rnd() * PLANTS.treeStep, wz = t.z0 + z + rnd() * PLANTS.treeStep;
        const past = pastAt(wx, wz);
        if (past < PLANTS.treeFrom) continue; // (on the road, near it, or off the ground)
        if (t.away(wx, wz) > PLANTS.treeTo) continue; // (the player's: none far off the road, not seen)
        const stand = rolling(wx, wz, PLANTS.stand, seed) - PLANTS.cover;
        if (stand < 0 || rnd() > Math.min(1, stand * 4 + 0.15)) continue;
        if (t.normal(wx, wz)[1] < PLANTS.steep) continue;
        const k = 0.7 + rnd() * 0.7;
        q.setFromAxisAngle(up, rnd() * Math.PI * 2);
        trees.push(new THREE.Matrix4().compose(p.set(wx, t.height(wx, wz) - 0.3, wz), q, sc.set(k * (0.85 + rnd() * 0.3), k, k * (0.85 + rnd() * 0.3))));
        tints.push(0.75 + rnd() * 0.45);
      }
    if (trees.length) {
      const trunk = new THREE.CylinderGeometry(0.16, 0.26, P.trunk, 6).translate(0, P.trunk / 2, 0);
      const low = new THREE.ConeGeometry(P.wide, P.low, 7).translate(0, P.trunk + P.low / 2 - 0.6, 0);
      const high = new THREE.ConeGeometry(P.wide * 0.7, P.high, 7).translate(0, P.trunk + P.low - 1.1 + P.high / 2, 0);
      const paint = (g: THREE.BufferGeometry, c: number) => {
        const n = g.getAttribute('position').count;
        const a = new Float32Array(n * 3);
        col.set(c);
        for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], 3 * i);
        g.setAttribute('color', new THREE.BufferAttribute(a, 3));
        return g;
      };
      const geo = mergeGeometries([paint(trunk, P.bark), paint(low, P.needles), paint(high, P.needles)]);
      const mesh = new THREE.InstancedMesh(geo, this.plantMat, trees.length);
      trees.forEach((mm, i) => {
        mesh.setMatrixAt(i, mm);
        mesh.setColorAt(i, col.setRGB(tints[i], tints[i] * (0.95 + 0.1 * ((i * 7919) % 10) / 10), tints[i]));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      this.course.add(mesh);
    }

    // Grass: tufts of thin blades, in patches and here and there.
    const tufts: THREE.Matrix4[] = [];
    const tuft = (x: number, z: number, k: number) => {
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      tufts.push(new THREE.Matrix4().compose(p.set(x, t.height(x, z) - 0.03, z), q, sc.set(k, k * (0.8 + rnd() * 0.5), k)));
    };
    const G = PLANTS;
    for (let z = 0; z < D; z += G.patchStep)
      for (let x = 0; x < W; x += G.patchStep) {
        const wx = t.x0 + x + rnd() * G.patchStep, wz = t.z0 + z + rnd() * G.patchStep;
        const past = pastAt(wx, wz);
        if (past < G.grassFrom || past > G.grassTo) continue;
        const nearTrees = (past - G.grassFrom) / (G.grassTo - G.grassFrom);
        const lush = 0.5 + 0.5 * rolling(wx, wz, G.patchSize, seed + 3);
        if (rnd() > 0.15 + 0.45 * nearTrees + 0.4 * lush) continue;
        if (t.normal(wx, wz)[1] < G.grassSteep) continue;
        const count = G.patch[0] + Math.floor(rnd() * (G.patch[1] - G.patch[0]));
        for (let c = 0; c < count; c++) {
          const r = G.patchR * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
          const tx = wx + r * Math.cos(a), tz = wz + r * Math.sin(a);
          if (pastAt(tx, tz) < G.grassFrom) continue;
          tuft(tx, tz, (0.7 + rnd() * 0.6) * (1 - (0.4 * r) / G.patchR));
        }
      }
    for (let z = 0; z < D; z += G.looseStep)
      for (let x = 0; x < W; x += G.looseStep) {
        if (rnd() > G.loose) continue;
        const wx = t.x0 + x + rnd() * G.looseStep, wz = t.z0 + z + rnd() * G.looseStep;
        const past = pastAt(wx, wz);
        if (past < G.grassFrom || past > G.looseTo) continue;
        if (t.normal(wx, wz)[1] < G.grassSteep) continue;
        tuft(wx, wz, 0.6 + rnd() * 0.6);
      }
    if (tufts.length) {
      // (a tuft: `blades` thin blades from a point, leaning out, dark at the root, yellower at the tip; lit as the ground
      // is - their normals up - not as flat cards)
      const pos: number[] = [], clr: number[] = [], nrm: number[] = [];
      const root = new THREE.Color(G.grass.root), tip = new THREE.Color(G.grass.tip);
      const brnd = seeded(7);
      for (let i = 0; i < G.blades; i++) {
        const a = (i / G.blades) * Math.PI * 2 + brnd() * 0.6;
        const h = G.grass.height[0] + brnd() * (G.grass.height[1] - G.grass.height[0]);
        const lean = 0.08 + brnd() * 0.18;
        const cx = Math.cos(a), cz = Math.sin(a);
        const w = 0.045;
        const bx = cx * 0.06, bz = cz * 0.06;
        pos.push(bx - cz * w, 0, bz + cx * w, bx + cz * w, 0, bz - cx * w, bx + cx * lean, h, bz + cz * lean);
        const tc = tip.clone().lerp(root, brnd() * 0.3);
        clr.push(root.r, root.g, root.b, root.r, root.g, root.b, tc.r, tc.g, tc.b);
        nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      // (in blocks: each its own mesh, culled by the camera, and drawn only near the player - update)
      const blocks = new Map<string, THREE.Matrix4[]>();
      const v3 = new THREE.Vector3();
      for (const mm of tufts) {
        v3.setFromMatrixPosition(mm);
        const key = `${Math.floor(v3.x / G.block)},${Math.floor(v3.z / G.block)}`;
        const list = blocks.get(key);
        if (list) list.push(mm);
        else blocks.set(key, [mm]);
      }
      for (const [key, list] of blocks) {
        const [bi, bj] = key.split(',').map(Number);
        const mesh = new THREE.InstancedMesh(geo, this.grassMat, list.length);
        list.forEach((mm, i) => {
          mesh.setMatrixAt(i, mm);
          const v = 0.8 + rnd() * 0.35;
          mesh.setColorAt(i, col.setRGB(v * (0.92 + rnd() * 0.16), v, v * 0.9));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.visible = false;
        this.course.add(mesh);
        this.grassBlocks.push({ mesh, x: (bi + 0.5) * G.block, z: (bj + 0.5) * G.block });
      }
    }
  }

  private clearCourse(): void {
    this.grassBlocks = [];
    for (const o of [...this.course.children]) {
      this.course.remove(o);
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    }
  }

  private buildFar(): void {
    const rnd = seeded(17);
    // Ridges round about, dark against the sky (beyond the fog: their own colour).
    const mats = [0x0b0f18, 0x0d121c, 0x0a0d15].map((color) => new THREE.MeshBasicMaterial({ color, fog: false }));
    for (let i = 0; i < 40; i++) {
      const az = (i / 40) * Math.PI * 2 + rnd() * 0.15;
      const r = 900 + rnd() * 700;
      const h = 150 + rnd() * 350;
      const mtn = new THREE.Mesh(new THREE.ConeGeometry(h * (1.2 + rnd()), h, 5), mats[i % 3]);
      mtn.position.set(Math.cos(az) * r, h / 2 - 160, Math.sin(az) * r);
      mtn.rotation.y = rnd() * Math.PI;
      this.far.add(mtn);
    }
    // Stars, and the moon (where its light comes from).
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const az = rnd() * Math.PI * 2;
      const el = 0.1 + Math.pow(rnd(), 0.7) * 1.4;
      const r = 1800;
      pos[i * 3] = Math.cos(az) * Math.cos(el) * r;
      pos[i * 3 + 1] = Math.sin(el) * r;
      pos[i * 3 + 2] = Math.sin(az) * Math.cos(el) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.far.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc8d2ea, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));
    const moon = new THREE.Mesh(new THREE.CircleGeometry(38, 32), new THREE.MeshBasicMaterial({ color: 0xe8ecf6, fog: false }));
    const dir = new THREE.Vector3(-300, 400, 150).normalize();
    moon.position.copy(dir.multiplyScalar(1700));
    moon.lookAt(0, 0, 0);
    this.far.add(moon);
  }
}
