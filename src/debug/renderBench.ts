import type * as THREE from 'three';
import type { VehicleKind } from '../config';
import type { CarSelection } from '../game/carSelection';
import type { Game } from '../game/game';
import { laneCenter } from '../road/coords';
import type { TrafficWorld } from '../sim/trafficWorld';
import { CAR_COLORS, CONTAINER_COLORS, TRUCK_COLORS } from '../vehicles/models';
import type { PlayerCar } from '../vehicles/playerCar';

/**
 * Debug (dev builds: window.__renderBench): what one frame of the game costs to draw, on a picture that is the same
 * every time - the same race (Math.random and the traffic's random source seeded while it is set up), paused on its
 * grid, the cars put where the scene has them, the helicopter flown in, the police's lights on; the world still (no
 * physics, no AI): only drawing is timed. Its picture read back (`shot`) to compare versions pixel by pixel.
 *
 * Scenes: 'typical' - the grid as the race sets it up (its traffic as spawned), the police lit where they wait;
 * 'extreme' - every traffic model in every paint job (the containers in each box colour) lined up ahead, the rivals
 * and the police right in front.
 */
export interface BenchOptions {
  scene?: 'typical' | 'extreme';
  /** Frames timed (after `warm` untimed ones). */
  frames?: number;
  warm?: number;
  seed?: number;
  /** The picture read back (RGBA, bottom row first) as base64 too: large (the canvas' every pixel). */
  shot?: boolean;
}

export interface BenchResult {
  scene: string;
  size: [number, number];
  frames: number;
  /** ms the game's render takes (the HUD, the instancing, three's drawing, the post effects): median, mean, 90th. */
  render: { median: number; mean: number; p90: number };
  /** Draw calls and triangles a frame. */
  calls: number;
  triangles: number;
  programs: number;
  /** The picture's FNV-1a hash (equal pictures: equal hashes), and the picture itself when asked. */
  hash: string;
  pixels?: string;
}

/** The game's insides the bench reaches into (private there: a debug tool's licence). */
interface Inside {
  flow: { phase: string };
  freeze: boolean;
  frame(dt: number): void;
  starting: boolean;
  loadingRace: boolean;
  introOn: boolean;
  skipIntro(): void;
  toTitle(): void;
  startRace(cars: CarSelection, fromGarage: boolean): void;
  togglePause(): void;
  rng: () => number;
  trafficWorld: TrafficWorld;
  player: PlayerCar;
  rivals: { list: { car: PlayerCar }[] };
  police: { triggered: boolean; flashTime: number; list: { car: PlayerCar; state: string }[] } | null;
  rig: { snap(): void };
  helicopter: { update(play: number, on: boolean, targets: unknown[], player: boolean, place: unknown, camera: THREE.Camera): void } | null;
  heliPlace: unknown;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  render(play: number, alpha: number, draw?: boolean): void;
}

/** The race the bench sets up: fixed, whatever was last picked in the garage (not saved). */
const RACE: CarSelection = {
  player: 'street-racer',
  rivals: ['muscle-car', 'muscle-car', 'muscle-car', 'muscle-car', 'street-racer'],
  rivalMode: 'custom',
  difficulty: 3,
  weather: 'clear',
  course: 'highway',
  paint: {},
  tuning: {},
  police: true,
};

/** Where the player stands in the extreme scene (m down the road: on its straight start), its lane. */
const AT_S = 30;
const AT_LANE = 1;
/** The police's flashing held at a moment both halves of a bar are seen lit over a cycle (still while paused). */
const FLASH_AT = 0.05;
/** s the helicopter is flown in for (in steps of 1/60 s) before the frame is still. */
const HELI_IN = 12;

/** A seeded random source (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

async function until(test: () => boolean, ms: number): Promise<void> {
  const end = performance.now() + ms;
  while (!test()) {
    if (performance.now() > end) throw new Error('renderBench: timed out setting up');
    await sleep(50);
  }
}

/** The extreme scene: every traffic model and paint ahead of the player, the racers and police right in front. */
function stageExtreme(g: Inside): void {
  const tw = g.trafficWorld;
  tw.dispose(); // (the race's own traffic gone)
  const lane = (i: number) => i % 4;
  let row = AT_S + 9;
  // The rivals, then the police: two rows of four just ahead.
  const racers = [...g.rivals.list.map((r) => r.car), ...(g.police?.list.map((p) => p.car) ?? [])];
  racers.forEach((car, i) => car.resetAt(row + Math.floor(i / 4) * 8, laneCenter(lane(i)), 0));
  row += 2 * 8 + 4;
  // Every car paint job, four abreast; the trucks'; a container in each box colour (its cab's paint jobs in turn).
  const put = (kind: VehicleKind, n: number, gap: number, paint: (i: number) => number, color: (i: number) => number = () => 0) => {
    for (let i = 0; i < n; i++) tw.place(kind, row + Math.floor(i / 4) * gap, lane(i), paint(i), color(i));
    row += Math.ceil(n / 4) * gap;
  };
  put('car', CAR_COLORS.length, 8, (i) => i);
  put('truck', TRUCK_COLORS.length, 11, (i) => i);
  put('container', CONTAINER_COLORS.length, 22, (i) => i % TRUCK_COLORS.length, (i) => i);
  g.player.resetAt(AT_S, laneCenter(AT_LANE), 0);
}

