import * as THREE from 'three';
import { type RotorBlur, rotorBlurMesh } from '../render/rotorBlur';
import { depthBias } from '../render/shadowBias';
import { HeliGlow } from '../render/heliGlow';

/**
 * The police helicopter's flight (scripted: no planner, it never touches anything):
 * - round the car it lights, loosely: an ellipse along the road `orbitAhead` +- `orbitLong` m from it (behind it some
 *   of the time, ahead the rest - the chase camera sees it there), `orbitSide` m to either side, once in about
 *   `orbitPeriod` s, its pace wandering (`wobble` of a turn, every `wobblePeriod` s); `height` +- `rise` m up;
 * - flown in from far behind and high (`arriveFrom` m along the road from its circling, `arriveRise` m over its
 *   height) over `arrive` s - catching up with the car at 200 km/h, coming down, over it into its circle ahead - its
 *   searchlight off till then, on over `lightOn` s: seen and heard first, then its light (from 350 m ahead over 6 s,
 *   the light on, at first: sudden);
 * - its car: the player first; every `targetEvery` s (+-25%; the first that long after its light comes on; after a
 *   switch that long once it is over the new car - nextPickIn: counted from the switch, it left far ones at once) another
 *   racer, any but the one it lights, each as likely (the player half the time, a rival only within 150 m of them,
 *   every 20 s: it seemed never to change); the player busted: the player. To a new car its light (its operator) swings over in `retarget` s, the helicopter
 *   (its pilot) follows in `reposition` s, longer to one further off - never pulling harder than `repositionAcc`
 *   m/s^2 (both in `retarget` s, it lurched 150 m in 2 s; in a fixed 8 s, 250 m back to the player, nose at its
 *   limit);
 * - flown as a helicopter flies (by its path, no physics): its nose along its way from `pathAbove` m/s, toward its
 *   car under `faceBelow` (slow, it circles sideways, watching it: heliHeading), turning to it over `turn` s;
 *   leaning the way it goes (nose down forward, side down sideways) `cruiseTilt` at `cruiseAt` m/s and on,
 *   `pitchPerAcc` more a m/s^2 speeding up (up slowing), banked `rollPerAcc` a m/s^2 into a turn - its motion
 *   smoothed over `smooth` s; never past `maxPitch`, `maxRoll`;
 * - its rotors heard as recorded (audio/rotor), drawn as a blur (MAIN_ROTOR, TAIL_ROTOR); its white strobe
 *   flashes `strobeOn` s every `strobeEvery` s.
 */
export const HELI = {
  height: 30,
  rise: 5,
  orbitAhead: 25,
  orbitLong: 70,
  orbitSide: 28,
  orbitPeriod: 45,
  wobble: 0.25, // (0.5: its pace past its turn's own, at times backwards - out 40-50 m ahead and back; under 17/45 never)
  wobblePeriod: 17,
  arrive: 14,
  arriveFrom: -450,
  arriveRise: 90,
  lightOn: 0.6,
  targetEvery: 10,
  retarget: 2,
  reposition: 3,
  repositionAcc: 25, // (5 in 8 s at least, then 10 in 5, 20 in 3: slow to its car - its light out of reach the while; leaning held to maxPitch/maxRoll)
  turn: 0.6,
  faceBelow: 60 / 3.6,
  pathAbove: 100 / 3.6,
  cruiseTilt: 0.12,
  cruiseAt: 60,
  pitchPerAcc: 0.02, // (0.03: the AI's braking and pulling away in traffic at its limit most of the time)
  rollPerAcc: 0.05,
  smooth: 0.35,
  maxPitch: 0.35,
  maxRoll: 0.5,
  strobeEvery: 1.1,
  strobeOn: 0.06,
};

/**
 * Its navigation lights' brightness (times their colour; unlit by the tone map): the red and green at its sides, the
 * white strobe - past the bloom's threshold (2.05, its luminance) as the police light bars (police FLASH).
 */
export const NAV_LIGHTS = { side: 12, strobe: 20 };

/**
 * Light on its body (render/heliGlow: against the night sky it was all but black): the city's glow from under it,
 * `city` colour (the road scene's warm rim light's) at `cityStrength` (irradiance, on what faces down); its
 * searchlight's pool lighting it back up - the road's `albedo` of the light on it over the pool's area
 * (BEAM.groundRadius), a lit surface facing up (its candela: albedo E r^2).
 */
export const HELI_GLOW = { city: 0xffb35c, cityStrength: 0.4, albedo: 0.25 };

/** Its searchlight's pool's light up (candela), its light `len` m down to it, `lit` its share on (0..1). See HELI_GLOW. */
export function poolBounce(len: number, lit: number): number {
  const onPool = (BEAM.light * Math.max(0, lit)) / Math.max(Math.pow(len, BEAM.decay), 0.01);
  return HELI_GLOW.albedo * onPool * BEAM.groundRadius * BEAM.groundRadius;
}

/**
 * Its rotors' blurred blades (render/rotorBlur): four each. The main rotor's blades 0.35 m wide on a 5.5 m radius,
 * a helicopter's rotor slow enough to see each blade - short trails, its tips still there; its pattern 9 rad/s
 * (at 30 fps 17 degrees a frame, of the 45 a turning-back look starts at). The tail rotor's 0.12 m on 0.65 m, a
 * blur more than blades.
 */
