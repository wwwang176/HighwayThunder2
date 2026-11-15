import * as THREE from 'three';
import { makeFlareMaterial } from '../render/lightFlares';
import { Centerline, STRAIGHT_ROAD } from '../road/centerline';
import { MOUNTAIN, roadEdges, wallShare, wallSides } from '../road/mountain';
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
 * The rock wall: how high (m, between, varying along the road), its tapering in and out where it changes sides (m),
 * and how deep it goes down below the road's edge (m: as the cliff - a mass, not a sheet).
 */
const WALL = { low: 7, high: 15, taper: 10, deep: 140, color: 0x5d564e };
/** The guardrail: its beam's bottom and top over the road, posts and reflectors (m apart). */
const RAIL = { y0: 0.5, y1: 0.82, post: 4, reflector: 8 };
/** The ground falling away below the rail: (d past the rail, y below the road) pairs. */
const CLIFF: [number, number][] = [
  [0.3, -0.25],
  [3, -3],
  [12, -18],
  [40, -55],
  [110, -140],
];
/**
 * Chevron boards outside the bends, two-faced (one for each way): `size` m high, as wide again for each chevron
 * more, `height` m up. No light of their own: they reflect what reaches them `reflect` times as strongly as paint (a
 * reflective sheeting's) - faint under the moon, bright in the low beam, glaring in the high beam (the player's real
 * lamps).
 */
const CHEVRON = { size: 0.75, height: 1.1, reflect: 3.5, roughness: 0.35, back: 0.03 };
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

