import * as THREE from 'three';
import { LampPools, type PoolColumn } from '../render/lampPools';
import { makeFlareMaterial } from '../render/lightFlares';
import { LANE_COUNT, LANE_WIDTH, LEFT_RAIL_X, MEDIAN_FAR_X, MEDIAN_NEAR_X, ONCOMING_X, RAIL_D, ROAD_HALF_WIDTH } from '../config';
import { Centerline, STRAIGHT_ROAD } from '../road/centerline';

const STRIP_PERIOD = 100; // m; lane-dash (20), rail-post (4) and lamp (50) periods all divide it
const STRIP_BEHIND = 300;
const STRIP_AHEAD = 1300;
const STRIP_LEN = STRIP_BEHIND + STRIP_AHEAD;
const TREE_PERIOD = 400;
// Night: near-black sky, distance fading into deep blue-black.
const SKY = 0x03050b;
const FOG = 0x05070d;
// Street lights: warm white, ~3400 K (a touch cooler than the city glow ahead; at ~4700 K they looked cold beside it).
export const LAMP_COLOR = 0xffc285;
/** Night lighting levels (mutable: tuned live from the panel). */
export const NIGHT = {
  lampIntensity: 300, // candela, real street lights near the player (one per lamp pair; at 1000 the road glared)
  poolStrength: 0.15, // the lamps' pools of light on the ground (render/lampPools; as bright as the real lights make the road)
  wetness: 1, // the asphalt's wet patches (0 dry)
  rim: 0.25, // a warm light from the city glow ahead, edging the cars (cold blue, it tinted the road blue)
};
const LAMP_SPACING = 50; // every row has lamps on both sides of each carriageway, facing each other
const LAMP_HEIGHT = 9.8;
// Real (shading) lights for the lamps over our carriageway inside this window;
// everything else only its pool of light on the ground (render/lampPools).
const REAL_LIGHT_BEHIND = 40;
const REAL_LIGHT_AHEAD = 160;
const REAL_LIGHT_FADE = 25;
const REAL_LIGHTS = Math.ceil((REAL_LIGHT_BEHIND + REAL_LIGHT_AHEAD) / LAMP_SPACING) + 1;

interface LampHead {
  x: number;
  s: number; // strip-local
}