export const MAIN_ROTOR: RotorBlur = {
  blades: 4, radius: 5.5, bladeWidth: 0.064, rootSmear: 0.02, tipSmear: 0.1, smearCurve: 1.4,
  rootAlpha: 1, tipAlpha: 0.3, fadeCurve: 1.5, base: 0.08, baseCurve: 2, shade: 0.4, spin: 9,
};
export const TAIL_ROTOR: RotorBlur = {
  blades: 4, radius: 0.65, bladeWidth: 0.18, rootSmear: 0.05, tipSmear: 0.25, smearCurve: 1.4,
  rootAlpha: 0.9, tipAlpha: 0.2, fadeCurve: 1.5, base: 0.15, baseCurve: 2, shade: 0.4, spin: 14,
};

/**
 * Its searchlight: a cone `lampRadius` m across at the lamp, `groundRadius` at the lit car, lit air of `color`
 * (`density` a metre on its axis, summed in `steps` along a sight line; none within `near[0]` m of the camera, all
 * from `near[1]`); a real spot light (`light` candela, falling off by `decay`) lighting the ground there. Glare (a cross-flare
 * `glareSize` of the view high, `glareWide` times that across, and a veil of `veil` over the whole view) with the camera in the light - the cone
 * `glareWiden` times as wide, on to `glareBeyond` times its length past the car (the chase camera behind and over
 * the lit car) - and looking into the lamp: from `faceFrom` (the cosine of the angle off it) full at 1. Its light
 * shadowed (a `shadowMap` px map, `shadowNormalBias` m) by what is in the beam up to `shadowAbove` m over the lit
 * car (no traffic higher) to `shadowAfter` m past it (the car's own shadow on the road), its bias `shadowOffset` m
 * at the car (render/shadowBias: in depth, with the near plane 0.5 m from the lamp, half a metre and more - the
 * shadows came loose); the lit air in the beam shadowed by the same map (a truck's shadow cut out of the shaft, as
 * much of it as it blocks).
 */
export const BEAM = {
  lampRadius: 0.3,
  groundRadius: 3.5, // (5: the chase camera in the cone, the view hazed over by its far wall)
  density: 0.09,
  steps: 16,
  near: [4, 14] as const,
  color: 0xdfe8ff,
  light: 14000,
  decay: 1.6,
  glareSize: 0.14,
  glareWide: 2,
  veil: 0.17,
  glareWiden: 1.3,
  glareBeyond: 1.5,
  faceFrom: 0.8,
  shadowAbove: 5.5,
  shadowAfter: 3,
  shadowFarthest: 3,
  shadowMap: 512,
  shadowOffset: 0.02,
  shadowNormalBias: 0.02,
  maxTilt: Math.PI / 3, // (its circling 36-74 degrees off straight down, 55 the median: on its car ~60% of it)
};

/**
 * How far over to its car (`dx`, `dz` m across from the lamp, `drop` m below it) its light reaches (a share of the
 * way: 1 all of it): never more than `BEAM.maxTilt` off straight down (a car far off - just picked, the helicopter
 * on its way - lit on the ground short of it, the way to it, not along the ground from afar; on it once it is near).
 */
export function beamReach(dx: number, dz: number, drop: number): number {
  const across = Math.hypot(dx, dz);
  return across === 0 ? 1 : Math.min(1, (Math.max(0, drop) * Math.tan(BEAM.maxTilt)) / across);
}

/**
 * Where on the road it lights (`s` along, `d` across), over (`heliS`, `heliD`) with its car at (`carS`, `carD`), its
 * light reaching `reach` m across (BEAM.maxTilt at its height): the car; a car out of reach, on its lane, as near it
 * as it reaches - on the road, waiting for it (the user's call: short of it on the straight line to it, it lit the
 * city - itself over it, out to the side of its circle, the line to a car far off along the road); its lane out of
 * reach altogether (not flown so), the way to it.
 */
export function beamSpot(heliS: number, heliD: number, carS: number, carD: number, reach: number): { s: number; d: number } {
  const ds = carS - heliS, dd = carD - heliD;
  const across = Math.hypot(ds, dd);
  if (across <= reach) return { s: carS, d: carD };
  if (Math.abs(dd) < reach) return { s: heliS + Math.sign(ds) * Math.sqrt(reach * reach - dd * dd), d: carD };
  const k = reach / across;
  return { s: heliS + ds * k, d: heliD + dd * k };
}

/** A car's most along the road (m/s, on: 430 km/h) and back or across (spinning, sliding) between two frames. */
const DRIVEN = { on: 120, back: 30, across: 10, slack: 3, slackAcross: 2 };

/**
 * Whether its car moved by more than it could drive in `play` s (`ds` m along the road, `dd` across): put back
 * (a rival far off brought near the player - 200 m and more; a reset: back a little, a lane over). Then flown to as
 * to a new car (the user's call: it jumped with it).
 */
export function targetJumped(ds: number, dd: number, play: number): boolean {
  const t = Math.max(0, play);
  return ds > DRIVEN.on * t + DRIVEN.slack || ds < -(DRIVEN.back * t + DRIVEN.slack) || Math.abs(dd) > DRIVEN.across * t + DRIVEN.slackAcross;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};

/** Where it is `t` s into its flight: `ahead` m along the road from its car (-: behind), `side` m across (+: right). */
export function heliOrbit(t: number): { ahead: number; side: number } {
  const turn = (2 * Math.PI * t) / HELI.orbitPeriod + HELI.wobble * Math.sin((2 * Math.PI * t) / HELI.wobblePeriod);
  return { ahead: HELI.orbitAhead + HELI.orbitLong * Math.cos(turn), side: HELI.orbitSide * Math.sin(turn) };
}