/** The police's lights on (the chase on), held still mid-flash; the helicopter flown in over the player. */
function lightUp(g: Inside): void {
  const police = g.police;
  if (police) {
    police.triggered = true;
    for (const p of police.list) if (p.state === 'parked') p.state = 'behind';
    police.flashTime = FLASH_AT;
  }
  if (g.helicopter) {
    const pos = g.player.mesh.position;
    const targets = [{ s: g.player.s, d: g.player.d, pos }];
    for (let t = 0; t < HELI_IN; t += 1 / 60) g.helicopter.update(1 / 60, true, targets, false, g.heliPlace, g.camera);
  }
}

/** FNV-1a over the bytes. */
function fnv(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function renderBench(game: Game, opts: BenchOptions = {}): Promise<BenchResult> {
  const g = game as unknown as Inside;
  const scene = opts.scene ?? 'typical';
  const random = Math.random;
  Math.random = seeded(opts.seed ?? 1);
  const freeze = g.freeze;
  try {
    // The race set up anew from the title, the traffic's draws seeded too.
    if (g.flow.phase !== 'title') {
      g.toTitle();
      await until(() => g.flow.phase === 'title' && !g.starting, 20000);
    }
    g.rng = seeded((opts.seed ?? 1) + 1);
    // No physics on the way (the traffic would drive on, the cars rev on the grid, for however many frames it takes);
    // the intro skipped and the countdown paused at their first frames (the intro's smoke and tyre marks never begun).
    g.freeze = true;
    g.frame = function (this: Inside, dt: number) {
      if (!this.loadingRace && !this.starting) {
        if (this.flow.phase === 'intro' && this.introOn) this.skipIntro();
        if (this.flow.phase === 'countdown') this.togglePause();
      }
      Object.getPrototypeOf(this).frame.call(this, dt);
    };
    g.startRace({ ...RACE }, true);
    await until(() => g.flow.phase === 'paused', 60000); // (the world still: no physics, no AI - play 0, every animation held)
    if (scene === 'extreme') stageExtreme(g);
    else g.player.resetAt(g.player.s, g.player.d, 0);
    lightUp(g);
    g.rig.snap();
  } finally {
    Math.random = random;
    delete (g as Partial<Inside>).frame; // (the class's own again)
    g.freeze = freeze;
  }

  // Timed as the game draws them (its own loop, each frame's render).
  const r = g.renderer;
  const times: number[] = [];
  let calls = 0, triangles = 0, timing = false;
  const render = g.render;
  g.render = function (this: Inside, ...a: Parameters<Inside['render']>) {
    if (timing) r.info.reset();
    const t = performance.now();
    render.apply(this, a);
    if (timing) {
      times.push(performance.now() - t);
      calls += r.info.render.calls;
      triangles += r.info.render.triangles;
    }
  };
  const autoReset = r.info.autoReset;
  try {
    for (let i = 0; i < (opts.warm ?? 30); i++) await nextFrame();
    r.info.autoReset = false;
    timing = true;
    const n = opts.frames ?? 300;
    while (times.length < n) await nextFrame();
    timing = false;
  } finally {
    r.info.autoReset = autoReset;
    delete (g as Partial<Inside>).render; // (the class's own again)
  }

  // The picture, read right after the game has drawn it (before it is shown: the drawing buffer still there).
  const gl = r.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  await new Promise<void>((done) =>
    requestAnimationFrame(() => {
      r.setRenderTarget(null);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      done();
    }),
  );

  const sorted = [...times].sort((a, b) => a - b);
  const q = (f: number) => +sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))].toFixed(3);
  return {
    scene,
    size: [w, h],
    frames: times.length,
    render: { median: q(0.5), mean: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3), p90: q(0.9) },
    calls: +(calls / times.length).toFixed(1),
    triangles: Math.round(triangles / times.length),
    programs: r.info.programs?.length ?? 0,
    hash: fnv(px),
    pixels: opts.shot ? base64(px) : undefined,
  };
}