/** The two lamps facing each other across our carriageway: one real light stands in for both. */
interface LampRow {
  x: number; // midway between the heads
  s: number; // strip-local
  heads: number[]; // indices into lampHeads
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function roadTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const W = 512;
  const H = 512; // 20 m wide x 20 m long
  const pxPerM = W / (2 * RAIL_D);
  const pyPerM = H / 20;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#45474b';
  g.fillRect(0, 0, W, H);
  const xOf = (d: number) => (d + RAIL_D) * pxPerM;
  // Shoulders.
  g.fillStyle = '#55565a';
  g.fillRect(0, 0, xOf(-ROAD_HALF_WIDTH), H);
  g.fillRect(xOf(ROAD_HALF_WIDTH), 0, W - xOf(ROAD_HALF_WIDTH), H);
  // (The asphalt's grain and cracks: its picture over it all, withAsphalt.)
  // Edge lines (yellow on the inner/left edge, white on the right).
  const lw = 0.2 * pxPerM;
  g.fillStyle = '#e8c531';
  g.fillRect(xOf(-ROAD_HALF_WIDTH) - lw / 2, 0, lw, H);
  g.fillStyle = '#f2f2f2';
  g.fillRect(xOf(ROAD_HALF_WIDTH) - lw / 2, 0, lw, H);
  // Lane dashes: 6 m dash, 14 m gap.
  const dw = 0.15 * pxPerM;
  for (let i = 1; i < LANE_COUNT; i++) {
    const d = -ROAD_HALF_WIDTH + i * LANE_WIDTH;
    g.fillRect(xOf(d) - dw / 2, 0, dw, 6 * pyPerM);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1); // (the road's uv in its own units: across it 0-1, along it every 20 m)
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const TEXTURES = `${import.meta.env.BASE_URL}textures/`;
/** The asphalt's picture (cracked, worn): over the road's markings, tiled every ASPHALT.tile m along the world. */
const ASPHALT = { file: 'road-small.jpg', tile: 5, strength: 0.85, mean: 0.168 };
/**
 * The asphalt's wet patches (as the garage's lay-by): blotches some metres across (value noise by world position,
 * two sizes), darker and smooth, so the lights glint off them; the dry asphalt between stays rough.
 */
const WET = { sizes: [6.3, 2.2] as const, from: 0.55, to: 0.75, darken: 0.3, roughness: 0.3 };
const WETNESS = { value: 1 };

/** The grass's picture, tiled every GRASS.tile m (its uv in tiles; dividing the strip's period, so it doesn't jump), darkened. */
const GRASS = {
  file: 'grass-small.jpg',
  tile: 2.5,
  tint: 0x6f7f62,
  /** Its relief's steepness (normalsFrom), and the sizes (m) of its lighter and darker patches (withPatches). */
  relief: 1.2,
  patches: [17.3, 5.9] as const,
};

function grassTexture(): THREE.Texture {
  return repeating(GRASS.file);
}

/**
 * A normal map from a tiling picture's brightness (the bright blades standing out of the dark between them):
 * its slopes (Sobel, wrapping round, so it tiles too) times `strength`. Flat till the picture is in.
 */
function normalsFrom(file: string, strength: number, repeat: THREE.Vector2): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = 'rgb(128,128,255)';
  g.fillRect(0, 0, 1, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.copy(repeat);
  tex.colorSpace = THREE.NoColorSpace;
  const img = new Image();
  img.onload = () => {
    const w = (c.width = img.width);
    const h = (c.height = img.height);
    g.drawImage(img, 0, 0);
    const src = g.getImageData(0, 0, w, h).data;
    const lum = (x: number, y: number) => {
      const i = (((y + h) % h) * w + ((x + w) % w)) * 4;
      return (0.3 * src[i] + 0.59 * src[i + 1] + 0.11 * src[i + 2]) / 255;
    };
    const out = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1) - lum(x - 1, y - 1) - 2 * lum(x - 1, y) - lum(x - 1, y + 1);
        const dy = lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1) - lum(x - 1, y - 1) - 2 * lum(x, y - 1) - lum(x + 1, y - 1);
        const nx = -dx * strength;
        const ny = dy * strength; // (the picture's rows run down, the normal map's green up)
        const k = 1 / Math.hypot(nx, ny, 1);
        const i = (y * w + x) * 4;
        out.data[i] = Math.round((nx * k * 0.5 + 0.5) * 255);
        out.data[i + 1] = Math.round((ny * k * 0.5 + 0.5) * 255);
        out.data[i + 2] = Math.round((k * 0.5 + 0.5) * 255);
        out.data[i + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
    tex.dispose(); // (sent as 1 x 1 already, its storage that size: made again at the new one)
    tex.needsUpdate = true;
  };
  img.src = TEXTURES + file;
  return tex;
}

/**
 * The grass's material, its tiling broken up: patches of it lighter and yellower or darker and greener, some
 * metres across (value noise by world position, two sizes that the tile doesn't divide), so its repeat every
 * GRASS.tile m doesn't show as a grid under the lamps.
 */
function withPatches(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGrass;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGrass = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vGrass;
float grassHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float grassNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(grassHash(i), grassHash(i + vec2(1.0, 0.0)), u.x), mix(grassHash(i + vec2(0.0, 1.0)), grassHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float patchy = 0.6 * grassNoise(vGrass / ${GRASS.patches[0].toFixed(1)}) + 0.4 * grassNoise(vGrass / ${GRASS.patches[1].toFixed(1)} + 17.3);
diffuseColor.rgb *= mix(vec3(0.62, 0.72, 0.62), vec3(1.2, 1.15, 0.9), patchy);`,
      );
  };
  mat.customProgramCacheKey = () => 'grass-patches';
  return mat;
}

function repeating(file: string): THREE.Texture {
  const t = new THREE.TextureLoader().load(TEXTURES + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The road's material with the asphalt's picture laid over its markings (the paint worn and cracked with it),
 * tiled by world position: the markings' texture stays small, the asphalt sharp. Its average brightness 1
 * (ASPHALT.strength of its contrast), so the markings' colours keep their brightness.
 */
function withAsphalt(mat: THREE.MeshStandardMaterial, renderer: THREE.WebGLRenderer): THREE.MeshStandardMaterial {
  const detail = repeating(ASPHALT.file);
  detail.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mean = ASPHALT.mean; // the picture's mean, linear (for the brightness 1)
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.asphalt = { value: detail };
    shader.uniforms.wetness = WETNESS;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vAsphalt;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>\nvAsphalt = (modelMatrix * vec4(transformed, 1.0)).xz / ${ASPHALT.tile.toFixed(1)};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vAsphalt;
uniform sampler2D asphalt;
uniform float wetness;
float wetHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wetNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wetHash(i), wetHash(i + vec2(1.0, 0.0)), u.x), mix(wetHash(i + vec2(0.0, 1.0)), wetHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
diffuseColor.rgb *= mix(vec3(1.0), texture2D(asphalt, vAsphalt).rgb / ${mean.toFixed(4)}, ${ASPHALT.strength.toFixed(2)});
vec2 wetAt = vAsphalt * ${ASPHALT.tile.toFixed(1)};
float wet = wetness * smoothstep(${WET.from.toFixed(2)}, ${WET.to.toFixed(2)},
  0.65 * wetNoise(wetAt / ${WET.sizes[0].toFixed(1)}) + 0.35 * wetNoise(wetAt / ${WET.sizes[1].toFixed(1)} + 31.7));
diffuseColor.rgb *= 1.0 - ${WET.darken.toFixed(2)} * wet;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, ${WET.roughness.toFixed(2)}, wet);`,
      );
  };
  mat.customProgramCacheKey = () => 'road-asphalt';
  return mat;
}