/** A yellow chevron board pointing right (a left bend's: flipped). */
function chevronTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#111';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f2c200';
  g.beginPath();
  g.moveTo(30, 14);
  g.lineTo(74, 64);
  g.lineTo(30, 114);
  g.lineTo(54, 114);
  g.lineTo(98, 64);
  g.lineTo(54, 14);
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
 * (roadEdges: a shoulder's too) - the wall and the slope below the rail go on from where it ends, not tilted on out
 * with it.
 */
function edgeHeight(road: Centerline, s: number, d: number): number {
  const e = roadEdges(road);
  return road.surfaceHeight(s, Math.max(-e.at(s, -1), Math.min(e.at(s, 1), d)));
}

/** A smooth bumpy value along the road (m), between 0 and 1, for the rock's height and shape. */
function bumps(s: number, seed: number): number {
  return 0.5 + 0.25 * Math.sin(s / 23 + seed) + 0.15 * Math.sin(s / 7.3 + 2.1 * seed) + 0.1 * Math.sin(s / 3.1 + 4.7 * seed);
}

/**
 * The mountain road's scenery, the whole course laid once a race (setRoad): the asphalt with its markings, the rock
 * wall on the bends' inside (wallSides), the guardrail with its reflectors on the other side and the slope falling
 * away below it, chevron boards outside the tight bends; the night sky, the moon, far ridges.
 */
export class MountainScene implements Scenery {
  readonly lampFlareMaterial = makeFlareMaterial(2.5);
  readonly groundMaterials: THREE.MeshStandardMaterial[] = [];
  private line: Centerline = STRAIGHT_ROAD;
  private readonly course = new THREE.Group();
  private readonly far = new THREE.Group();
  private readonly roadMat: THREE.MeshStandardMaterial;
  private readonly wallMat = new THREE.MeshStandardMaterial({ color: WALL.color, roughness: 1, flatShading: true, side: THREE.DoubleSide });
  private readonly cliffMat: THREE.MeshStandardMaterial;
  private readonly railMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
  private readonly postMat = new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.4, roughness: 0.5 });
  private readonly reflectorMat = new THREE.MeshBasicMaterial({ color: 0xffa640 });
  private readonly chevronMat: THREE.MeshStandardMaterial;
  private readonly beaconMat = new THREE.MeshBasicMaterial({ color: BEACON.color.clone(), toneMapped: false, fog: false });
  /** Race time (s) the beacons blink by. */
  private time = 0;

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
    this.cliffMat = new THREE.MeshStandardMaterial({ map: dirt, color: 0x4a5040, roughness: 1, side: THREE.DoubleSide });
    this.chevronMat = new THREE.MeshStandardMaterial({
      map: chevronTexture(),
      color: new THREE.Color(1, 1, 1).multiplyScalar(CHEVRON.reflect),
      roughness: CHEVRON.roughness,
      side: THREE.DoubleSide, // (a face mirrored for a left bend: either side drawn)
    });
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
    const sides = wallSides(road, rows);
    // How much wall each side, row by row: all of it along its runs, on past them tapering (wallShare - where it changes
    // sides both stand a while: no gap).
    const share = { [1]: wallShare(rows, sides, 1, WALL.taper), [-1]: wallShare(rows, sides, -1, WALL.taper) } as Record<1 | -1, Float64Array>;

    // The road (shoulder to shoulder; roadEdges: wider in a bend, on a tight bend's outside a shoulder more): the
    // markings' columns where they are on a straight, their asphalt and shoulder stretched across the rest.
    const E0 = MOUNTAIN.edge, H0 = MOUNTAIN.halfWidth, C = 0.5; // (C: past the centre lines)
    const edges = roadEdges(road);
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

    // Both sides: the rock wall where it is (its height its share), the cliff where there is none.
    for (const side of [-1, 1] as const) {
      const at = (s: number) => edges.at(s, side); // (this side's edge: a shoulder's)
      const wallOn = share[side];
      // (a rock mass, not a sheet - the player's: from a road below, the wall of one above floated, nothing under it or
      // behind it: down from the road's edge as deep as the cliff, its back falling as deep again)
      const wall = strip(road, rows, 9, (s, i, p) => {
        const E = at(s);
        const on = wallOn[i];
        const h = (WALL.low + (WALL.high - WALL.low) * bumps(s, side * 3.1)) * on;
        const b = bumps(s, side * 1.7 + 5);
        const deep = WALL.deep * on;
        // (as narrow as it is low: none of it, a line at the edge - folded flat it lay past the rail at the road's
        // height, a ledge before the cliff fell away)
        const out = (x: number) => side * (E + on * x);
        p[0] = [out(0), -0.3 - deep];
        p[1] = [out(0), -0.3];
        p[2] = [out(0.3), 0.25 * h];
        p[3] = [out(0.8 + 0.6 * b), 0.55 * h];
        p[4] = [out(1.6 + b), 0.85 * h];
        p[5] = [out(3 + 2 * b), h];
        p[6] = [out(9 + 4 * b), h + 4 * on];
        p[7] = [out(11 + 4 * b), 0.5 * h];
        p[8] = [out(14 + 4 * b), -0.3 - deep];
      }, 8);
      const wallMesh = new THREE.Mesh(wall, this.wallMat);
      wallMesh.receiveShadow = true;
      this.course.add(wallMesh);

      // The cliff's slope where the wall isn't (folded flat under the wall where it is).
      const cliff = strip(road, rows, CLIFF.length, (s, i, p) => {
        const E = at(s);
        const on = wallOn[i] > 0 ? 0 : 1;
        CLIFF.forEach(([dd, y], j) => {
          p[j] = [side * (E + dd * (j === 0 ? 1 : on) + (1 - on) * 0.3 * j), on ? y : -0.3 - 0.01 * j];
        });
      }, 12);
      this.course.add(new THREE.Mesh(cliff, this.cliffMat));

      // The rail's beam (a ribbon), its posts and reflectors - only along the cliff.
      const runs = this.cliffRuns(rows, wallOn);
      for (const [a, b] of runs) {
        const rr = rows.filter((s) => s >= a && s <= b);
        if (rr.length < 2) continue;
        const beam = strip(road, rr, 3, (s, _i, p) => {
          const E = at(s);
          p[0] = [side * (E + 0.05), RAIL.y0];
          p[1] = [side * (E + 0.12), (RAIL.y0 + RAIL.y1) / 2];
          p[2] = [side * (E + 0.05), RAIL.y1];
        }, 4);
        this.course.add(new THREE.Mesh(beam, this.railMat));
      }
      this.addPosts(road, runs, side);
    }
    this.addChevrons(road);
  }

  update(playerS: number, play = 0): void {
    this.time += play;
    const lit = this.time % BEACON.period < BEACON.on;
    this.beaconMat.color.copy(BEACON.color).multiplyScalar(lit ? BEACON.bright : BEACON.dim);
    // (the far ridges and the sky go along with the player: as far off whichever way it turns)
    const c = this.line.center(playerS);
    this.far.position.set(c.x, this.line.height(playerS), c.z);
  }

  /** Stretches (s from, to) where a side is the cliff's: no wall on it (`wallOn`, its wallShare). */
  private cliffRuns(rows: number[], wallOn: Float64Array): [number, number][] {
    const out: [number, number][] = [];
    let from: number | null = null;
    rows.forEach((s, i) => {
      const cliff = wallOn[i] === 0;
      if (cliff && from === null) from = s;
      if (!cliff && from !== null) {
        out.push([from, rows[i - 1]]);
        from = null;
      }
    });
    if (from !== null) out.push([from, rows[rows.length - 1]]);
    return out;
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
    place(new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.09, 0.14), this.reflectorMat, Math.max(1, reflectors.length)), reflectors, 0.02, RAIL.y1 + 0.06);
  }

  /**
   * Chevron boards outside each bend (chevronSpots: closer together the sharper it is), two faces back to back on each
   * post - one toward the cars coming each way, its chevron pointing round the bend (toward its inside, the same side
   * of the road either way) - and the amber lamp on top.
   */
  private addChevrons(road: Centerline): void {
    const spots = chevronSpots(road);
    const edges = roadEdges(road);
    const poles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, CHEVRON.height, 0.06), this.postMat, Math.max(1, spots.length));
    const beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(BEACON.radius, 10, 8), this.beaconMat, Math.max(1, spots.length));
    const boards = new THREE.InstancedMesh(new THREE.PlaneGeometry(CHEVRON.size, CHEVRON.size), this.chevronMat, Math.max(1, 2 * spots.length));
    let next = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    spots.forEach(({ s, dir }, i) => {
      const d = -dir * (edges.at(s, -dir as 1 | -1) + 0.5); // (outside the bend: past its shoulder)
      const w = road.toWorld(s, d);
      const h = edgeHeight(road, s, d);
      const th = road.heading(s);
      const fx = Math.sin(th);
      const fz = -Math.cos(th);
      const y = h + CHEVRON.height + CHEVRON.size / 2;
      // Its face toward the cars coming up the road (toward -s), and back to back with it the one toward those coming
      // down it - turned round, so mirrored the other way: its chevron pointing to the same side of the road.
      for (const [way, turn, mirror] of [[-1, 0, dir], [1, Math.PI, -dir]] as const) {
        q.setFromEuler(e.set(0, -th + turn, 0));
        m.compose(p.set(w.x + (way * fx * CHEVRON.back) / 2, y, w.z + (way * fz * CHEVRON.back) / 2), q, sc.set(mirror, 1, 1));
        boards.setMatrixAt(next++, m);
      }
      q.setFromEuler(e.set(0, -th, 0));
      m.compose(p.set(w.x, h + CHEVRON.height / 2, w.z), q, sc.set(1, 1, 1));
      poles.setMatrixAt(i, m);
      m.compose(p.set(w.x, h + CHEVRON.height + CHEVRON.size + BEACON.radius + 0.03, w.z), q, sc.set(1, 1, 1));
      beacons.setMatrixAt(i, m);
    });
    for (const mesh of [boards, poles, beacons]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.course.add(mesh);
    }
  }

  private clearCourse(): void {
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