/** How high over the road it is `t` s into its flight. */
export function heliHeight(t: number): number {
  return HELI.height + HELI.rise * (0.7 * Math.sin((2 * Math.PI * t) / 19) + 0.3 * Math.sin((2 * Math.PI * t) / 7.3 + 1));
}

/**
 * Its next car, on a `roll` (0..1): any of the `count` racers (0 the player) but the one it lights (`lit`), each as
 * likely - the player if alone.
 */
export function pickHeliTarget(count: number, lit: number, roll: number): number {
  if (count < 2) return 0;
  const k = Math.min(count - 2, Math.floor(roll * (count - 1)));
  return k < lit ? k : k + 1;
}

/**
 * How it hangs (rad; the rotation's x and z, the nose toward -z): speeding up `accFwd` m/s^2 along its nose (-:
 * slowing), pulled `accLat` m/s^2 to its right, going `vFwd` m/s along its nose (-: backwards) and `vLat` to its
 * right - leaning the way it goes (the cruise tilt: nose down going forward, its side down going sideways). See HELI.
 */
export function heliAttitude(accFwd: number, accLat: number, vFwd: number, vLat = 0): { pitch: number; roll: number } {
  const clamp = (x: number, m: number) => Math.max(-m, Math.min(m, x));
  const lean = (v: number) => HELI.cruiseTilt * clamp(v / HELI.cruiseAt, 1);
  return {
    pitch: clamp(-lean(vFwd) - accFwd * HELI.pitchPerAcc, HELI.maxPitch),
    roll: clamp(-lean(vLat) - accLat * HELI.rollPerAcc, HELI.maxRoll),
  };
}

/**
 * Where its nose is to point (rad, as its yaw): along its way (`path`) going `speed` m/s from `pathAbove` on; toward
 * the car it lights (`face`) under `faceBelow` (circling slowly with its side or nose to it, as one watching a car);
 * turned from the one to the other in between - the short way round.
 */
export function heliHeading(path: number, face: number, speed: number): number {
  const k = Math.max(0, Math.min(1, (speed - HELI.faceBelow) / (HELI.pathAbove - HELI.faceBelow)));
  return face + k * Math.atan2(Math.sin(path - face), Math.cos(path - face));
}

/** A car it may light: where it is along the road (`s`, `d`) and in the world. */
export interface HeliTarget {
  readonly s: number;
  readonly d: number;
  readonly pos: THREE.Vector3;
}

/** How much of the old car's offset is left (1..0), `since` s after a switch to a new car, gone over `over` s. */
export function switchFade(since: number, over: number): number {
  return since >= over ? 0 : 1 - smooth(since / over);
}

/**
 * How long its pilot takes (s) to fly over to a new car `distance` m off (its circling's centre): HELI.reposition at
 * least, longer as its smoothstep's hardest pull (6 distance / time^2) would pass HELI.repositionAcc.
 */
export function repositionTime(distance: number): number {
  return Math.max(HELI.reposition, Math.sqrt((6 * Math.abs(distance)) / HELI.repositionAcc));
}

/**
 * How long (s) till it picks its next car, as it swings over to one: its flight there (`flight` s: repositionTime)
 * and then its while over it, HELI.targetEvery +-25% by `roll` (0..1) - counted from the switch, a car far off was left
 * as soon as it got there, or before.
 */
export function nextPickIn(flight: number, roll: number): number {
  return flight + HELI.targetEvery * (0.75 + 0.5 * roll);
}

/** How much higher than its height it still is, `t` s after it set off to come (flying in). */
export function arrivalRise(t: number): number {
  return t >= HELI.arrive ? 0 : HELI.arriveRise * (1 - smooth(t / HELI.arrive));
}

/** Its searchlight's share of its light (0 off .. 1 on), `t` s after it set off to come: on once it is down. */
export function searchlight(t: number): number {
  return t <= HELI.arrive ? 0 : t >= HELI.arrive + HELI.lightOn ? 1 : smooth((t - HELI.arrive) / HELI.lightOn);
}

/** How much further along the road it still is (-: behind), `t` s after it set off to come (flying in). */
export function arrivalAhead(t: number): number {
  return t >= HELI.arrive ? 0 : HELI.arriveFrom * (1 - smooth(t / HELI.arrive));
}

/**
 * The glare's strength (0..1): the camera `axial` m down the beam from the lamp and `radial` m off its axis, the lit
 * car `length` m down it, the camera's view `facing` (the cosine of its angle off the lamp); counted on to `beyond`
 * times the beam's length (the flare: BEAM.glareBeyond; the veil: 1 - only in the beam, not the chase camera behind
 * the lit car, its whole view greyed). See BEAM.
 */
export function beamGlare(axial: number, radial: number, length: number, facing: number, beyond = BEAM.glareBeyond): number {
  if (axial <= 0 || axial > length * beyond) return 0;
  const r = (BEAM.lampRadius + ((BEAM.groundRadius - BEAM.lampRadius) * axial) / length) * BEAM.glareWiden;
  if (radial >= r) return 0;
  const t = radial / r;
  return (1 - t * t * t * t) * clamp01((facing - BEAM.faceFrom) / (1 - BEAM.faceFrom));
}

/**
 * Its light's shadow camera's near and far (m from the lamp, along the beam), the lit car `length` m down the beam and
 * `drop` m under the lamp, the cone `half` rad to its edge: from where the cone's high edge is BEAM.shadowAbove m over
 * the lit point (no traffic higher), to where its low edge meets the road (0.5 m under the lit point) - a low beam's
 * light reaches far past the car, its shadows long (to BEAM.shadowAfter m past the car first: cut off there); as
 * far as BEAM.shadowFarthest times the car's when that edge never meets the road. See BEAM.
 */
