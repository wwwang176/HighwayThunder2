import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LampPools, type PoolColumn } from '../render/lampPools';
import { FLARE_AIM, makeFlareMaterial } from '../render/lightFlares';
import { LANE_COUNT, LANE_WIDTH, LEFT_RAIL_X, MEDIAN_FAR_X, MEDIAN_NEAR_X, ONCOMING_X, RAIL_D, ROAD_HALF_WIDTH } from '../config';
import { Centerline, STRAIGHT_ROAD } from '../road/centerline';
import { CORNER_LAMP, planCity, type PlanCrossing, type PlanLamp, type PlanRoad } from './cityPlan';

const STRIP_PERIOD = 100; // m; lane-dash (20), rail-post (4) and lamp (50) periods all divide it
const STRIP_BEHIND = 300;
const STRIP_AHEAD = 1300;
const STRIP_LEN = STRIP_BEHIND + STRIP_AHEAD;
/**
 * The deck (the highway up on it, some five floors over the city): concrete parapets on its outer edges (their road
 * faces the rails' planes), its edges reaching DECK_DEPTH m down under the road; on piers (PIER).
 */
const PARAPET = { width: 0.45, height: 1.05 };
const DECK_DEPTH = 1.8;
/** The city's ground: some five floors under the road. */
const GROUND_Y = -15;
/**
 * The deck's piers, every `spacing` m: a cap beam across under it (`cap` m deep, `capLong` along), on two square
 * columns (`columns`: across the road, `side` m) down to the ground - none where a street passes under.
 */
const PIER = {
  spacing: 50,
  offset: 25, // (between the lamp rows)
  cap: 1.5,
  capLong: 2.2,
  columns: [LEFT_RAIL_X + 3, RAIL_D - 3],
  side: 2,
};
/**
 * The city's streets (cityPlan): 1+1 between a block's buildings, 2+2 round its blocks - asphalt, pavements either
 * side, lamps on them (each side every `lampEvery` m, the sides staggered); their light on the street worked out in
 * its shader (each lamp's pool `pool` m across, blurred to the pixel far off: no shimmer). Their poles laid within
 * `poles` m of the player (further, only their glow).
 */
const STREETS = {
  minor: { asphalt: 7, walk: 2, lampEvery: 40 },
  major: { asphalt: 14, walk: 3, lampEvery: 36 },
  pool: 5,
  pole: { height: 8, reach: 1.8 },
  poles: 350,
  /** A street never narrower on the screen than this (px): its light spread over it. */
  minPx: 2.5,
  /** A crossing's zebra stripes (m wide, as far apart), reaching this far past the pavement it crosses. */
  zebra: { stripe: 0.5, past: 2 },
  ground: 0x0a0b0d,
  walk: 0x55565a,
};
/** The median's guardrails: at each side of its strip, the way its carriageway is (+1 toward +d). */
const MEDIAN_RAILS: [number, number][] = [[MEDIAN_NEAR_X, 1], [MEDIAN_FAR_X, -1]];
/** The strip's low shrubs (as real ones, planted against the oncoming headlights' glare): m apart along it, how tall, how wide. */
const SHRUB = { spacing: 1.25, height: [0.85, 1.35] as const, width: [1.1, 1.7] as const, color: 0x1a2e17 };
/**
 * The city round the deck (cityPlan), its pattern repeating every `period` m: either side rows (`bands`) of
 * districts one after another along the road (now and then a dark gap), each its own grid of streets turned its own
 * way (up to `yaw` either way) - the near row's streets across the deck passing under it; blocks (2+2 roads round
 * them) of city blocks (1+1 streets between them) of `lots` x `lots` lots (`lot` m, back to back, an `alley`
 * between), buildings `size` m on them, some lots empty; each city block's height (`top`: the tallest over the road)
 * its own - low ones and towers. No building nearer the deck than `clear` m (nobody builds right up against
 * an elevated road), no street along it under it. All standing on the ground (`base`).
 */
const CITY = {
  period: 800,
  bands: [
    { near: [-25, 30] as const, far: 320 },
    { near: [330, 360] as const, far: 620 },
  ],
  gap: { odds: 0.25, size: [30, 120] as const },
  yaw: THREE.MathUtils.degToRad(30),
  lots: [2, 3] as const,
  cityBlocks: [1, 3] as const,
  blocksAcross: [1, 3] as const,
  blocksAlong: [1, 2] as const,
  lot: 24,
  alley: 4,
  size: [17, 24] as const,
  empty: 0.12,
  apart: 6,
  maxAlong: 190,
  top: [6, 130] as const,
  clear: 40,
  alongClear: 22,
  led: 0.35,
  base: GROUND_Y,
  color: 0x16181d,
  /**
   * Its own fog, not the scene's (60-650 m): the walls into the night by distance (1 - e^(-d/scale): two thirds of
   * the way at `scale` m, wholly by `gone`), the lit windows much further (m: from - gone: a city's lights seen from
   * kilometres off), brighter far off (by up to `farBoost`: points of light against the dark, as the eye sees them).
   */
  fog: { walls: { scale: 300, gone: 1500 }, windows: [300, 2000], farBoost: 0.8 } as const,
};
/**
 * The city's traffic on its streets: in each lane (1+1: one each way; 2+2: two each way, `lane` m apart from the
 * middle) cars about `every` m apart, all at the lane's speed (m/s: none catches up another), round and round its
 * street (faded in and out at its ends). Where each is worked out on the GPU from the race time: a box for its body
 * (near: within `bodies` m - further, thinner than a pixel, it flickered), a white light ahead and a red one behind
 * (only seen from the way each shines). Now and then (`big`) a bus or a lorry.
 */
const TRAFFIC = {
  minor: { every: 220, speed: [4.8, 7.2] as const },
  major: { every: 90, speed: [7.2, 10.2] as const },
  lane: 3.5,
  bodies: 400,
  big: 0.1,
  car: [1.8, 1.45, 4.4] as const,
  lorry: [2.5, 3.0, 10] as const,
};
const TRAFFIC_TIME = { value: 0 };

/**
 * The city on past the built one: a ring of its silhouette `radius` m round the player (past where the built
 * one's windows are gone), `height` m tall from the ground, its picture (skylineTexture) `repeat` times round;
 * its windows `windows` as bright as the built city's (far off, dim).
 */
const SKYLINE = {
  radius: 2400,
  height: 240,
  repeat: 3,
  windows: 0.6,
  /** Its picture: px, metres a pixel across (height: SKYLINE.height over its rows). */
  width: 4096,
  rows: 512,
  /** Its buildings' widths and heights (m), the tallest districts' (a slow wave along it) and the low ones'. */
  wide: [18, 90] as const,
  tall: [15, 220] as const,
  /** Floors (m) and windows' spacing across (m) - a lit one a few pixels: one alone, far off, averaged away; the share lit. */
  floor: 3.5,
  across: 3,
  lit: 0.04,
};
/** The city's periods laid at once: from STRIP_BEHIND behind the player to its windows' fog's end ahead, wherever in a period it is. */
const CITY_REPS = Math.ceil((STRIP_BEHIND + CITY.period + CITY.fog.windows[1]) / CITY.period);
// Night: near-black sky, distance fading into deep blue-black.
const SKY = 0x03050b;
const FOG = 0x05070d;
// The city's light in its sky (light pollution: its street lights' glow scattered back), a dull warm haze along the
// horizon: the buildings dark against it.
const SKY_GLOW = 0x3b2a2c;
// Street lights: warm white, ~3400 K (a touch cooler than the city glow ahead; at ~4700 K they looked cold beside it).
export const LAMP_COLOR = 0xffc285;
/** Night lighting levels (mutable: tuned live from the panel). */
export const NIGHT = {
  lampIntensity: 300, // candela, real street lights near the player (one per lamp pair; at 1000 the road glared)
  poolStrength: 0.15, // the lamps' pools of light on the ground (render/lampPools; as bright as the real lights make the road)
  wetness: 1, // the asphalt's wet patches (0 dry)
  rim: 0.25, // a warm light from the city glow ahead, edging the cars (cold blue, it tinted the road blue)
  windows: 0.35, // the buildings' lit windows' brightness (at 0.7 the near ones glared like the lamps)
  windowsLit: 0.11, // the share of their windows lit (each building its own: some all but dark, some lit up)
  skyGlow: 1.5, // the city's glow along the horizon
  streetLights: 1, // the streets' lamps on the ground
  wallGlow: 0.9, // the streets' light on the buildings' lower floors
};
const WINDOWS = { strength: { value: NIGHT.windows }, lit: { value: NIGHT.windowsLit } };
const SKY_GLOW_STRENGTH = { value: NIGHT.skyGlow };
const STREET_STRENGTH = { value: NIGHT.streetLights };
const WALL_GLOW = { value: NIGHT.wallGlow };
/** Street lights' colours: sodium orange, LED white. */
const SODIUM = 'vec3(1.0, 0.52, 0.2)';
const LED = 'vec3(0.9, 0.92, 1.0)';
/** The city's fog (CITY.fog), in its shaders: walls (and the ground) into the night, the lights fading much further. */
const CITY_FOG_GLSL = /* glsl */ `
float cityWallFog(float d) { return max(1.0 - exp(-d / ${CITY.fog.walls.scale.toFixed(1)}), smoothstep(${(CITY.fog.walls.gone * 0.8).toFixed(1)}, ${CITY.fog.walls.gone.toFixed(1)}, d)); }
float cityLightFade(float d) { return 1.0 - smoothstep(${CITY.fog.windows[0].toFixed(1)}, ${CITY.fog.windows[1].toFixed(1)}, d); }`;
/**
 * A street's lamps' pools of light on it at (x across it, y along it: m), as cityPlan stands them: either side
 * `off` m out (the pool a metre in from its pole), every `every` m, the sides staggered (a quarter and three
 * quarters of the way); `fp` the pixel's footprint (m) the pools blurred to (no shimmer: as bright on the whole).
 * And a painted line `hw` m either side of d, blurred the same; dashes `on` m in each `period`.
 */