/** The ribbons' rows along the road (m apart): a bend of R 2000 strays from a 5 m chord by a millimetre or two. */
const SEG = 5;
const ROWS = STRIP_LEN / SEG + 1;
/** The grass's columns across the road (d, m): close together near the road (where the lamps' pools fall). */
const GRASS_D = [-900, -300, -150, -90, -60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 60, 90, 150, 300, 900];

/** One face of a sweep: its edge across the road, (d, y) to (d, y) - its face to the left of that way (clockwise round a solid). */
type Edge = [number, number, number, number];

/**
 * Faces swept along the road: each an edge across it (d, y) carried along s, its rows SEG m apart over the strip
 * (placed by layout, on the road's line). Each vertex also has its road position (`roadPos`: d, -s; the lamps'
 * pools are worked out on it) and a uv from `uvOf` (d, s from the strip's start).
 */
class Sweep {
  readonly geometry = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;
  private readonly uv: Float32Array;
  private readonly road: Float32Array;

  constructor(
    private readonly edges: Edge[],
    private readonly uvOf: (d: number, s: number) => [number, number] = () => [0, 0],
  ) {
    const n = ROWS * edges.length * 2;
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.uv = new Float32Array(n * 2);
    this.road = new Float32Array(n * 2);
    const index: number[] = [];
    const v = (e: number, r: number, k: number) => (e * ROWS + r) * 2 + k;
    for (let e = 0; e < edges.length; e++)
      for (let r = 0; r + 1 < ROWS; r++) {
        const a = v(e, r, 0);
        const b = v(e, r, 1);
        const c = v(e, r + 1, 0);
        const d = v(e, r + 1, 1);
        index.push(a, d, c, a, b, d);
      }
    this.geometry.setIndex(index);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    this.geometry.setAttribute('roadPos', new THREE.BufferAttribute(this.road, 2));
  }