export function shadowSpan(length: number, drop: number, half: number): { near: number; far: number } {
  const e = Math.asin(Math.max(-1, Math.min(1, drop / length)));
  const high = e + half, low = e - half;
  const near = drop > BEAM.shadowAbove && high > 0 ? ((drop - BEAM.shadowAbove) / Math.sin(high)) * Math.cos(half) : 0;
  const ground = low > 0.02 ? ((drop + 0.5) / Math.sin(low)) * Math.cos(half) : Infinity;
  return {
    near: Math.max(0.5, Math.min(near, length - 1)),
    far: Math.min(length * BEAM.shadowFarthest, Math.max(length + BEAM.shadowAfter, ground + BEAM.shadowAfter)),
  };
}

/** The flare's light (linear, 0..): at (u, v) from its middle (-1..1 across the texture). See glareTexture. */
function flareLight(u: number, v: number): number {
  const r2 = u * u + v * v;
  const halo = 0.45 * Math.exp(-r2 / (0.4 * 0.4));
  const core = Math.exp(-r2 / (0.14 * 0.14));
  const ray = (along: number, across: number) => {
    const fade = Math.max(0, 1 - Math.abs(along));
    return 0.9 * Math.exp(-(across * across) / (0.03 * 0.03)) * fade * fade;
  };
  return halo + core + ray(u, v) + ray(v, u);
}

/**
 * A cross-flare (the browser only: the game makes the helicopter): a faint wide halo, a bright core, two thin rays
 * - every one a smooth falloff worked out per pixel (a canvas's gradients, straight between their stops, showed a
 * ring at each; rays drawn as bars, hard edges), stored sRGB-encoded (its dim fringe without bands).
 */
function glareTexture(size = 512): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const tint = [1, 0.985, 0.95];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const light = Math.min(1, flareLight(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1));
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) {
        const l = light * tint[k];
        img.data[i + k] = Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));
      }
      img.data[i + 3] = 255; // (added: its colour is its light)
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const UP = new THREE.Vector3(0, 1, 0);
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const DIR = new THREE.Vector3();
const TO_CAM = new THREE.Vector3();
const POOL = new THREE.Vector3();
const VIEW = new THREE.Vector3();
/** Where the lamp hangs, under its nose (the body's space: the nose toward -z). */
const LAMP_AT = new THREE.Vector3(0, -0.9, -2.2);
/** The lamp's face off and on. */
const LAMP_OFF = new THREE.Color(0x2a2d33);
const LAMP_ON = new THREE.Color(0xf2f6ff);

/**
 * The police helicopter (src/game/police.ts's chase; docs/superpowers/specs/2026-11-25-police-helicopter-design.md):
 * primitives the eye reads as one from far below, circling a racer (heliOrbit; pickHeliTarget), its searchlight on
 * them.
 * In the scene throughout, shown once the chase is on (its spot light kept: a light coming and going rebuilds every
 * material).
 */
export class Helicopter {
  private readonly object = new THREE.Group();
  private readonly rotor = new THREE.Group();
  private readonly tailRotor = new THREE.Group();
  /** The main rotor's blurred disc, the tail rotor's. */
  private readonly rotorDiscs: THREE.Mesh[] = [];
  private readonly strobe: THREE.Mesh;
  /** Its body's light from the city under it and its searchlight's pool (HELI_GLOW). */
  private readonly glow = new HeliGlow();
  /** The lamp's face (lit with the searchlight), and how much of the searchlight is on (searchlight: 0..1). */
  private readonly lampMat: THREE.MeshBasicMaterial;
  private lit = 0;
  private readonly beam: THREE.Mesh;
  private readonly glare: THREE.Sprite;
  private readonly veil: THREE.Mesh;
  private readonly light: THREE.SpotLight;
  private readonly lamp = new THREE.Vector3();
  private readonly disposables: { dispose(): void }[] = [];
  /** Its flight's clock (s, the race's time), and since it set off to come (-1: not yet). */
  private clock = 0;
  private since = -1;
  /** Its car (an index into update's targets: 0 the player), the next roll for one (s), since it last changed. */
  private target = 0;
  private nextPick = HELI.arrive + HELI.targetEvery;
  private sinceSwitch = HELI.reposition;
  /** How long its pilot takes to the car it last switched to (repositionTime). */
  private flightTime = HELI.reposition;
  /** The centre of its circling (along the road) and where its light is aimed; their offsets from a new car, fading. */
  private centreS = 0;
  private centreD = 0;
  private readonly centreOff = new THREE.Vector2();
  private readonly aim = new THREE.Vector3();
  /** Where on the road its light falls (beamSpot: s, d), and, swinging over to a new car, how far off it it was. */
  private aimS = 0;
  private aimD = 0;
  private aimOffS = 0;
  private aimOffD = 0;
  /** Its car last frame (-1: none) and where it was: put back since (targetJumped), flown to. */
  private lastTarget = -1;
  private lastS = 0;
  private lastD = 0;
  /** Its heading (rad, as a rotation about y: the nose toward -z) and acceleration (world, smoothed). */
  private yaw = 0;
  private readonly accel = new THREE.Vector3();
  /** Where it is and how it moves (world, smoothed): its rotor heard from there. */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Out and flying (the chase on). */
  flying = false;