const STREETS_GLSL = /* glsl */ `
float streetPools(float x, float y, float off, float every, float fp) {
  float p2 = ${(STREETS.pool * STREETS.pool).toFixed(3)};
  float ps = p2 + fp * fp;
  float light = 0.0;
  for (int i = 0; i < 2; i++) {
    float side = i == 0 ? 1.0 : -1.0;
    float a = y / every - (i == 0 ? 0.25 : 0.75);
    vec2 d = vec2(x - side * (off - 1.0), (a - floor(a + 0.5)) * every);
    light += p2 / ps * exp(-dot(d, d) / ps);
  }
  return light;
}
float paintLine(float d, float hw, float fw) {
  float w = max(hw, fw);
  return clamp((w - abs(d)) / max(fw, 1e-4) + 0.5, 0.0, 1.0) * hw / w;
}
float dashSum(float y, float on, float period) { return floor(y / period) * on + min(fract(y / period) * period, on); }
float dashes(float y, float on, float period, float fw) {
  float h = max(fw, 1e-3) * 0.5;
  return (dashSum(y + h, on, period) - dashSum(y - h, on, period)) / (2.0 * h);
}`;
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

/**
 * The buildings' material, its faces' windows worked out in its shader: each building (by its place) homes or
 * offices - the taller, the likelier offices. Homes: floors 3.0-3.3 m, windows some 1.3 m square with wall between,
 * lit a home at a time (2-3 windows of a floor), mostly warm. Offices: floors 3.8-4.2 m, a band of glass round each
 * (thin mullions every 1.5 m, a spandrel under it), lit a stretch of a floor at a time, mostly cool white. Each lit
 * group its own brightness and colour (warm ~2700-3500 K, cool ~4000-5500 K), a home's windows each their own too
 * (a room dark, a curtain drawn); the rest dark glass. Far off, where a window is under a pixel or so, their average
 * instead (no shimmer).
 */