  /** Along `line` from s = `from` (the strip's start). */
  layout(line: Centerline, from: number): void {
    const { edges } = this;
    for (let r = 0; r < ROWS; r++) {
      const s = from + r * SEG;
      const c = line.center(s);
      const th = line.heading(s);
      const nx = Math.cos(th);
      const nz = Math.sin(th);
      for (let e = 0; e < edges.length; e++) {
        const [d0, y0, d1, y1] = edges[e];
        // (its face to the left of the edge's way: (-dy, dd) across and up)
        const len = Math.hypot(d1 - d0, y1 - y0);
        const nd = -(y1 - y0) / len;
        const ny = (d1 - d0) / len;
        for (let k = 0; k < 2; k++) {
          const d = k ? d1 : d0;
          const i = (e * ROWS + r) * 2 + k;
          this.pos[i * 3] = c.x + d * nx;
          this.pos[i * 3 + 1] = k ? y1 : y0;
          this.pos[i * 3 + 2] = c.z + d * nz;
          this.nrm[i * 3] = nd * nx;
          this.nrm[i * 3 + 1] = ny;
          this.nrm[i * 3 + 2] = nd * nz;
          const [u, w] = this.uvOf(d, s - from);
          this.uv[i * 2] = u;
          this.uv[i * 2 + 1] = w;
          this.road[i * 2] = d;
          this.road[i * 2 + 1] = -s;
        }
      }
    }
    for (const name of ['position', 'normal', 'uv', 'roadPos']) this.geometry.getAttribute(name).needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}

/** A box's faces (clockwise round it, seen along the road) from d0 to d1 across, y0 to y1 up. */
function boxEdges(d0: number, d1: number, y0: number, y1: number): Edge[] {
  return [
    [d0, y1, d1, y1],
    [d1, y1, d1, y0],
    [d1, y0, d0, y0],
    [d0, y0, d0, y1],
  ];
}

/** A pole on the road's side and its arms: where (d), and each arm's way across (+-1) and reach to its lamp head. */
interface PoleSpec {
  d: number;
  arms: [number, number][];
}

const M4 = new THREE.Matrix4();
const QY = new THREE.Quaternion();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const P3 = new THREE.Vector3();
const S3 = new THREE.Vector3();

export class RoadScene {
  private strip = new THREE.Group();
  private trees = new THREE.Group();
  private far = new THREE.Group();
  private lampHeads: LampHead[] = [];
  private lampRows: LampRow[] = [];
  readonly lampFlareMaterial = makeFlareMaterial(2.5);
  /** Road and grass surfaces (receive NPC headlight beams, see render/npcBeams). */
  readonly groundMaterials: THREE.MeshStandardMaterial[] = [];
  /** The street lights' pools of light on the ground (in the ground's shaders). */
  private lampPools!: LampPools;
  private realLights: THREE.SpotLight[] = [];
  private readonly rim = new THREE.DirectionalLight(0xffb35c, NIGHT.rim);
  /** The road's line, and the strip's start (s) and the trees' as last laid along it (NaN: to be). */
  private line: Centerline = STRAIGHT_ROAD;
  private laidS = NaN;
  private treesS = NaN;
  private readonly sweeps: Sweep[] = [];
  private posts!: THREE.InstancedMesh;
  private poles!: THREE.InstancedMesh;
  private arms!: THREE.InstancedMesh;
  private heads!: THREE.InstancedMesh;
  private lampFlares!: THREE.Points;
  private poleSpecs: PoleSpec[] = [];
  private trunks!: THREE.InstancedMesh;
  private crowns!: THREE.InstancedMesh;
  private treeBase: { d: number; s: number; k: number }[] = [];

  /** The street lights currently shining (for things lit by hand, like tyre smoke). */
  activeLights(): THREE.SpotLight[] {
    return this.realLights.filter((l) => l.visible && l.intensity > 0);
  }

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(FOG, 60, 650);

    // Faint sky glow and a weak bluish moonlight keep silhouettes readable.
    scene.add(new THREE.HemisphereLight(0x1c2740, 0x07080a, 0.35));
    const moon = new THREE.DirectionalLight(0x8fa4d8, 0.12);
    moon.position.set(-200, 300, 100);
    scene.add(moon);
    // The city's warm glow ahead, low: the cars' edges and tops catch it (and the road, a little).
    this.rim.position.set(-30, 35, -100);
    scene.add(this.rim);

    for (let i = 0; i < REAL_LIGHTS; i++) {
      // Straight down from between a lamp pair, wide enough to cover both pools.
      const l = new THREE.SpotLight(LAMP_COLOR, 0, 45, 1.0, 0.6, 1.6);
      l.visible = false;
      scene.add(l, l.target);
      this.realLights.push(l);
    }

    this.buildStrip(renderer);
    this.buildTrees();
    this.buildFar();
    scene.add(this.strip, this.trees, this.far);
    this.layout(0);
  }

  /** The road to lay the scenery along (a new race's). */
  setRoad(line: Centerline): void {
    this.line = line;
    this.laidS = NaN;
    this.treesS = NaN;
  }