  constructor(private readonly scene: THREE.Scene) {
    // (its body grey-white: dark, it was not to be seen against the night sky; its skids, mast and hub dark)
    const paint = new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.5, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.55, metalness: 0.3 });
    const glassy = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.15, metalness: 0.6 });
    for (const m of [paint, dark, glassy]) this.glow.patch(m);
    const lit = (hex: number) => new THREE.MeshBasicMaterial({ color: hex, toneMapped: false });
    const add = <T extends THREE.BufferGeometry>(g: T, m: THREE.Material, to: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      to.add(mesh);
      this.disposables.push(g);
      return mesh;
    };
    const body = new THREE.Group();
    // The cabin: a capsule lying along z, its nose (-z) glazed; the tail boom tapering back; the fin, the tail rotor.
    add(new THREE.CapsuleGeometry(1.15, 2.6, 6, 12).rotateX(Math.PI / 2), paint, body);
    add(new THREE.SphereGeometry(1.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), glassy, body, 0, 0.1, -1.6);
    add(new THREE.CylinderGeometry(0.22, 0.5, 5.2, 8).rotateX(Math.PI / 2), paint, body, 0, 0.35, 4.3);
    add(new THREE.BoxGeometry(0.12, 1.5, 0.9), paint, body, 0, 1.0, 6.7);
    this.tailRotor.position.set(0.25, 1.0, 6.8);
    this.tailRotor.rotation.y = Math.PI / 2; // (its disc across the boom: x its axis)
    body.add(this.tailRotor);
    // Skids.
    for (const x of [-0.95, 0.95]) {
      add(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6).rotateX(Math.PI / 2), dark, body, x, -1.55, 0);
      for (const z of [-0.8, 0.9]) add(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), dark, body, x * 0.85, -1.2, z);
    }
    // The main rotor: a mast, its hub, its blades turning (a blurred disc: render/rotorBlur).
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), dark, body, 0, 1.35, -0.2);
    add(new THREE.CylinderGeometry(0.28, 0.28, 0.14, 10), dark, body, 0, 1.6, -0.2);
    this.rotor.position.set(0, 1.6, -0.2);
    this.rotor.rotation.x = -Math.PI / 2; // (its disc level: y its axis)
    body.add(this.rotor);
    for (const [to, blur] of [[this.rotor, MAIN_ROTOR], [this.tailRotor, TAIL_ROTOR]] as const) {
      const disc = rotorBlurMesh(blur);
      to.add(disc);
      this.rotorDiscs.push(disc);
      this.disposables.push(disc.geometry, disc.material);
    }
    // Navigation lights: red to port (left), green to starboard, the white strobe under the tail - bright enough to
    // bloom (NAV_LIGHTS: at 1 they were dots of a pixel or two, under the bloom's threshold).
    const glow = (hex: number, k: number) => {
      const m = lit(hex);
      m.color.multiplyScalar(k);
      return m;
    };
    add(new THREE.SphereGeometry(0.12, 8, 6), glow(0xff2a20, NAV_LIGHTS.side), body, -1.1, 0, 0.2);
    add(new THREE.SphereGeometry(0.12, 8, 6), glow(0x20ff50, NAV_LIGHTS.side), body, 1.1, 0, 0.2);
    this.strobe = add(new THREE.SphereGeometry(0.16, 8, 6), glow(0xffffff, NAV_LIGHTS.strobe), body, 0, -0.1, 6.9);
    // The lamp itself (its face lit with it: update).
    this.lampMat = lit(0x2a2d33);
    add(new THREE.CylinderGeometry(0.25, 0.3, 0.35, 10), this.lampMat, body, LAMP_AT.x, LAMP_AT.y, LAMP_AT.z);
    this.object.add(body);
    this.disposables.push(paint, dark, glassy);

    // The beam: lit air in a cone from the lamp to the lit car, added (black is no light). Each pixel as bright as
    // the light its sight line goes through: where that line is in the cone (worked out exactly: a cone, cut at the
    // lamp and the car), summed in `BEAM.steps` steps - the light thickest on its axis, none at its edge (soft, no
    // hard rim), thinning down it (the spot on the ground the real light's), none near the camera (`near`). Seen
    // along it (the chase camera behind the lit car) a bright shaft; from the side, a soft one. (A thin-walled cone
    // drawn translucent instead: from behind the car its open end a dome over the view; its walls faded by how they
    // faced the camera, nothing - seen along the beam, every wall is side-on.) Drawn on the bounding cone's far side:
    // once a pixel, its sight line ending there (or at what is in front).
    const cone = new THREE.CylinderGeometry(BEAM.groundRadius * 1.06, BEAM.lampRadius * 1.06, 1, 32, 1, false).translate(0, 0.5, 0);
    const beamMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform vec3 color;
        uniform float density;
        uniform vec2 near;
        uniform vec3 lamp;
        uniform vec3 axis;
        uniform float len;
        uniform vec2 radii;
        uniform sampler2DShadow beamShadow;
        uniform mat4 beamShadowMatrix;
        uniform float beamShadowOn;
        uniform float beamShadowBias;
        uniform float beamShadowFrom;
        // (lit at a point of the beam, a m down it: 1, or 0 in a shadow of its light's map - what is between it and
        // the lamp; above where traffic can be, none: not looked up - most of the shaft, half its cost)
        float litAt(vec3 world, float a) {
          if (beamShadowOn < 0.5 || a < beamShadowFrom) return 1.0;
          vec4 c = beamShadowMatrix * vec4(world, 1.0);
          c.xyz /= c.w;
          if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
          return texture(beamShadow, vec3(c.xy, c.z + beamShadowBias));
        }
        varying vec3 vWorld;
        const int STEPS = ${BEAM.steps};
        void main() {
          vec3 o = cameraPosition;
          vec3 toEnd = vWorld - o;
          float tEnd = length(toEnd);
          vec3 d = toEnd / tEnd;
          vec3 w = o - lamp;
          float da = dot(d, axis);
          float oa = dot(w, axis);
          // Between the lamp (a = 0) and the car (a = len).
          float t0 = 0.0, t1 = tEnd;
          if (abs(da) > 1e-5) {
            float ta = -oa / da, tb = (len - oa) / da;
            t0 = max(t0, min(ta, tb));
            t1 = min(t1, max(ta, tb));
          } else if (oa < 0.0 || oa > len) discard;
          // In the cone: radius r0 + k a = k (a - aV), its apex aV behind the lamp. f(t) = A t^2 + B t + C <= 0.
          float k = (radii.y - radii.x) / len;
          float aV = -radii.x / k;
          float k2 = k * k;
          float A = 1.0 - da * da - k2 * da * da;
          float B = 2.0 * (dot(w, d) - oa * da - k2 * (oa - aV) * da);
          float C = dot(w, w) - oa * oa - k2 * (oa - aV) * (oa - aV);
          float disc = B * B - 4.0 * A * C;
          if (disc < 0.0) { if (A > 0.0) discard; }
          else {
            float q = sqrt(disc);
            float r1 = (-B - q) / (2.0 * A), r2 = (-B + q) / (2.0 * A);
            float lo = min(r1, r2), hi = max(r1, r2);
            if (A > 0.0) { t0 = max(t0, lo); t1 = min(t1, hi); }
            else {
              // (outside the roots: one side the other nappe, cut off by the lamp's end - keep the longer)
              float s0 = t0, s1 = min(t1, lo), u0 = max(t0, hi), u1 = t1;
              if (s1 - s0 >= u1 - u0) { t0 = s0; t1 = s1; } else { t0 = u0; t1 = u1; }
            }
          }
          if (t1 <= t0) discard;
          float dt = (t1 - t0) / float(STEPS);
          float sum = 0.0;
          for (int i = 0; i < STEPS; i++) {
            float t = t0 + (float(i) + 0.5) * dt;
            vec3 p = w + d * t;
            float a = dot(p, axis);
            float r = length(p - axis * a) / (radii.x + k * a);
            float soft = clamp(1.0 - r * r, 0.0, 1.0);
            sum += soft * soft * mix(1.0, 0.3, a / len) * smoothstep(near.x, near.y, t) * litAt(lamp + p, a);
          }
          float light = 1.0 - exp(-density * sum * dt);
          gl_FragColor = vec4(color * light, 1.0);
        }`,
      uniforms: {
        color: { value: new THREE.Color(BEAM.color) },
        density: { value: BEAM.density },
        near: { value: new THREE.Vector2(BEAM.near[0], BEAM.near[1]) },
        lamp: { value: new THREE.Vector3() },
        axis: { value: new THREE.Vector3(0, -1, 0) },
        len: { value: 1 },
        radii: { value: new THREE.Vector2(BEAM.lampRadius, BEAM.groundRadius) },
        beamShadow: { value: null as THREE.Texture | null },
        beamShadowMatrix: { value: new THREE.Matrix4() },
        beamShadowOn: { value: 0 },
        beamShadowBias: { value: 0 },
        beamShadowFrom: { value: 0 },
      },
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.BackSide,
    });
    this.beam = new THREE.Mesh(cone, beamMat);
    this.beam.frustumCulled = false; // (scaled each frame: its bounds are the unit cone's)
    this.disposables.push(cone, beamMat);
    // The glare: on the lamp, the camera's phenomenon (no depth test: over the body too).
    const tex = glareTexture();
    const glareMat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
    this.glare = new THREE.Sprite(glareMat);
    this.glare.renderOrder = 999;
    this.disposables.push(tex, glareMat);
    // The veil: two triangles over the whole view (clip space: no camera), added, drawn last.
    const veilGeo = new THREE.BufferGeometry();
    veilGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    const veilMat = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float strength; void main() { gl_FragColor = vec4(color * strength, 1.0); }',
      uniforms: { color: { value: new THREE.Color(BEAM.color) }, strength: { value: 0 } },
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    });
    this.veil = new THREE.Mesh(veilGeo, veilMat);
    this.veil.frustumCulled = false;
    this.veil.renderOrder = 1000;
    this.disposables.push(veilGeo, veilMat);
    this.light = new THREE.SpotLight(BEAM.color, 0, 0, 0.12, 0.45, BEAM.decay);
    // Shadowed throughout (a shadowed light coming and going recompiles every lit material), its map drawn only
    // while it flies (shadow.autoUpdate) - of what is in its narrow cone (render/bodyInstances: the traffic only
    // where a shadowed light's frustum reaches; see shadowLight).
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(BEAM.shadowMap, BEAM.shadowMap);
    this.light.shadow.normalBias = BEAM.shadowNormalBias;
    this.light.shadow.autoUpdate = false;
    scene.add(this.object, this.beam, this.glare, this.veil, this.light, this.light.target);
    this.hide();
  }

  /** A race's start: not out yet. */
  reset(): void {
    this.clock = 0;
    this.since = -1;
    this.flying = false;
    this.lit = 0;
    this.target = 0;
    this.nextPick = HELI.arrive + HELI.targetEvery;
    this.sinceSwitch = HELI.reposition;
    this.centreOff.set(0, 0);
    this.aimOffS = this.aimOffD = 0;
    this.lastTarget = -1;
    this.hide();
  }

  private hide(): void {
    this.object.visible = this.beam.visible = this.glare.visible = this.veil.visible = false;
    this.light.intensity = 0;
    this.light.shadow.autoUpdate = false;
  }

  /** Its searchlight while it flies (a light whose shadow shows: the game's shadowLights), else null. */
  get shadowLight(): THREE.SpotLight | null {
    return this.flying && this.lit > 0 ? this.light : null;
  }

  /** Its car now: `targets[i]` (0 the player), another when due; the player's only when `player`. */
  private choose(play: number, targets: readonly HeliTarget[], player: boolean): void {
    if (this.target >= targets.length) this.target = 0;
    this.nextPick -= play;
    let next = this.target;
    if (player) next = 0;
    else if (this.nextPick <= 0) {
      next = pickHeliTarget(targets.length, this.target, Math.random());
      this.nextPick = nextPickIn(0, Math.random()); // (alone: the same car - again after a while)
    }
    if (next === this.target) return;
    this.flyOver(targets[next]);
    // (its while over it from when it is there - the busted player's too)
    this.nextPick = nextPickIn(this.flightTime, Math.random());
    this.target = next;
  }

  /**
   * Swinging over to `to` (a new car, or its own put back - targetJumped): from where it was (its centre, its light)
   * to the car's, as offsets from that car fading out.
   */
  private flyOver(to: HeliTarget): void {
    this.centreOff.set(this.centreS - to.s, this.centreD - to.d);
    // (along the road, not straight across: on a bend that cut across its inside, off the road)
    this.aimOffS = this.aimS - to.s;
    this.aimOffD = this.aimD - to.d;
    this.flightTime = repositionTime(Math.hypot(this.centreOff.x, this.centreOff.y));
    this.sinceSwitch = 0;
  }

  /**
   * Its car put back since the last frame (a rival far off brought near the player, a reset: targetJumped): flown
   * to as to a new car, its while over it from when it is there - not jumping with it.
   */
  private follow(play: number, car: HeliTarget): void {
    if (this.target === this.lastTarget && targetJumped(car.s - this.lastS, car.d - this.lastD, play)) {
      this.flyOver(car);
      this.nextPick = Math.max(this.nextPick, nextPickIn(this.flightTime, Math.random()));
    }
    this.lastTarget = this.target;
    this.lastS = car.s;
    this.lastD = car.d;
  }

  /**
   * A frame: `play` s of the race's time on; `on` the chase (it sets off the first time); the cars it may light
   * (`targets`, 0 the player; `player`: the player's only - busted), along the road: `place(s, d, out)` the road's
   * point at `s`, `d` (its height the player's); the glare by `camera` (placed for this frame).
   */
  update(play: number, on: boolean, targets: readonly HeliTarget[], player: boolean, place: (s: number, d: number, out: THREE.Vector3) => THREE.Vector3, camera: THREE.Camera): void {
    if (on && this.since < 0) this.since = 0;
    if (this.since < 0 || !targets.length) return;
    this.clock += play;
    this.since += play;
    this.sinceSwitch += play;
    this.choose(play, targets, player);
    const car = targets[this.target];
    this.follow(play, car);
    // (its pilot slower to a new car than its light's operator)
    const flight = switchFade(this.sinceSwitch, this.flightTime);
    this.centreS = car.s + this.centreOff.x * flight;
    this.centreD = car.d + this.centreOff.y * flight;
    const t = this.clock;
    // (its circle's start as it comes down: ahead of the car, in the chase camera's view, as its light comes on)
    const o = heliOrbit(t - HELI.arrive);
    const heliS = this.centreS + o.ahead + arrivalAhead(this.since), heliD = this.centreD + o.side;
    place(heliS, heliD, A);
    const prev = B.copy(this.position);
    this.position.set(A.x, A.y + heliHeight(t) + arrivalRise(this.since), A.z);
    // Its motion (smoothed: the cars' shakes not in it), and how it hangs by it.
    if (!this.flying) {
      this.velocity.set(0, 0, 0);
      this.accel.set(0, 0, 0);
    } else if (play > 0) {
      const k = 1 - Math.exp(-play / HELI.smooth);
      const v = TO_CAM.copy(this.position).sub(prev).divideScalar(play);
      const was = DIR.copy(this.velocity);
      this.velocity.lerp(v, k);
      this.accel.lerp(was.subVectors(this.velocity, was).divideScalar(play), k);
    }
    this.flying = true;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    // (its nose along its way fast, toward its car slow - heliHeading; hardly moving: no way to go along; right over
    // the car: none to face)
    const path = speed > 3 ? Math.atan2(-this.velocity.x, -this.velocity.z) : this.yaw;
    const toX = car.pos.x - this.position.x, toZ = car.pos.z - this.position.z;
    const face = Math.hypot(toX, toZ) > 5 ? Math.atan2(-toX, -toZ) : path;
    let turn = heliHeading(path, face, speed) - this.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.yaw += turn * (1 - Math.exp(-play / HELI.turn));
    // (along its nose and to its right: its acceleration and its way, sideways too)
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const fwd = (x: number, z: number) => -x * sin - z * cos, right = (x: number, z: number) => x * cos - z * sin;
    const att = heliAttitude(fwd(this.accel.x, this.accel.z), right(this.accel.x, this.accel.z), fwd(this.velocity.x, this.velocity.z), right(this.velocity.x, this.velocity.z));
    this.object.position.copy(this.position);
    this.object.rotation.set(att.pitch, this.yaw, att.roll, 'YXZ');
    // (the blur's pattern at its own pace, not the rotor's: render/rotorBlur)
    this.rotorDiscs[0].rotation.z = (this.rotorDiscs[0].rotation.z + play * MAIN_ROTOR.spin) % (2 * Math.PI);
    this.rotorDiscs[1].rotation.z = (this.rotorDiscs[1].rotation.z + play * TAIL_ROTOR.spin) % (2 * Math.PI);
    this.strobe.visible = t % HELI.strobeEvery < HELI.strobeOn;
    this.object.visible = true;
    // The beam, from the lamp to the car (a little off it: a hand on the lamp, not a servo; swinging over to a new one).
    this.object.updateMatrixWorld();
    this.lamp.copy(LAMP_AT).applyMatrix4(this.object.matrixWorld);
    // (on the road: swinging over along it; a car out of reach - BEAM.maxTilt - waited for on its lane: beamSpot)
    const fade = switchFade(this.sinceSwitch, HELI.retarget);
    const wantS = car.s + this.aimOffS * fade, wantD = car.d + this.aimOffD * fade;
    const across = Math.max(0, this.lamp.y - car.pos.y) * Math.tan(BEAM.maxTilt);
    const spot = beamSpot(heliS, heliD, wantS, wantD, across);
    this.aimS = spot.s;
    this.aimD = spot.d;
    if (spot.s === car.s && spot.d === car.d) this.aim.copy(car.pos);
    else {
      place(spot.s, spot.d, this.aim);
      this.aim.y = car.pos.y;
    }
    // (its hand's wander: 1.2 / 1.6 m at 2.6 / 1.6 rad/s - 0.6 / 0.8 m at 1.3 / 0.8 at first, too steady)
    DIR.set(this.aim.x + 1.2 * Math.sin(t * 2.6), this.aim.y, this.aim.z + 1.6 * Math.sin(t * 1.6 + 1)).sub(this.lamp);
    // (no further over than BEAM.maxTilt, its hand's wander too - the lamp not quite where the helicopter is: beamReach)
    const reach = beamReach(DIR.x, DIR.z, -DIR.y);
    DIR.x *= reach;
    DIR.z *= reach;
    const len = DIR.length();
    DIR.divideScalar(len);
    this.beam.position.copy(this.lamp);
    this.beam.quaternion.setFromUnitVectors(UP, DIR);
    this.beam.scale.set(1, len, 1);
    const u = (this.beam.material as THREE.ShaderMaterial).uniforms;
    u.lamp.value.copy(this.lamp);
    u.axis.value.copy(DIR);
    u.len.value = len;
    // (off coming in, on once it is down: the lamp, its light, the lit air, its glare, its shadow all by it)
    const lit = (this.lit = searchlight(this.since));
    this.lampMat.color.lerpColors(LAMP_OFF, LAMP_ON, lit);
    u.density.value = BEAM.density * lit;
    this.beam.visible = lit > 0;
    this.light.position.copy(this.lamp);
    this.light.target.position.copy(this.lamp).addScaledVector(DIR, len);
    this.light.angle = Math.atan((BEAM.groundRadius * 1.1) / len);
    this.light.intensity = BEAM.light * lit;
    // (its body lit from under it: the city's glow, the pool of its light - HELI_GLOW)
    this.glow.set(HELI_GLOW.city, HELI_GLOW.cityStrength, POOL.copy(this.lamp).addScaledVector(DIR, len), BEAM.color, poolBounce(len, lit), BEAM.decay);
    // Its shadow: over the stretch where traffic can be in the beam (shadowSpan); the lit air in the beam by it too.
    const span = shadowSpan(len, this.lamp.y - this.aim.y, this.light.angle);
    const sc = this.light.shadow.camera;
    if (sc.near !== span.near || sc.far !== span.far) {
      sc.near = span.near;
      sc.far = span.far;
      sc.updateProjectionMatrix();
    }
    this.light.shadow.bias = -depthBias(BEAM.shadowOffset, len, span.near, span.far);
    u.beamShadowBias.value = this.light.shadow.bias;
    this.light.shadow.autoUpdate = lit > 0;
    const map = this.light.shadow.map?.depthTexture ?? null;
    u.beamShadow.value = map;
    u.beamShadowMatrix.value = this.light.shadow.matrix; // (made with the map, before the beam is drawn)
    u.beamShadowOn.value = map ? 1 : 0;
    u.beamShadowFrom.value = span.near; // (its map's own start: nothing nearer the lamp is in it)
    // The glare and the veil: the camera in the light, looking into the lamp.
    TO_CAM.copy(camera.position).sub(this.lamp);
    const dist = TO_CAM.length();
    const axial = DIR.dot(TO_CAM);
    const radial = Math.sqrt(Math.max(0, dist * dist - axial * axial));
    camera.getWorldDirection(VIEW);
    const facing = -VIEW.dot(TO_CAM) / Math.max(1e-6, dist);
    const g = beamGlare(axial, radial, len, facing) * lit;
    this.glare.visible = g > 0;
    if (g > 0) {
      this.glare.position.copy(this.lamp);
      const size = dist * BEAM.glareSize;
      this.glare.scale.set(size * BEAM.glareWide, size, 1);
      this.glare.material.opacity = g;
    }
    const v = beamGlare(axial, radial, len, facing, 1) * lit;
    this.veil.visible = v > 0;
    (this.veil.material as THREE.ShaderMaterial).uniforms.strength.value = BEAM.veil * v;
  }

  dispose(): void {
    this.scene.remove(this.object, this.beam, this.glare, this.veil, this.light, this.light.target);
    this.light.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