function withWindows(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.windowStrength = WINDOWS.strength;
    shader.uniforms.windowLit = WINDOWS.lit;
    shader.uniforms.wallGlow = WALL_GLOW;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWall;\nvarying vec3 vWallN;\nvarying float vWallSeed;\nvarying float vWallTop;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec3 wallSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vWall = vec3(position.x * wallSize.x, (instanceMatrix * vec4(position, 1.0)).y, position.z * wallSize.z);
vWallN = normal;
vWallTop = floor(wallSize.y + ${CITY.base.toFixed(1)} + 0.5); // (its top over the road, whole metres)
vWallSeed = floor(fract(sin(dot(instanceMatrix[3].xz * 0.0137, vec2(12.9898, 78.233))) * 43758.5453) * 1000.0) / 1000.0; // (by its place: the same building wherever its instance)`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWall;
varying vec3 vWallN;
varying float vWallSeed;
varying float vWallTop;
uniform float windowStrength;
uniform float windowLit;
uniform float wallGlow;
${CITY_FOG_GLSL}
float wallHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Warm: ~2700 K (bulbs) to ~3500 K; cool: ~4000 K to ~5500 K (LED, fluorescent) - not blue-white.
const vec3 WARM_LO = vec3(1.0, 0.58, 0.28), WARM_HI = vec3(1.0, 0.8, 0.56);
const vec3 COOL_LO = vec3(1.0, 0.9, 0.76), COOL_HI = vec3(0.86, 0.92, 1.0);
// A lit window's own brightness (a home's: some rooms dark, some curtains drawn; an office's: even, dimmer, its
// stretch all alike); 'mean' its average.
float paneLight(float r, bool office) {
  return office ? 0.7 + 0.2 * r : r < 0.12 ? 0.0 : r < 0.4 ? 0.35 : 0.8 + 0.4 * (r - 0.4) / 0.6;
}
const float HOME_MEAN = 0.28 * 0.35 + 0.6 * 1.0, OFFICE_MEAN = 0.8;
// The lit windows' light at merge m (1: each window; 2, 4, 8: m x m of them as one), and whether it is a pane (pane).
vec3 windowsAt(vec2 cell, float m, vec2 face, float seed, vec4 box, float unit, float share, float coolOdds, bool office, out float pane) {
  vec2 c = cell / m;
  vec2 id = floor(c) + face;
  vec2 f = fract(c);
  pane = step(box.x, f.x) * step(f.x, box.y) * step(box.z, f.y) * step(f.y, box.w);
  vec2 group = m < 1.5 ? vec2(floor(id.x / unit), id.y) : id + m * 13.0;
  float lit = step(1.0 - share, wallHash(group + seed * 97.0));
  float hue = wallHash(group * 2.3 + seed * 11.0);
  vec3 tint = step(1.0 - coolOdds, wallHash(group * 1.7 + seed * 41.0)) > 0.5 ? mix(COOL_LO, COOL_HI, hue) : mix(WARM_LO, WARM_HI, hue);
  float bright = (0.5 + 0.7 * wallHash(group * 3.1 + seed * 19.0)) * paneLight(wallHash(id * 5.3 + seed * 7.0), office);
  return pane * lit * tint * bright;
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
vec3 windowGlow = vec3(0.0);
vec3 streetGlow = vec3(0.0);
if (abs(vWallN.y) < 0.5) {
  float seed = floor(vWallSeed * 1000.0 + 0.5) / 1000.0; // (whole thousandths: interpolated, the same value came out a hair off pixel to pixel - each window's hash noise)
  // The street lights' glow up its lower floors (orange or white).
  streetGlow = wallGlow * 0.035 * (0.5 + fract(seed * 3.3)) * exp(-(vWall.y - ${GROUND_Y.toFixed(1)}) / 7.0)
    * mix(${SODIUM}, ${LED}, step(0.6, fract(seed * 8.9)));
  bool office = fract(seed * 2.9) < 0.15 + 0.7 * smoothstep(25.0, 80.0, vWallTop);
  float floorH = office ? 3.8 + 0.4 * fract(seed * 13.7) : 3.0 + 0.3 * fract(seed * 13.7);
  float colW = office ? 1.5 : 1.6 + 0.3 * fract(seed * 7.3);
  float across = abs(vWallN.x) > 0.5 ? vWall.z : vWall.x;
  vec2 cell = vec2(across / colW, vWall.y / floorH);
  vec2 face = vec2(floor(vWallN.x + 0.5) * 31.0 + floor(vWallN.z + 0.5) * 57.0, 0.0);
  // (a home's window: wall between them, a sill under; an office's glass: mullions, the spandrel)
  vec4 box = office ? vec4(0.04, 0.96, 0.14, 0.86) : vec4(0.12, 0.88, 0.36, 0.78);
  // Lit together: a home (2-3 windows of a floor), an office's stretch of a floor (8-15 modules).
  float unit = office ? 8.0 + floor(8.0 * fract(seed * 4.7)) : 2.0 + floor(2.0 * fract(seed * 4.7));
  // (each building its own: most a little lit, a few lit up - their mean windowLit)
  float share = clamp(windowLit * (0.2 + 2.0 * pow(fract(seed * 5.1), 1.5)), 0.0, 1.0);
  float coolOdds = office ? 0.85 : 0.2;
  // Further off, the windows merged m x m (m 1, 2, 4, 8) so each stays a few pixels: still points of light,
  // as many lit and as bright on the whole - the two nearest merges blended; past the coarsest, their average.
  float lod = clamp(log2(max(max(fwidth(cell.x), fwidth(cell.y)), 1e-4) * 3.0), 0.0, 4.0);
  float k = min(floor(lod), 2.0), t = clamp(lod - k, 0.0, 1.0);
  float p0, p1;
  vec3 a = windowsAt(cell, exp2(k), face, seed, box, unit, share, coolOdds, office, p0);
  vec3 b = windowsAt(cell, exp2(k + 1.0), face, seed, box, unit, share, coolOdds, office, p1);
  vec3 average = (box.y - box.x) * (box.w - box.z) * share * 0.85 * (office ? OFFICE_MEAN : HOME_MEAN)
    * mix((WARM_LO + WARM_HI) * 0.5, (COOL_LO + COOL_HI) * 0.5, coolOdds);
  float far = clamp(lod - 3.0, 0.0, 1.0);
  windowGlow = windowStrength * mix(mix(a, b, t), average, far); // (added after the fog: its own)
  diffuseColor.rgb *= mix(1.0, 0.55, mix(p0, p1, t) * (1.0 - far)); // (the dark panes: glass, darker than the wall)
}`,
      )
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, cityWallFog(vFogDepth));
float windowBoost = 1.0 + ${CITY.fog.farBoost.toFixed(2)} * smoothstep(150.0, 900.0, vFogDepth);
gl_FragColor.rgb += (windowGlow * windowBoost + streetGlow) * cityLightFade(vFogDepth);
#else
gl_FragColor.rgb += windowGlow + streetGlow;
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'city-windows';
  return mat;
}

/** The street lamps' light and the dark around it, on a street's or crossing's surface (`albedo`, its pools' light). */
const STREET_LIGHT_GLSL = /* glsl */ `
vec3 streetLit(vec3 albedo, float pools, bool led, float dim) {
  vec3 col = mix(albedo * 0.12, fogColor, cityWallFog(vDepth));
  return col + albedo * (led ? ${LED} : ${SODIUM}) * pools * 1.6 * strength * dim * cityLightFade(vDepth);
}
// (the asphalt's picture: sampled once, before any branching - in a branch its mip level came out wrong far off, sparkling)
vec3 grainAt(vec2 world) { return texture2D(asphaltMap, world / ${ASPHALT.tile.toFixed(1)}).rgb / ${ASPHALT.mean.toFixed(4)}; }
vec3 asphaltOf(vec3 grain) { return asphalt * mix(vec3(1.0), grain, ${ASPHALT.strength.toFixed(2)}); }
vec3 walkOf(vec3 grain) { return walk * mix(vec3(1.0), grain, 0.4); }`;

/** A street's (or crossing's) uniforms: `pxScale` the flares' (pixels a metre at 1 m off: the view's, each frame). */
function streetUniforms(pxScale: { value: number }) {
  return {
    strength: STREET_STRENGTH,
    pxScale,
    fogColor: { value: new THREE.Color(FOG) },
    asphaltMap: { value: repeating(ASPHALT.file) },
    // (the highway's asphalt: its grey under its picture, the picture's mean taken out)
    asphalt: { value: new THREE.Color(0x45474b) },
    walk: { value: new THREE.Color(STREETS.walk) },
  };
}
const STREET_UNIFORMS_GLSL = /* glsl */ `
uniform float strength;
uniform vec3 fogColor;
uniform sampler2D asphaltMap;
uniform vec3 asphalt;
uniform vec3 walk;`;
/** How many pixels across `len` m of a ground direction `dir` (world, unit) at `world` shows (foreshortened). */
const SEEN_PX_GLSL = /* glsl */ `
uniform float pxScale;
float seenPx(vec3 world, vec3 dir, float len) {
  vec3 view = normalize(world - cameraPosition);
  float depth = -(viewMatrix * vec4(world, 1.0)).z;
  return len * length(dir - dot(dir, view) * view) * pxScale / max(depth, 1.0);
}`;

/**
 * The city's streets on the ground (STREETS; a quad each, its instance's `road`: kind (1: 2+2, else 1+1; +2: white
 * lamps), length, where it starts along its district's axis, its across's sign there): the highway's asphalt, its
 * pavements, the markings (1+1: a dashed yellow line down the middle; 2+2: a double yellow, dashed white between its
 * lanes; white edge lines), lit by its lamps' pools (as they stand: cityPlan) - their light fading as the windows'
 * far off, the rest into the night with the walls. Far off, never narrower on the screen than STREETS.minPx (its
 * light spread over the width: as bright on the whole) - thinner, it came and went from frame to frame. Drawn before
 * everything but the sky and the ground (nothing under them to hide).
 */
function streetMaterial(pxScale: { value: number }): THREE.ShaderMaterial {
  const { minor, major } = STREETS;
  return new THREE.ShaderMaterial({
    uniforms: streetUniforms(pxScale),
    vertexShader: /* glsl */ `
attribute vec4 road;
varying vec2 vRoad;
varying vec2 vWorld;
varying float vKind;
varying float vDepth;
varying float vDim;
${SEEN_PX_GLSL}
void main() {
  float width = length(instanceMatrix[0].xyz);
  vRoad = vec2(position.x * width * road.w, road.z + (position.z + 0.5) * road.y);
  vKind = road.x;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec3 across = normalize((modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  float grow = clamp(${STREETS.minPx.toFixed(1)} / max(seenPx(world.xyz, across, width), 1e-3), 1.0, 40.0);
  world.xyz += across * position.x * width * (grow - 1.0);
  vDim = 1.0 / grow;
  vWorld = world.xz;
  vec4 mv = viewMatrix * world;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
${STREET_UNIFORMS_GLSL}
varying vec2 vRoad;
varying vec2 vWorld;
varying float vKind;
varying float vDepth;
varying float vDim;
${CITY_FOG_GLSL}
${STREETS_GLSL}
${STREET_LIGHT_GLSL}
void main() {
  float kind = floor(vKind + 0.5); // (rounded: interpolated, a 2 came out 1.9999 on some pixels - read as 2+2)
  bool isMajor = mod(kind, 2.0) > 0.5;
  float hw = isMajor ? ${(major.asphalt / 2).toFixed(2)} : ${(minor.asphalt / 2).toFixed(2)};
  float walkW = isMajor ? ${major.walk.toFixed(2)} : ${minor.walk.toFixed(2)};
  float every = isMajor ? ${major.lampEvery.toFixed(1)} : ${minor.lampEvery.toFixed(1)};
  float x = vRoad.x, y = vRoad.y;
  float fx = fwidth(x), fy = fwidth(y);
  float onWalk = smoothstep(-fx, fx, abs(x) - hw);
  vec3 grain = grainAt(vWorld);
  vec3 albedo = mix(asphaltOf(grain), walkOf(grain), onWalk);
  float white = paintLine(abs(x) - (hw - 0.35), 0.075, fx);
  float yellow;
  if (isMajor) {
    yellow = paintLine(abs(x) - 0.18, 0.075, fx);
    white += paintLine(abs(x) - hw * 0.5, 0.075, fx) * dashes(y, 4.0, 10.0, fy);
  } else {
    yellow = paintLine(x, 0.075, fx) * dashes(y, 4.0, 8.0, fy);
  }
  albedo = mix(albedo, vec3(0.7), clamp(white, 0.0, 1.0) * (1.0 - onWalk));
  albedo = mix(albedo, vec3(0.75, 0.55, 0.12), clamp(yellow, 0.0, 1.0) * (1.0 - onWalk));
  float pools = streetPools(x, y, hw + walkW * 0.6, every, max(fx, fy));
  gl_FragColor = vec4(streetLit(albedo, pools, kind > 1.5, vDim), 1.0);
}`,
    depthWrite: false,
    depthTest: false,
  });
}

/**
 * The city's crossings (cityPlan; a quad each over its streets, in its district's axes, its instance's `cross`:
 * its roads' kinds (1: the one along u 2+2, 2: the one along v), +4 white lamps; its arms; its corner lamps): plain
 * asphalt where its roads meet (their markings stopped), a zebra crossing on each way on (over the other road's
 * pavement and a little past), the pavement on round a T's top and its corners, lit by its corner lamps. Far off,
 * where it is only a few pixels, gone (faded: blended over the streets) - the streets' own light there instead.
 */
function crossingMaterial(pxScale: { value: number }): THREE.ShaderMaterial {
  const { minor, major } = STREETS;
  const zebra = STREETS.zebra;
  return new THREE.ShaderMaterial({
    uniforms: streetUniforms(pxScale),
    vertexShader: /* glsl */ `
attribute vec4 crossing;
varying vec2 vLocal;
varying vec2 vWorld;
varying vec4 vCross;
varying float vDepth;
varying float vSeen;
${SEEN_PX_GLSL}
void main() {
  vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
  vLocal = position.xz * size;
  vCross = crossing;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec3 u = normalize((modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  vec3 v = normalize((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  vSeen = min(seenPx(world.xyz, u, size.x), seenPx(world.xyz, v, size.y));
  vWorld = world.xz;
  vec4 mv = viewMatrix * world;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
${STREET_UNIFORMS_GLSL}
varying vec2 vLocal;
varying vec2 vWorld;
varying vec4 vCross;
varying float vDepth;
varying float vSeen;
${CITY_FOG_GLSL}
${STREETS_GLSL}
${STREET_LIGHT_GLSL}
// (masks rounded first: interpolated, the instance's 15 came out 14.9999 on some rows of pixels - those rows' arms
// read wrong: streaks across the crossing)
bool bit(float mask, float b) { return mod(floor(floor(mask + 0.5) / b + 0.01), 2.0) > 0.5; }
// A zebra crossing's paint at x across the road it crosses (its stripes along that road), box filtered over the
// pixel (fx): hard edged, rows of stripes nearly level on the screen were smeared sideways by the FXAA.
float zebraSum(float x) {
  float p = ${(zebra.stripe * 2).toFixed(2)};
  return floor(x / p) * 0.5 * p + min(fract(x / p) * p, 0.5 * p);
}
float zebraAt(float x, float fx) {
  float h = max(fx, 1e-3) * 0.5;
  return (zebraSum(x + h) - zebraSum(x - h)) / (2.0 * h);
}
// How much of x is past e (soft over the pixel fx).
float past(float x, float e, float fx) { return smoothstep(e - fx, e + fx, x); }
void main() {
  float kinds = mod(floor(vCross.x + 0.5), 4.0);
  bool majorU = bit(kinds, 1.0), majorV = bit(kinds, 2.0);
  // (the road along u spans v: its half widths in v; the one along v spans u)
  float aV = majorU ? ${(major.asphalt / 2).toFixed(2)} : ${(minor.asphalt / 2).toFixed(2)};
  float wV = majorU ? ${major.walk.toFixed(2)} : ${minor.walk.toFixed(2)};
  float aU = majorV ? ${(major.asphalt / 2).toFixed(2)} : ${(minor.asphalt / 2).toFixed(2)};
  float wU = majorV ? ${major.walk.toFixed(2)} : ${minor.walk.toFixed(2)};
  float x = vLocal.x, y = vLocal.y, ax = abs(x), ay = abs(y);
  float fx = fwidth(x), fy = fwidth(y);
  vec3 grain = grainAt(vWorld);
  bool armU = bit(vCross.y, x > 0.0 ? 1.0 : 2.0), armV = bit(vCross.y, y > 0.0 ? 4.0 : 8.0);
  float reach = ${zebra.past.toFixed(2)};
  vec3 albedo;
  if (ax < aU && ay < aV) albedo = asphaltOf(grain);
  else if (ax < aU) {
    // (the road along v going on past the other's pavement - or not: the pavement round a T's top)
    if (!armV) { if (ay < aV + wV) albedo = walkOf(grain); else discard; }
    else if (ay < aV + wV + reach) {
      float z = past(ay, aV + 0.4, fy) * (1.0 - past(ay, aV + wV + reach - 0.4, fy)) * (1.0 - past(ax, aU - 0.3, fx)) * zebraAt(x, fx);
      albedo = mix(asphaltOf(grain), vec3(0.7), z);
    } else discard;
  } else if (ay < aV) {
    if (!armU) { if (ax < aU + wU) albedo = walkOf(grain); else discard; }
    else if (ax < aU + wU + reach) {
      float z = past(ax, aU + 0.4, fx) * (1.0 - past(ax, aU + wU + reach - 0.4, fx)) * (1.0 - past(ay, aV - 0.3, fy)) * zebraAt(y, fy);
      albedo = mix(asphaltOf(grain), vec3(0.7), z);
    } else discard;
  } else if (ax < aU + wU && ay < aV + wV) albedo = walkOf(grain);
  else discard;
  // Its corner lamps' pools (a metre in from each pole, toward its middle).
  float p2 = ${(STREETS.pool * STREETS.pool).toFixed(3)} + max(fx, fy) * max(fx, fy);
  vec2 lamp = vec2(aU + wU * ${CORNER_LAMP.toFixed(2)}, aV + wV * ${CORNER_LAMP.toFixed(2)}) - 0.7;
  float pools = 0.0;
  if (bit(vCross.z, 1.0)) pools += exp(-dot(vLocal - lamp, vLocal - lamp) / p2);
  if (bit(vCross.z, 2.0)) pools += exp(-dot(vLocal - lamp * vec2(-1.0, 1.0), vLocal - lamp * vec2(-1.0, 1.0)) / p2);
  if (bit(vCross.z, 4.0)) pools += exp(-dot(vLocal - lamp * vec2(1.0, -1.0), vLocal - lamp * vec2(1.0, -1.0)) / p2);
  if (bit(vCross.z, 8.0)) pools += exp(-dot(vLocal + lamp, vLocal + lamp) / p2);
  pools *= ${(STREETS.pool * STREETS.pool).toFixed(3)} / p2;
  gl_FragColor = vec4(streetLit(albedo, pools, vCross.x > 3.5, 1.0), smoothstep(3.0, 8.0, vSeen));
}`,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    depthTest: false,
  });
}

/**
 * Where a car of the traffic is (TRAFFIC; its `carA`: the start of its lane in the world (x, z) and the way its
 * street runs (x, z); its `carB`: its lane's length, speed (m/s, signed: the way it drives), where it starts (share of
 * the lane) and its look (0-1)) at `time`: its middle on the ground, the way it faces, how far in from its lane's
 * ends (faded there), and its size.
 */
const CAR_GLSL = /* glsl */ `
attribute vec4 carA;
attribute vec4 carB;
uniform float time;
vec3 carAt(out vec3 ahead, out float fade, out vec3 size) {
  float len = carB.x;
  float s = fract(carB.z + carB.y * time / len) * len;
  fade = smoothstep(0.0, 8.0, s) * smoothstep(0.0, 8.0, len - s);
  ahead = vec3(carA.z, 0.0, carA.w) * sign(carB.y);
  size = carB.w > ${(1 - TRAFFIC.big).toFixed(2)} ? vec3(${TRAFFIC.lorry.map((n) => n.toFixed(2)).join(', ')}) : vec3(${TRAFFIC.car.map((n) => n.toFixed(2)).join(', ')});
  return vec3(carA.x + carA.z * s, ${GROUND_Y.toFixed(1)}, carA.y + carA.w * s);
}`;

/** The traffic's bodies: a box each (an InstancedMesh of a unit box on the ground), dimly lit by the streets' light. */
function carBodyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { time: TRAFFIC_TIME, fogColor: { value: new THREE.Color(FOG) } },
    vertexShader: /* glsl */ `
${CAR_GLSL}
varying vec3 vN;
varying vec3 vColor;
varying float vDepth;
varying float vFade;
void main() {
  vec3 ahead, size;
  float fade;
  vec3 c = carAt(ahead, fade, size);
  vec3 side = vec3(ahead.z, 0.0, -ahead.x);
  // Faded in and out (its lane's ends; none further than TRAFFIC.bodies: only its lights) - its full size, its
  // pixels let go a few at a time (the fragment shader); quite gone, drawn at no size.
  vFade = fade * (1.0 - smoothstep(${(TRAFFIC.bodies * 0.85).toFixed(1)}, ${TRAFFIC.bodies.toFixed(1)}, distance(c, cameraPosition)));
  vec3 p = position * size * (vFade > 0.0 ? 1.0 : 0.0);
  vec3 world = c + side * p.x + vec3(0.0, p.y, 0.0) + ahead * p.z;
  vN = side * normal.x + vec3(0.0, normal.y, 0.0) + ahead * normal.z;
  // Its paint: white, silver, grey, black, dark blue, red (the darks the likelier).
  float k = fract(carB.w * 7.13);
  vColor = k < 0.15 ? vec3(0.6) : k < 0.3 ? vec3(0.35) : k < 0.45 ? vec3(0.15) : k < 0.75 ? vec3(0.025) : k < 0.9 ? vec3(0.02, 0.035, 0.1) : vec3(0.3, 0.025, 0.02);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
uniform vec3 fogColor;
varying vec3 vN;
varying vec3 vColor;
varying float vDepth;
varying float vFade;
${CITY_FOG_GLSL}
void main() {
  // (fading: a share of its pixels let go, scattered - interleaved gradient noise over the screen)
  if (vFade < 1.0 && vFade <= fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
  // (the street lights' warm glow on its roof and sides)
  float lit = 0.05 + 0.25 * max(vN.y, 0.0) + 0.08 * (1.0 - abs(vN.y));
  gl_FragColor = vec4(mix(vColor * lit * vec3(1.0, 0.78, 0.55), fogColor, cityWallFog(vDepth)), 1.0);
}`,
  });
}

/**
 * The traffic's lights: two points a car (its geometry's `end`: +1 ahead, white; -1 behind, red), glowing sprites as
 * the lamps' flares (render/lightFlares: never under `minPx`, fading off far), each seen only from the way it shines.
 */
function carLightMaterial(scale: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      time: TRAFFIC_TIME,
      scale,
      minPx: { value: 2 },
      aimFull: { value: Math.cos(THREE.MathUtils.degToRad(FLARE_AIM.full)) },
      aimGone: { value: Math.cos(THREE.MathUtils.degToRad(FLARE_AIM.gone)) },
    },
    vertexShader: /* glsl */ `
${CAR_GLSL}
attribute float end;
uniform float scale;
uniform float minPx;
uniform float aimFull;
uniform float aimGone;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 ahead, size;
  float fade;
  vec3 c = carAt(ahead, fade, size);
  vec3 world = c + ahead * end * (size.z * 0.5 + 0.3) + vec3(0.0, 0.75, 0.0);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  float px = 0.8 * scale / max(-mv.z, 0.1);
  gl_PointSize = max(px, minPx);
  vAlpha = (px < minPx ? mix(0.55, 1.0, px / minPx) : 1.0) * fade * clamp(1.0 - (-mv.z) / 1400.0, 0.0, 1.0);
  vAlpha *= smoothstep(aimGone, aimFull, dot(ahead * end, normalize(cameraPosition - world)));
  vColor = end > 0.0 ? vec3(1.6, 1.47, 1.25) : vec3(1.5, 0.1, 0.05);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length((gl_PointCoord - 0.5) * 2.0);
  if (d > 1.0) discard;
  float core = 1.0 - d;
  gl_FragColor = vec4(vColor * (core * core * core * 1.2 + core * 0.25) * vAlpha, 1.0);
}`,
  });
}

/**
 * The skyline's picture (SKYLINE): buildings side by side along it, black against nothing (its alpha: the
 * silhouette), taller where a slow wave along it says (districts of towers, low ones between), now and then a gap;
 * a few windows lit (warm or cool) and a red light on the tallest. Joined round its ends (it repeats).
 */
function skylineTexture(): THREE.CanvasTexture {
  const S = SKYLINE;
  const W = S.width, H = S.rows;
  const mx = (S.radius * 2 * Math.PI) / S.repeat / W; // (metres a pixel across)
  const my = S.height / H;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rnd = seeded(11);
  const lerp = (r: readonly [number, number], k = rnd()) => r[0] + k * (r[1] - r[0]);
  // (drawn at x and, past the end, round again at x - W)
  const rect = (x: number, y: number, w: number, h: number) => {
    g.fillRect(x, y, w, h);
    if (x + w > W) g.fillRect(x - W, y, w, h);
  };
  for (let x = 0; x < W; ) {
    const wPx = Math.max(3, Math.round(lerp(S.wide) / mx));
    if (rnd() < 0.06) {
      x += wPx; // (a gap: a park, a road)
      continue;
    }
    // (towers where the wave is up: three slow waves round, a quicker one on them)
    const wave = 0.5 + 0.35 * Math.sin((x / W) * Math.PI * 2 * 3 + 1.3) + 0.15 * Math.sin((x / W) * Math.PI * 2 * 11);
    const tall = lerp(S.tall, Math.min(1, Math.max(0, wave * (0.3 + 0.9 * rnd() ** 2))));
    const hPx = Math.round(tall / my);
    g.fillStyle = '#000';
    rect(x, H - hPx, wPx, hPx);
    // Its windows: a few lit, a pixel or two each.
    const floors = Math.floor(tall / S.floor), cols = Math.floor((wPx * mx) / S.across);
    const fPx = S.floor / my;
    for (let f = 1; f < floors; f++)
      for (let k = 0; k < cols; k++) {
        if (rnd() > S.lit) continue;
        const warm = rnd() < 0.7;
        g.fillStyle = warm ? `rgb(255,${150 + Math.floor(rnd() * 60)},${70 + Math.floor(rnd() * 50)})` : `rgb(${200 + Math.floor(rnd() * 30)},${215 + Math.floor(rnd() * 25)},255)`;
        rect(x + Math.floor(((k + 0.5) * wPx) / cols), Math.round(H - f * fPx - fPx * 0.7), 2, Math.max(2, Math.round(fPx * 0.5)));
      }
    if (tall > 110 && rnd() < 0.6) {
      g.fillStyle = 'rgb(255,40,30)';
      rect(x + Math.floor(wPx / 2), H - hPx - 1, 1, 2);
    }
    x += wPx;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function repeating(file: string): THREE.Texture {
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
export function withAsphalt(mat: THREE.MeshStandardMaterial, renderer: THREE.WebGLRenderer): THREE.MeshStandardMaterial {
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

/** The ribbons' rows along the road (m apart): a bend of R 1000 strays from a 5 m chord by 3 mm. */
const SEG = 5;
const ROWS = STRIP_LEN / SEG + 1;

/** One face of a sweep: its edge across the road, (d, y) to (d, y) - its face to the left of that way (clockwise round a solid). */
type Edge = [number, number, number, number];

/** The road's line at each of the strip's rows (from its start, SEG m apart): its point and its normal (toward +d). */
interface RowFrames {
  cx: Float64Array;
  cz: Float64Array;
  nx: Float64Array;
  nz: Float64Array;
}

/**
 * Faces swept along the road: each an edge across it (d, y) carried along s, its rows SEG m apart over the strip
 * (placed by layout, on the road's line). Each vertex also has its road position (`roadPos`: d, -s; the lamps'
 * pools are worked out on it) and a uv: `u` per metre across and at d 0, `v` per metre along from the strip's start
 * (the same wherever the strip is: set once).
 */
class Sweep {
  readonly geometry = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;
  private readonly road: Float32Array;

  constructor(
    private readonly edges: Edge[],
    uv: { u: number; u0: number; v: number } = { u: 0, u0: 0, v: 0 },
  ) {
    const n = ROWS * edges.length * 2;
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.road = new Float32Array(n * 2);
    const uvs = new Float32Array(n * 2);
    const index: number[] = [];
    const v = (e: number, r: number, k: number) => (e * ROWS + r) * 2 + k;
    for (let e = 0; e < edges.length; e++)
      for (let r = 0; r < ROWS; r++) {
        for (let k = 0; k < 2; k++) {
          const d = edges[e][k * 2];
          const i = v(e, r, k);
          uvs[i * 2] = uv.u * d + uv.u0;
          uvs[i * 2 + 1] = uv.v * r * SEG;
          this.road[i * 2] = d;
        }
        if (r + 1 < ROWS) index.push(v(e, r, 0), v(e, r + 1, 1), v(e, r + 1, 0), v(e, r, 0), v(e, r, 1), v(e, r + 1, 1));
      }
    this.geometry.setIndex(index);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setAttribute('roadPos', new THREE.BufferAttribute(this.road, 2));
  }

  /** Along the road's line at the strip's rows (`rows`), the strip starting at s = `from`. */
  layout(rows: RowFrames, from: number): void {
    const { edges, pos, nrm, road } = this;
    for (let e = 0; e < edges.length; e++) {
      const [d0, y0, d1, y1] = edges[e];
      // (its face to the left of the edge's way: (-dy, dd) across and up)
      const len = Math.hypot(d1 - d0, y1 - y0);
      const nd = -(y1 - y0) / len;
      const ny = (d1 - d0) / len;
      for (let r = 0; r < ROWS; r++) {
        const cx = rows.cx[r];
        const cz = rows.cz[r];
        const nx = rows.nx[r];
        const nz = rows.nz[r];
        const ms = -(from + r * SEG);
        for (let k = 0; k < 2; k++) {
          const d = k ? d1 : d0;
          const i = (e * ROWS + r) * 2 + k;
          pos[i * 3] = cx + d * nx;
          pos[i * 3 + 1] = k ? y1 : y0;
          pos[i * 3 + 2] = cz + d * nz;
          nrm[i * 3] = nd * nx;
          nrm[i * 3 + 1] = ny;
          nrm[i * 3 + 2] = nd * nz;
          road[i * 2 + 1] = ms;
        }
      }
    }
    for (const name of ['position', 'normal', 'roadPos']) this.geometry.getAttribute(name).needsUpdate = true;
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
/** The road's line where an instance goes (RoadScene.at). */
const AT = { cx: 0, cz: 0, nx: 1, nz: 0, q: new THREE.Quaternion() };
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const P3 = new THREE.Vector3();
const S3 = new THREE.Vector3();
const Q4 = new THREE.Quaternion();
/** A quarter turn about the vertical (a quad's z to its x). */
const QUARTER = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

/** What the game asks of the scenery along the road (the highway's, the mountain road's). */
export interface Scenery {
  /** The road to lay the scenery along (a new race's). */
  setRoad(line: Centerline): void;
  /** Kept round the player (`playerS` along the road), each frame; `play` s of race time on (its blinking: 0 paused). */
  update(playerS: number, play?: number): void;
  /** Surfaces lit by the other cars' headlight beams (render/npcBeams). */
  readonly groundMaterials: THREE.MeshStandardMaterial[];
  /** The real lights shining now (tyre smoke is lit by them). */
  activeLights(): THREE.SpotLight[];
  /** Its lamps' flares' material (sized to the view each frame). */
  readonly lampFlareMaterial: THREE.ShaderMaterial;
  /**
   * The ground's height as drawn at (x, z) (`hint`: an s near it - the car's): the camera kept clear of it
   * (render/cameraArm). None: the camera left be (the practice ground: flat and open).
   */
  groundAt?(x: number, z: number, hint?: number): number;
}

export class RoadScene implements Scenery {
  private strip = new THREE.Group();
  private city = new THREE.Group();
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
  /** The road's line, and the strip's start (s) and the city's as last laid along it (NaN: to be). */
  private line: Centerline = STRAIGHT_ROAD;
  private laidS = NaN;
  private cityS = NaN;
  private readonly sweeps: Sweep[] = [];
  private readonly rows: RowFrames = { cx: new Float64Array(ROWS), cz: new Float64Array(ROWS), nx: new Float64Array(ROWS), nz: new Float64Array(ROWS) };
  private posts!: THREE.InstancedMesh;
  private poles!: THREE.InstancedMesh;
  private arms!: THREE.InstancedMesh;
  private heads!: THREE.InstancedMesh;
  private lampFlares!: THREE.Points;
  private poleSpecs: PoleSpec[] = [];
  private shrubs!: THREE.InstancedMesh;
  private shrubBase: { s: number; d: number; h: number; w: number }[] = [];
  private buildings!: THREE.InstancedMesh;
  /**
   * The city's buildings in one period of it: their block's middle (s, d) and turn against the road (its cos, sin,
   * as a quaternion), their own place on the block (u, v: along its axes), size (w, l: along them), top over the road.
   */
  private cityBase: { s: number; d: number; u: number; v: number; w: number; l: number; top: number; cy: number; sy: number; q: THREE.Quaternion }[] = [];
  /** The city's blocks in one period of it (their streets on the ground): middle (s, d), radius, turn. */
  private cityRoads: (PlanRoad & { q: THREE.Quaternion })[] = [];
  private cityLamps: PlanLamp[] = [];
  private cityCrossings: (PlanCrossing & { q: THREE.Quaternion })[] = [];
  private crossings!: THREE.InstancedMesh;
  /** The traffic in one period of the city: each car's street (cityRoads), its lane (across the street's line), way, its carB. */
  private cityCars: { road: number; off: number; carB: number[] }[] = [];
  private carBodies!: THREE.InstancedMesh;
  private carLights!: THREE.Points;
  /** Its streets as last laid (the world: their middles, the way they run, half their length and width) - for the piers. */
  private streetRects: { x: number; z: number; dx: number; dz: number; halfLen: number; halfW: number }[] = [];
  /** Its lamps as last laid: x, z, and the turn of each pole (its arm over its street). */
  private lampAt = new Float32Array(0);
  /** Where along the road its poles were last laid round the player (NaN: to be). */
  private polesAt = NaN;
  private streets!: THREE.InstancedMesh;
  private streetPoles!: THREE.InstancedMesh;
  private streetFlares!: THREE.Points;
  private pierCaps!: THREE.InstancedMesh;
  private pierColumns!: THREE.InstancedMesh;

  /** The street lights currently shining (for things lit by hand, like tyre smoke). */
  activeLights(): THREE.SpotLight[] {
    return this.realLights.filter((l) => l.visible && l.intensity > 0);
  }

  /** The ground: flat (the road 0.01 m up, the grass 0.02 down) - the camera kept clear of it (Scenery.groundAt). */
  groundAt(): number {
    return 0;
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
    this.buildCity();
    this.buildFar();
    // (laid along the road round the player: always in view somewhere - and their bounds not worked out anew each time)
    for (const o of [...this.strip.children, ...this.city.children]) o.frustumCulled = false;
    scene.add(this.strip, this.city, this.far);
    this.layout(0);
  }

  /** The road to lay the scenery along (a new race's). */
  setRoad(line: Centerline): void {
    this.line = line;
    this.laidS = NaN;
    this.cityS = NaN;
  }

  private buildStrip(renderer: THREE.WebGLRenderer): void {
    // Our carriageway, its texture across it (rail to rail) and every 20 m along.
    const roadSweep = new Sweep([[-RAIL_D, 0.01, RAIL_D, 0.01]], { u: 1 / (2 * RAIL_D), u0: 0.5, v: 1 / 20 });
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
    const road2Sweep = new Sweep([[ONCOMING_X - RAIL_D, 0.01, ONCOMING_X + RAIL_D, 0.01]], {
      u: -1 / (2 * RAIL_D),
      u0: (ONCOMING_X + RAIL_D) / (2 * RAIL_D),
      v: 1 / 20,
    });
    const road2 = new THREE.Mesh(road2Sweep.geometry, roadMat2);
    road2.receiveShadow = true;
    this.strip.add(road2);
    this.groundMaterials.push(road.material as THREE.MeshStandardMaterial, roadMat2);

    // The median's strip of grass, a little up off the road (its kerbs under the rails' beams).
    const grassSweep = new Sweep([[MEDIAN_FAR_X, 0.1, MEDIAN_NEAR_X, 0.1]], { u: 1 / GRASS.tile, u0: 0, v: 1 / GRASS.tile });
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

    // The deck: its parapets (from their tops' outer edges round: the road between them left out) and its edges
    // down under the road, its underside.
    const L = LEFT_RAIL_X, R = RAIL_D, pw = PARAPET.width, ph = PARAPET.height, under = -DECK_DEPTH;
    const deckSweep = new Sweep([
      [L - pw, ph, L, ph],
      [L, ph, L, 0.01],
      [R, 0.01, R, ph],
      [R, ph, R + pw, ph],
      [R + pw, ph, R + pw, under],
      [R + pw, under, L - pw, under],
      [L - pw, under, L - pw, ph],
      // (the median strip's kerbs, up from the road to its grass: no gap under them to see through)
      [MEDIAN_NEAR_X, 0.12, MEDIAN_NEAR_X, 0],
      [MEDIAN_FAR_X, 0, MEDIAN_FAR_X, 0.12],
    ]);
    const deck = new THREE.Mesh(deckSweep.geometry, new THREE.MeshStandardMaterial({ color: 0x75777a, roughness: 0.9 }));
    deck.receiveShadow = true;
    this.strip.add(deck);
    // Its piers (PIER): a cap beam across under it, its columns down to the ground.
    const piers = STRIP_LEN / PIER.spacing;
    this.pierCaps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), deck.material, piers);
    this.pierColumns = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), deck.material, piers * PIER.columns.length);
    this.strip.add(this.pierCaps, this.pierColumns);

    // The median's guardrails: a beam along each side of its strip, facing its carriageway, posts every 4 m.
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.4, metalness: 0.7 });
    const beamEdges: Edge[] = [];
    for (const [x, way] of MEDIAN_RAILS) {
      const c = x - way * 0.06;
      beamEdges.push(...boxEdges(c - 0.06, c + 0.06, 0.62 - 0.17, 0.62 + 0.17));
    }
    const beamSweep = new Sweep(beamEdges);
    const beams = new THREE.Mesh(beamSweep.geometry, metal);
    beams.castShadow = true;
    this.strip.add(beams);
    this.sweeps.push(roadSweep, road2Sweep, grassSweep, deckSweep, beamSweep);
    const postCount = (STRIP_LEN / 4) * 2;
    this.posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.8, 0.14), metal, postCount);
    this.strip.add(this.posts);

    // The strip's shrubs: a pattern repeating every STRIP_PERIOD m (the strip laid on a whole one), each its own
    // size and place across.
    const rnd = seeded(7);
    const per = STRIP_PERIOD / SHRUB.spacing;
    const lerp = (r: readonly [number, number]) => r[0] + rnd() * (r[1] - r[0]);
    for (let k = 0; k < per; k++)
      this.shrubBase.push({ s: (k + rnd() * 0.6) * SHRUB.spacing, d: (MEDIAN_NEAR_X + MEDIAN_FAR_X) / 2 + (rnd() - 0.5) * 0.6, h: lerp(SHRUB.height), w: lerp(SHRUB.width) });
    this.shrubs = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.5, 1),
      new THREE.MeshStandardMaterial({ color: SHRUB.color, roughness: 1, flatShading: true }),
      per * (STRIP_LEN / STRIP_PERIOD),
    );
    this.strip.add(this.shrubs);

    // Street lights, opposite arrangement: each row has a lamp on the right shoulder
    // and one on the median facing it, so their pools meet across our carriageway
    // and a single real light can stand in for the pair. The median lamps have a
    // second arm over the oncoming carriageway, which also has lamps on its outer edge.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.6, metalness: 0.5 });
    const headMat = new THREE.MeshBasicMaterial({ color: LAMP_COLOR });
    const medianX = (MEDIAN_NEAR_X + MEDIAN_FAR_X) / 2;
    // (the outer ones on the parapets, the median's among its shrubs)
    this.poleSpecs = [
      { d: RAIL_D + PARAPET.width / 2, arms: [[-1, 2]] },
      { d: medianX, arms: [[-1, 4.5], [1, 4.5]] },
      { d: LEFT_RAIL_X - PARAPET.width / 2, arms: [[1, 2]] },
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
  /** The road's line at s (into AT): its point, its normal, its turn (for the instances). */
  private at(s: number): void {
    const c = this.line.center(s);
    const th = this.line.heading(s);
    AT.cx = c.x;
    AT.cz = c.z;
    AT.nx = Math.cos(th);
    AT.nz = Math.sin(th);
    AT.q.setFromAxisAngle(AXIS_Y, -th);
  }

  /** An instance `d` across the road where `at` last was, `y` up, turned with the road (its x across it), stretched `sx` across. */
  private place(mesh: THREE.InstancedMesh, i: number, d: number, y: number, sx = 1, scale = 1): void {
    P3.set(AT.cx + d * AT.nx, y, AT.cz + d * AT.nz);
    mesh.setMatrixAt(i, M4.compose(P3, AT.q, S3.set(sx * scale, scale, scale)));
  }

  /** An instance as `place`, sized `w` across the road, `h` up and `l` along it. */
  private put(mesh: THREE.InstancedMesh, i: number, d: number, y: number, w: number, h: number, l: number): void {
    P3.set(AT.cx + d * AT.nx, y, AT.cz + d * AT.nz);
    mesh.setMatrixAt(i, M4.compose(P3, AT.q, S3.set(w, h, l)));
  }

  /** The strip's scenery laid along the road from s = `stripS` - STRIP_BEHIND. */
  private layout(stripS: number): void {
    this.laidS = stripS;
    const from = stripS - STRIP_BEHIND;
    const f = this.rows;
    for (let r = 0; r < ROWS; r++) {
      const s = from + r * SEG;
      const c = this.line.center(s);
      const th = this.line.heading(s);
      f.cx[r] = c.x;
      f.cz[r] = c.z;
      f.nx[r] = Math.cos(th);
      f.nz[r] = Math.sin(th);
    }
    for (const sw of this.sweeps) sw.layout(f, from);
    let i = 0;
    for (let s = -STRIP_BEHIND; s < STRIP_AHEAD; s += 4) {
      this.at(stripS + s);
      for (const [x, way] of MEDIAN_RAILS) this.place(this.posts, i++, x - way * 0.2, 0.4);
    }
    i = 0;
    for (let p = -STRIP_BEHIND; p < STRIP_AHEAD; p += STRIP_PERIOD)
      for (const b of this.shrubBase) {
        this.at(stripS + p + b.s);
        this.put(this.shrubs, i++, b.d, 0.1 + b.h * 0.4, b.w, b.h, b.w * 1.3);
      }
    let pi = 0;
    let ai = 0;
    const rows = STRIP_LEN / LAMP_SPACING;
    for (let r = 0; r < rows; r++) {
      this.at(stripS - STRIP_BEHIND + r * LAMP_SPACING);
      for (const spec of this.poleSpecs) {
        this.place(this.poles, pi++, spec.d, 5);
        for (const [dir, reach] of spec.arms) {
          this.place(this.arms, ai, spec.d + (dir * (reach + 0.2)) / 2, 9.9, reach + 0.2);
          this.place(this.heads, ai, spec.d + dir * reach, LAMP_HEIGHT);
          ai++;
        }
      }
    }
    this.layoutPiers();
    const fpos = this.lampFlares.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.lampHeads.forEach((h, k) => {
      const w = this.line.toWorld(stripS + h.s, h.x);
      fpos.setXYZ(k, w.x, LAMP_HEIGHT - 0.15, w.z);
    });
    fpos.needsUpdate = true;
    for (const m of [this.posts, this.shrubs, this.poles, this.arms, this.heads]) m.instanceMatrix.needsUpdate = true;
  }

  /** The deck's piers along the strip (as last laid), none where a street passes under (streetRects). */
  private layoutPiers(): void {
    const stripS = this.laidS;
    if (Number.isNaN(stripS)) return;
    // (its top a little up inside the deck: level with the deck's underside the two came through each other in turn)
    const capTop = -DECK_DEPTH + 0.05, capBottom = -DECK_DEPTH - PIER.cap;
    const deckL = LEFT_RAIL_X - PARAPET.width, deckR = RAIL_D + PARAPET.width;
    const hit = (x: number, z: number) =>
      this.streetRects.some((r) => {
        const dx = x - r.x, dz = z - r.z;
        return Math.abs(dx * r.dx + dz * r.dz) < r.halfLen + PIER.side && Math.abs(dz * r.dx - dx * r.dz) < r.halfW + PIER.side;
      });
    let ci = 0;
    for (let k = 0; k < STRIP_LEN / PIER.spacing; k++) {
      this.at(stripS - STRIP_BEHIND + PIER.offset + k * PIER.spacing);
      const clear = !PIER.columns.some((x) => hit(AT.cx + x * AT.nx, AT.cz + x * AT.nz));
      const n = clear ? 1 : 0; // (a pier left out: its instances drawn at no size)
      this.put(this.pierCaps, k, (deckL + deckR) / 2, (capTop + capBottom) / 2, (deckR - deckL - 1) * n, PIER.cap * n, PIER.capLong * n);
      for (const x of PIER.columns) this.put(this.pierColumns, ci++, x, (capBottom + GROUND_Y) / 2, PIER.side * n, (capBottom - GROUND_Y) * n, PIER.side * n);
    }
    this.pierCaps.instanceMatrix.needsUpdate = true;
    this.pierColumns.instanceMatrix.needsUpdate = true;
  }

  /**
   * The city: one period of it either side (CITY, planned by cityPlan) - its buildings, its streets on the ground,
   * their lamps (poles and their glow).
   */
  private buildCity(): void {
    const plan = planCity(
      {
        ...CITY,
        deck: { left: LEFT_RAIL_X - PARAPET.width, right: RAIL_D + PARAPET.width, mid: (LEFT_RAIL_X + RAIL_D) / 2 },
        minor: STREETS.minor,
        major: STREETS.major,
      },
      seeded(42),
    );
    const turns = new Map<number, THREE.Quaternion>();
    const turn = (yaw: number) => {
      if (!turns.has(yaw)) turns.set(yaw, new THREE.Quaternion().setFromAxisAngle(AXIS_Y, yaw));
      return turns.get(yaw)!;
    };
    for (const b of plan.buildings) this.cityBase.push({ ...b, q: turn(b.yaw) });
    const reps = CITY_REPS;
    this.buildings = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      withWindows(new THREE.MeshStandardMaterial({ color: CITY.color, roughness: 0.85 })),
      this.cityBase.length * reps,
    );
    this.city.add(this.buildings);

    // The streets: the 1+1 ones first, the 2+2 over them where they cross (their markings on through it).
    this.cityRoads = [...plan.roads.filter((r) => !r.major), ...plan.roads.filter((r) => r.major)].map((r) => ({ ...r, q: turn(r.yaw) }));
    const info = new Float32Array(this.cityRoads.length * reps * 4);
    this.cityRoads.forEach((r, k) => {
      // (its kind and lamps' colour, its length, where it starts along its axis, its across's sign: its quad's x
      // the district's u along v, its -v along u)
      const row = [(r.major ? 1 : 0) + (r.led ? 2 : 0), r.to - r.from, r.from, r.alongU ? -1 : 1];
      for (let rep = 0; rep < reps; rep++) info.set(row, (rep * this.cityRoads.length + k) * 4);
    });
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    quad.setAttribute('road', new THREE.InstancedBufferAttribute(info, 4));
    const pxScale = this.lampFlareMaterial.uniforms.scale;
    this.streets = new THREE.InstancedMesh(quad, streetMaterial(pxScale), this.cityRoads.length * reps);
    this.streets.renderOrder = -0.8;
    this.city.add(this.streets);

    // Their crossings, over them.
    this.cityCrossings = plan.crossings.map((c) => ({ ...c, q: turn(c.yaw) }));
    const cinfo = new Float32Array(this.cityCrossings.length * reps * 4);
    this.cityCrossings.forEach((c, k) => {
      const row = [(c.majorU ? 1 : 0) + (c.majorV ? 2 : 0) + (c.led ? 4 : 0), c.arms, c.corners, 0];
      for (let rep = 0; rep < reps; rep++) cinfo.set(row, (rep * this.cityCrossings.length + k) * 4);
    });
    const cquad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    cquad.setAttribute('crossing', new THREE.InstancedBufferAttribute(cinfo, 4));
    this.crossings = new THREE.InstancedMesh(cquad, crossingMaterial(pxScale), this.cityCrossings.length * reps);
    this.crossings.renderOrder = -0.75;
    this.city.add(this.crossings);

    // Their traffic (TRAFFIC): each lane's cars spread round it, all at its speed.
    const trnd = seeded(77);
    this.cityRoads.forEach((r, road) => {
      const T = r.major ? TRAFFIC.major : TRAFFIC.minor;
      const len = r.to - r.from;
      for (const way of [1, -1])
        for (let lane = 0; lane < (r.major ? 2 : 1); lane++) {
          const n = Math.floor((len / T.every) * (0.6 + 0.8 * trnd()));
          const speed = T.speed[0] + trnd() * (T.speed[1] - T.speed[0]);
          for (let k = 0; k < n; k++)
            this.cityCars.push({ road, off: way * TRAFFIC.lane * (lane + 0.5), carB: [len, way * speed, (k + (trnd() - 0.5) * 0.4) / n, trnd()] });
        }
    });
    const cars = this.cityCars.length * reps;
    const body = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const bodyB = new Float32Array(cars * 4);
    const lightB = new Float32Array(cars * 8);
    const ends = new Float32Array(cars * 2);
    for (let rep = 0; rep < reps; rep++)
      this.cityCars.forEach((c, k) => {
        const i = rep * this.cityCars.length + k;
        bodyB.set(c.carB, i * 4);
        lightB.set(c.carB, i * 8);
        lightB.set(c.carB, i * 8 + 4);
        ends[i * 2] = 1;
        ends[i * 2 + 1] = -1;
      });
    body.setAttribute('carA', new THREE.InstancedBufferAttribute(new Float32Array(cars * 4), 4));
    body.setAttribute('carB', new THREE.InstancedBufferAttribute(bodyB, 4));
    this.carBodies = new THREE.InstancedMesh(body, carBodyMaterial(), cars);
    this.city.add(this.carBodies);
    const lights = new THREE.BufferGeometry();
    lights.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cars * 2 * 3), 3));
    lights.setAttribute('carA', new THREE.BufferAttribute(new Float32Array(cars * 8), 4));
    lights.setAttribute('carB', new THREE.BufferAttribute(lightB, 4));
    lights.setAttribute('end', new THREE.BufferAttribute(ends, 1));
    this.carLights = new THREE.Points(lights, carLightMaterial(pxScale));
    this.carLights.renderOrder = 3;
    this.city.add(this.carLights);

    // Their lamps: poles (near the player: streetPoles) and their glow (all).
    this.cityLamps = plan.lamps.map((l) => ({ ...l }));
    const n = this.cityLamps.length * reps;
    this.lampAt = new Float32Array(n * 3);
    const P = STREETS.pole;
    const pole = new THREE.BoxGeometry(0.22, P.height, 0.22).translate(0, P.height / 2, 0);
    const arm = new THREE.BoxGeometry(P.reach + 0.3, 0.18, 0.4).translate((P.reach + 0.3) / 2 - 0.1, P.height - 0.1, 0);
    this.streetPoles = new THREE.InstancedMesh(
      mergeGeometries([pole, arm])!,
      new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.6, metalness: 0.5 }),
      n,
    );
    this.streetPoles.count = 0;
    this.city.add(this.streetPoles);
    const fgeo = new THREE.BufferGeometry();
    const fcol = new Float32Array(n * 3);
    const fsize = new Float32Array(n).fill(1.1);
    const sodium = new THREE.Color(1.0, 0.55, 0.22), led = new THREE.Color(0.85, 0.9, 1.0);
    for (let rep = 0; rep < reps; rep++)
      this.cityLamps.forEach((l, k) => {
        const c = l.led ? led : sodium;
        fcol.set([c.r, c.g, c.b], (rep * this.cityLamps.length + k) * 3);
      });
    fgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    fgeo.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
    fgeo.setAttribute('size', new THREE.BufferAttribute(fsize, 1));
    this.streetFlares = new THREE.Points(fgeo, this.lampFlareMaterial);
    this.streetFlares.renderOrder = 3;
    this.city.add(this.streetFlares);
  }

  /** The city (its pattern repeating every CITY.period m) along the road from s = `cityS` - STRIP_BEHIND. */
  private layoutCity(cityS: number): void {
    this.cityS = cityS;
    const reps = CITY_REPS;
    // A district's axes in the world (into AX), where `at` last was: the road's (across it: its normal) turned by its turn.
    const AX = { ax: 0, az: 0, bx: 0, bz: 0 };
    const axes = (p: { cy: number; sy: number }) => {
      AX.ax = AT.nx * p.cy + AT.nz * p.sy;
      AX.az = AT.nz * p.cy - AT.nx * p.sy;
      AX.bx = p.sy * AT.nx - p.cy * AT.nz;
      AX.bz = p.cy * AT.nx + p.sy * AT.nz;
    };
    const worldX = (d: number, u: number, v: number) => AT.cx + d * AT.nx + u * AX.ax + v * AX.bx;
    const worldZ = (d: number, u: number, v: number) => AT.cz + d * AT.nz + u * AX.az + v * AX.bz;
    let i = 0;
    for (let r = 0; r < reps; r++)
      for (const b of this.cityBase) {
        this.at(cityS - STRIP_BEHIND + r * CITY.period + b.s);
        axes(b);
        P3.set(worldX(b.d, b.u, b.v), (b.top + CITY.base) / 2, worldZ(b.d, b.u, b.v));
        this.buildings.setMatrixAt(i++, M4.compose(P3, Q4.copy(AT.q).multiply(b.q), S3.set(b.w, b.top - CITY.base, b.l)));
      }
    this.buildings.instanceMatrix.needsUpdate = true;

    i = 0;
    this.streetRects = [];
    for (let r = 0; r < reps; r++)
      for (const road of this.cityRoads) {
        this.at(cityS - STRIP_BEHIND + r * CITY.period + road.s);
        axes(road);
        const kind = road.major ? STREETS.major : STREETS.minor;
        const width = kind.asphalt + 2 * kind.walk, length = road.to - road.from, mid = (road.from + road.to) / 2;
        const u = road.alongU ? mid : road.at, v = road.alongU ? road.at : mid;
        P3.set(worldX(road.d, u, v), GROUND_Y, worldZ(road.d, u, v));
        Q4.copy(AT.q).multiply(road.q);
        if (road.alongU) Q4.multiply(QUARTER);
        this.streets.setMatrixAt(i++, M4.compose(P3, Q4, S3.set(width, 1, length)));
        // (for the piers: where it is, the way it runs)
        this.streetRects.push({ x: P3.x, z: P3.z, dx: road.alongU ? AX.ax : AX.bx, dz: road.alongU ? AX.az : AX.bz, halfLen: length / 2, halfW: width / 2 });
      }
    this.streets.instanceMatrix.needsUpdate = true;

    i = 0;
    const width = (major: boolean) => (major ? STREETS.major : STREETS.minor).asphalt + 2 * (major ? STREETS.major : STREETS.minor).walk;
    for (let r = 0; r < reps; r++)
      for (const c of this.cityCrossings) {
        this.at(cityS - STRIP_BEHIND + r * CITY.period + c.s);
        axes(c);
        P3.set(worldX(c.d, c.u, c.v), GROUND_Y, worldZ(c.d, c.u, c.v));
        // (across u: the road along v's width, and its zebra past the other's pavement either way; across v, the other's)
        const su = width(c.majorV) + 2 * STREETS.zebra.past, sv = width(c.majorU) + 2 * STREETS.zebra.past;
        this.crossings.setMatrixAt(i++, M4.compose(P3, Q4.copy(AT.q).multiply(c.q), S3.set(su, 1, sv)));
      }
    this.crossings.instanceMatrix.needsUpdate = true;

    // The traffic's lanes in the world: each car's lane's start and the way its street runs.
    const bodyA = this.carBodies.geometry.getAttribute('carA') as THREE.BufferAttribute;
    const lightA = this.carLights.geometry.getAttribute('carA') as THREE.BufferAttribute;
    i = 0;
    for (let r = 0; r < reps; r++)
      for (const car of this.cityCars) {
        const road = this.cityRoads[car.road];
        this.at(cityS - STRIP_BEHIND + r * CITY.period + road.s);
        axes(road);
        const u = road.alongU ? road.from : road.at + car.off, v = road.alongU ? road.at + car.off : road.from;
        const x = worldX(road.d, u, v), z = worldZ(road.d, u, v);
        const dx = road.alongU ? AX.ax : AX.bx, dz = road.alongU ? AX.az : AX.bz;
        bodyA.setXYZW(i, x, z, dx, dz);
        lightA.setXYZW(i * 2, x, z, dx, dz);
        lightA.setXYZW(i * 2 + 1, x, z, dx, dz);
        i++;
      }
    bodyA.needsUpdate = true;
    lightA.needsUpdate = true;

    const fpos = this.streetFlares.geometry.getAttribute('position') as THREE.BufferAttribute;
    const P = STREETS.pole;
    i = 0;
    for (let r = 0; r < reps; r++)
      for (const l of this.cityLamps) {
        this.at(cityS - STRIP_BEHIND + r * CITY.period + l.s);
        axes(l);
        const x = worldX(l.d, l.u, l.v), z = worldZ(l.d, l.u, l.v);
        // (its arm's way in the world, and the turn about the vertical taking a pole's x to it)
        const dx = l.armU * AX.ax + l.armV * AX.bx, dz = l.armU * AX.az + l.armV * AX.bz;
        this.lampAt.set([x, z, Math.atan2(-dz, dx)], i * 3);
        fpos.setXYZ(i, x + dx * (P.reach - 0.1), GROUND_Y + P.height - 0.25, z + dz * (P.reach - 0.1));
        i++;
      }
    fpos.needsUpdate = true;
    this.polesAt = NaN;
    this.layoutPiers();
  }

  /** The street lamps' poles within STREETS.poles of the player (`playerS` along the road): further, only their glow. */
  private layoutPoles(playerS: number): void {
    this.polesAt = playerS;
    const c = this.line.center(playerS);
    const near2 = STREETS.poles * STREETS.poles;
    let n = 0;
    for (let k = 0; k < this.lampAt.length / 3; k++) {
      const x = this.lampAt[k * 3], z = this.lampAt[k * 3 + 1];
      if ((x - c.x) ** 2 + (z - c.z) ** 2 > near2) continue;
      P3.set(x, GROUND_Y, z);
      Q4.setFromAxisAngle(AXIS_Y, this.lampAt[k * 3 + 2]);
      this.streetPoles.setMatrixAt(n++, M4.compose(P3, Q4, S3.set(1, 1, 1)));
    }
    this.streetPoles.count = n;
    this.streetPoles.instanceMatrix.needsUpdate = true;
  }

  private buildFar(): void {
    const rnd = seeded(9);
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
    // The sky: night-black overhead, the city's glow along the horizon (and on down, the city under it) - drawn
    // first, behind everything (inside the camera's far plane).
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(2500, 32, 24),
      new THREE.ShaderMaterial({
        uniforms: { zenith: { value: new THREE.Color(SKY) }, horizon: { value: new THREE.Color(SKY_GLOW) }, glow: SKY_GLOW_STRENGTH },
        vertexShader: /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
        fragmentShader: /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform float glow;
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  // (a thin bright band low down, a broad faint one higher)
  float g = h > 0.0 ? 0.7 * exp(-h / 0.045) + 0.3 * exp(-h / 0.2) : exp(h / 0.2);
  gl_FragColor = vec4(zenith + horizon * glow * g, 1.0);
}`,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    sky.renderOrder = -1;
    this.far.add(sky);

    // The ground, five floors down: dark, into the night with the walls (its streets drawn over it) - drawn right
    // after the sky (nothing under the ground to hide).
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: { fogColor: { value: new THREE.Color(FOG) }, ground: { value: new THREE.Color(STREETS.ground) } },
        vertexShader: /* glsl */ `
varying float vDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
        fragmentShader: /* glsl */ `
uniform vec3 fogColor;
uniform vec3 ground;
varying float vDepth;
${CITY_FOG_GLSL}
void main() {
  gl_FragColor = vec4(mix(ground, fogColor, cityWallFog(vDepth)), 1.0);
}`,
        depthWrite: false,
        depthTest: false,
      }),
    );
    ground.position.y = GROUND_Y;
    ground.renderOrder = -0.9;
    this.far.add(ground);

    // The city on past the built one (SKYLINE): a ring of its silhouette round the player, some windows lit -
    // never a bare horizon where the near city leaves a gap. Drawn after the ground (over its far edge), before
    // everything nearer.
    const S = SKYLINE;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(S.radius, S.radius, S.height, 128, 1, true).translate(0, GROUND_Y + S.height / 2, 0),
      new THREE.ShaderMaterial({
        uniforms: { map: { value: skylineTexture() }, fogColor: { value: new THREE.Color(FOG) }, strength: WINDOWS.strength },
        vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
        fragmentShader: /* glsl */ `
uniform sampler2D map;
uniform vec3 fogColor;
uniform float strength;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(map, vec2(vUv.x * ${S.repeat.toFixed(1)}, vUv.y));
  gl_FragColor = vec4(fogColor + t.rgb * strength * ${S.windows.toFixed(2)}, t.a);
}`,
        side: THREE.BackSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        depthWrite: false,
        depthTest: false,
      }),
    );
    band.renderOrder = -0.85;
    this.far.add(band);
  }

  /**
   * Keep the scenery laid along the road around the player (`playerS` along it), and hand the real street lights
   * to the lamp pairs over our carriageway nearest ahead (one light per pair). Their pools of light fade out as
   * the real light fades in, so nothing pops.
   */
  update(playerS: number, play = 0): void {
    TRAFFIC_TIME.value += play; // (the city's traffic on the race time: still while paused)
    const stripS = Math.floor(playerS / STRIP_PERIOD) * STRIP_PERIOD;
    if (stripS !== this.laidS) this.layout(stripS);
    const cityS = Math.floor(playerS / CITY.period) * CITY.period;
    if (cityS !== this.cityS) this.layoutCity(cityS);
    if (stripS !== this.polesAt) this.layoutPoles(stripS);
    WINDOWS.strength.value = NIGHT.windows;
    WINDOWS.lit.value = NIGHT.windowsLit;
    SKY_GLOW_STRENGTH.value = NIGHT.skyGlow;
    STREET_STRENGTH.value = NIGHT.streetLights;
    WALL_GLOW.value = NIGHT.wallGlow;
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