  private buildStrip(renderer: THREE.WebGLRenderer): void {
    // Our carriageway, its texture across it (rail to rail) and every 20 m along.
    const roadSweep = new Sweep([[-RAIL_D, 0.01, RAIL_D, 0.01]], (d, s) => [(d + RAIL_D) / (2 * RAIL_D), s / 20]);
    const road = new THREE.Mesh(
      roadSweep.geometry,
      withAsphalt(
        new THREE.MeshStandardMaterial({ map: roadTexture(renderer), roughness: 0.92 }),
        renderer,
      ),
    );
    road.receiveShadow = true;
    this.strip.add(road);

    // Oncoming carriageway: same surface mirrored, so its yellow edge line sits
    // next to the median like ours.
    const roadMat2 = withAsphalt((road.material as THREE.MeshStandardMaterial).clone(), renderer); // (a clone leaves its shader changes behind)
    roadMat2.side = THREE.DoubleSide;
    const road2Sweep = new Sweep([[ONCOMING_X - RAIL_D, 0.01, ONCOMING_X + RAIL_D, 0.01]], (d, s) => [(ONCOMING_X - d + RAIL_D) / (2 * RAIL_D), s / 20]);
    const road2 = new THREE.Mesh(road2Sweep.geometry, roadMat2);
    road2.receiveShadow = true;
    this.strip.add(road2);
    this.groundMaterials.push(road.material as THREE.MeshStandardMaterial, roadMat2);

    const grassEdges: Edge[] = [];
    for (let i = 0; i + 1 < GRASS_D.length; i++) grassEdges.push([GRASS_D[i], -0.02, GRASS_D[i + 1], -0.02]);
    const grassSweep = new Sweep(grassEdges, (d, s) => [d / GRASS.tile, s / GRASS.tile]);
    const grass = new THREE.Mesh(
      grassSweep.geometry,
      withPatches(
        new THREE.MeshStandardMaterial({
          map: grassTexture(),
          normalMap: normalsFrom(GRASS.file, GRASS.relief, new THREE.Vector2(1, 1)),
          color: GRASS.tint,
          roughness: 1,
        }),
      ),
    );
    grass.receiveShadow = true;
    this.strip.add(grass);
    this.groundMaterials.push(grass.material);

    // Guardrails: beam + posts every 4 m.
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.4, metalness: 0.7 });
    const railX = [RAIL_D, LEFT_RAIL_X];
    const beamEdges: Edge[] = [];
    for (const x of railX) {
      const c = x + Math.sign(x) * 0.06;
      beamEdges.push(...boxEdges(c - 0.06, c + 0.06, 0.62 - 0.17, 0.62 + 0.17));
    }
    const beamSweep = new Sweep(beamEdges);
    const beams = new THREE.Mesh(beamSweep.geometry, metal);
    beams.castShadow = true;
    this.strip.add(beams);
    this.sweeps.push(roadSweep, road2Sweep, grassSweep, beamSweep);
    const postCount = (STRIP_LEN / 4) * 2;
    this.posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.8, 0.14), metal, postCount);
    this.strip.add(this.posts);

    // Street lights, opposite arrangement: each row has a lamp on the right shoulder
    // and one on the median facing it, so their pools meet across our carriageway
    // and a single real light can stand in for the pair. The median lamps have a
    // second arm over the oncoming carriageway, which also has lamps on its outer edge.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.6, metalness: 0.5 });
    const headMat = new THREE.MeshBasicMaterial({ color: LAMP_COLOR });
    const medianX = (MEDIAN_NEAR_X + MEDIAN_FAR_X) / 2;
    this.poleSpecs = [
      { d: RAIL_D + 1.6, arms: [[-1, 2.3]] },
      { d: medianX, arms: [[-1, 4.5], [1, 4.5]] },
      { d: LEFT_RAIL_X - 1.6, arms: [[1, 2.3]] },
    ];
    const rows = STRIP_LEN / LAMP_SPACING;
    const poleCount = rows * this.poleSpecs.length;
    const armCount = rows * this.poleSpecs.reduce((n, p) => n + p.arms.length, 0);
    this.poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 10, 8), poleMat, poleCount);
    this.arms = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.12, 0.12), poleMat, armCount);
    this.heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.16, 0.4), headMat, armCount);
    const columns: PoolColumn[] = [];
    for (let r = 0; r < rows; r++) {
      const sPos = -STRIP_BEHIND + r * LAMP_SPACING;
      for (const spec of this.poleSpecs) {
        for (const [dir, reach] of spec.arms) {
          const hd = spec.d + dir * reach;
          // Its pool of light centred a little toward the road from the head (the same in every row).
          if (r === 0) columns.push({ x: hd + dir * 1.0, ours: hd > MEDIAN_NEAR_X - 4 });
          if (hd > MEDIAN_NEAR_X - 4) {
            // Over our carriageway: pair it with the row's other lamp.
            const row = this.lampRows.find((w) => w.s === sPos);
            if (row) {
              row.heads.push(this.lampHeads.length);
              row.x = (row.x + hd) / 2;
            } else this.lampRows.push({ x: hd, s: sPos, heads: [this.lampHeads.length] });
          }
          this.lampHeads.push({ x: hd, s: sPos });
        }
      }
    }
    this.strip.add(this.poles, this.arms, this.heads);
    // Their pools of light: light in the ground's shaders, by road position (rows every LAMP_SPACING m of s from
    // 0: the strip starts on a whole STRIP_PERIOD, which LAMP_SPACING divides).
    this.lampPools = new LampPools(columns, LAMP_SPACING, ((STRIP_BEHIND % LAMP_SPACING) + LAMP_SPACING) % LAMP_SPACING, {
      behind: REAL_LIGHT_BEHIND,
      ahead: REAL_LIGHT_AHEAD,
      fade: REAL_LIGHT_FADE,
    });
    for (const mat of this.groundMaterials) this.lampPools.patch(mat);

    // Lamp-head glows: soft sprites that stay a few pixels wide in the distance.
    const fpos = new Float32Array(this.lampHeads.length * 3);
    const fcol = new Float32Array(this.lampHeads.length * 3);
    const fsize = new Float32Array(this.lampHeads.length);
    const c = new THREE.Color(LAMP_COLOR);
    this.lampHeads.forEach((_, k) => {
      fcol.set([c.r, c.g, c.b], k * 3);
      fsize[k] = 1.6;
    });
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    fgeo.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
    fgeo.setAttribute('size', new THREE.BufferAttribute(fsize, 1));
    this.lampFlares = new THREE.Points(fgeo, this.lampFlareMaterial);
    this.lampFlares.frustumCulled = false;
    this.lampFlares.renderOrder = 3;
    this.strip.add(this.lampFlares);
  }

  /** An instance at road position (s, d), `y` up, turned with the road (its x across it), stretched `sx` across. */
  private place(mesh: THREE.InstancedMesh, i: number, s: number, d: number, y: number, sx = 1, scale = 1): void {
    const w = this.line.toWorld(s, d);
    QY.setFromAxisAngle(AXIS_Y, -this.line.heading(s));
    mesh.setMatrixAt(i, M4.compose(P3.set(w.x, y, w.z), QY, S3.set(sx * scale, scale, scale)));
  }

  /** The strip's scenery laid along the road from s = `stripS` - STRIP_BEHIND. */
  private layout(stripS: number): void {
    this.laidS = stripS;
    const from = stripS - STRIP_BEHIND;
    for (const sw of this.sweeps) sw.layout(this.line, from);
    let i = 0;
    for (let s = -STRIP_BEHIND; s < STRIP_AHEAD; s += 4)
      for (const x of [RAIL_D, LEFT_RAIL_X]) this.place(this.posts, i++, stripS + s, x + Math.sign(x) * 0.2, 0.4);
    let pi = 0;
    let ai = 0;
    const rows = STRIP_LEN / LAMP_SPACING;
    for (let r = 0; r < rows; r++) {
      const s = stripS - STRIP_BEHIND + r * LAMP_SPACING;
      for (const spec of this.poleSpecs) {
        this.place(this.poles, pi++, s, spec.d, 5);
        for (const [dir, reach] of spec.arms) {
          this.place(this.arms, ai, s, spec.d + (dir * (reach + 0.2)) / 2, 9.9, reach + 0.2);
          this.place(this.heads, ai, s, spec.d + dir * reach, LAMP_HEIGHT);
          ai++;
        }
      }
    }
    const fpos = this.lampFlares.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.lampHeads.forEach((h, k) => {
      const w = this.line.toWorld(stripS + h.s, h.x);
      fpos.setXYZ(k, w.x, LAMP_HEIGHT - 0.15, w.z);
    });
    fpos.needsUpdate = true;
    for (const m of [this.posts, this.poles, this.arms, this.heads]) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }

  private buildTrees(): void {
    const rnd = seeded(42);
    const per = 70;
    const reps = Math.ceil(STRIP_LEN / TREE_PERIOD) + 1;
    const count = per * reps;
    this.trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.25, 0.35, 2, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a2a20 }),
      count,
    );
    this.crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.2, 6, 7),
      new THREE.MeshStandardMaterial({ color: 0x1f3d1c, flatShading: true }),
      count,
    );
    for (let j = 0; j < per; j++) {
      const right = rnd() < 0.5;
      const off = 6 + rnd() * rnd() * 90;
      this.treeBase.push({ d: right ? RAIL_D + off : LEFT_RAIL_X - off, s: rnd() * TREE_PERIOD, k: 0.7 + rnd() * 0.8 });
    }
    this.crowns.castShadow = true;
    this.trees.add(this.trunks, this.crowns);
  }

  /** The trees (their pattern repeating every TREE_PERIOD m) along the road from s = `treeS` - STRIP_BEHIND. */
  private layoutTrees(treeS: number): void {
    this.treesS = treeS;
    const reps = Math.ceil(STRIP_LEN / TREE_PERIOD) + 1;
    let i = 0;
    for (let r = 0; r < reps; r++)
      for (const t of this.treeBase) {
        const s = treeS - STRIP_BEHIND + r * TREE_PERIOD + t.s;
        this.place(this.trunks, i, s, t.d, 1 * t.k, 1, t.k);
        this.place(this.crowns, i, s, t.d, 4.5 * t.k, 1, t.k);
        i++;
      }
    for (const m of [this.trunks, this.crowns]) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }

  private buildFar(): void {
    const rnd = seeded(9);
    // Mountains: barely-there silhouettes against the night sky.
    const mat = new THREE.MeshBasicMaterial({ color: 0x0a0e17, fog: false });
    const mat2 = new THREE.MeshBasicMaterial({ color: 0x0c111a, fog: false });
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      const h = 60 + rnd() * 160;
      const mtn = new THREE.Mesh(new THREE.ConeGeometry(h * 1.6, h, 6), rnd() < 0.5 ? mat : mat2);
      mtn.position.set(side * (700 + rnd() * 500), h / 2 - 5, -(rnd() * 3000 - 600));
      this.far.add(mtn);
    }
    // Faint stars (no moon in the sky, so the street and car lights stand out).
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const az = rnd() * Math.PI * 2;
      const el = 0.08 + Math.pow(rnd(), 0.7) * 1.4;
      const r = 1800;
      pos[i * 3] = Math.cos(az) * Math.cos(el) * r;
      pos[i * 3 + 1] = Math.sin(el) * r;
      pos[i * 3 + 2] = Math.sin(az) * Math.cos(el) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xbfcbe6, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 }),
    );
    this.far.add(stars);
  }

  /**
   * Keep the scenery laid along the road around the player (`playerS` along it), and hand the real street lights
   * to the lamp pairs over our carriageway nearest ahead (one light per pair). Their pools of light fade out as
   * the real light fades in, so nothing pops.
   */
  update(playerS: number): void {
    const stripS = Math.floor(playerS / STRIP_PERIOD) * STRIP_PERIOD;
    if (stripS !== this.laidS) this.layout(stripS);
    const treeS = Math.floor(playerS / TREE_PERIOD) * TREE_PERIOD;
    if (treeS !== this.treesS) this.layoutTrees(treeS);
    // (the far scenery and the sky go along with the player, its line's point: as far off whichever way it turns)
    const c = this.line.center(playerS);
    this.far.position.set(c.x, 0, c.z);

    this.lampPools.update(playerS, LAMP_COLOR, NIGHT.poolStrength);
    WETNESS.value = NIGHT.wetness;
    this.rim.intensity = NIGHT.rim;
    let li = 0;
    for (const row of this.lampRows) {
      const ds = stripS + row.s - playerS;
      if (ds <= -REAL_LIGHT_BEHIND || ds >= REAL_LIGHT_AHEAD || li >= this.realLights.length) continue;
      const real = Math.min(1, (ds + REAL_LIGHT_BEHIND) / REAL_LIGHT_FADE, (REAL_LIGHT_AHEAD - ds) / REAL_LIGHT_FADE);
      const l = this.realLights[li++];
      const w = this.line.toWorld(stripS + row.s, row.x);
      l.visible = true;
      l.intensity = NIGHT.lampIntensity * real;
      l.position.set(w.x, LAMP_HEIGHT - 0.2, w.z);
      l.target.position.set(w.x, 0, w.z);
      l.target.updateMatrixWorld();
      // (Its pools fade out as it comes on: LampPools, the same fade.)
    }
    for (; li < this.realLights.length; li++) this.realLights[li].visible = false;
  }
}
