import * as THREE from 'three';

/** Half angle of the headlight's projection (rad). */
export const HALF_ANGLE = 0.75;
/** Fraction of the cone over which the spot light's edge fades out. */
export const PENUMBRA = 0.35;
/** How far the beam's axis is aimed below horizontal (rad). */
export const AIM_DOWN = THREE.MathUtils.degToRad(3);

const TAN_HALF = Math.tan(HALF_ANGLE);
/** Cut-off line, in tangent units of the light's projection (just below the horizon). */
const CUT_V = Math.tan(AIM_DOWN) - Math.tan(THREE.MathUtils.degToRad(0.6));
const KINK = Math.tan(THREE.MathUtils.degToRad(15));
const KINK_RISE = Math.tan(THREE.MathUtils.degToRad(2));
const EDGE = 0.018; // softness of the cut-off
const SPREAD = 0.75 * TAN_HALF;
const FALL = 0.45 * TAN_HALF;

/**
 * Low-beam pattern: relative intensity (0..1) toward direction (u, v), given
 * as tangents in the light's projection (u = right, v = up, axis = 0,0).
 * A sharp horizontal cut-off just below the horizon (so it lights the road,
 * not the car in front's whole body or oncoming drivers), the right-hand 15°
 * step-up of right-hand-traffic beams, a wide horizontal spread and a gentle
 * fade toward the car.
 */
export function lowBeamPattern(u: number, v: number): number {
  const cut = u > 0 ? CUT_V + Math.min(u * KINK, KINK_RISE) : CUT_V;
  const below = cut - v;
  const edge = Math.min(1, Math.max(0, below / EDGE));
  const spread = Math.exp(-(((u - 0.073) / SPREAD) ** 2));
  const fall = 0.3 + 0.7 * Math.exp(-(((below - 0.058) / FALL) ** 2));
  return edge * spread * fall;
}

/** The pattern as the spot light's cookie. Canvas top = up in the light's view, left = car's left. */
export function lowBeamCookie(size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const half = size / 2;
  const pxPerTan = half / TAN_HALF;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round(255 * lowBeamPattern((x - half) / pxPerTan, (half - y) / pxPerTan));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/**
 * One low-beam headlamp: a spot light with the low-beam cookie (the player has two).
 * (Three.js only applies light cookies to shadow-casting lights, so it casts
 * shadows too - the car ahead throws a shadow into your beam.)
 */
export function createHeadlight(intensity: number): THREE.SpotLight {
  const l = new THREE.SpotLight(0xfff4e6, intensity, 120, HALF_ANGLE, PENUMBRA, 1.0);
  l.map = lowBeamCookie();
  l.castShadow = true;
  l.shadow.mapSize.set(1024, 1024);
  l.shadow.camera.near = 0.3;
  l.shadow.camera.far = 120;
  l.shadow.bias = -0.0004;
  l.shadow.normalBias = 0.02;
  return l;
}

/** Lamp height the ground-light texture is computed for; other heights scale the decal. */
export const BEAM_LAMP_H = 0.7;
/** Ground area the texture covers (m, at BEAM_LAMP_H), measured from the lamps forward. */
export const BEAM_GROUND_W = 32;
export const BEAM_GROUND_L = 64;

/**
 * What a pair of the same low-beam lamps (BEAM_LAMP_H up, `halfSpacing` either
 * side of centre) paints on flat ground: illuminance = pattern · spot fade ·
 * h / d² (decay-1 falloff times the incidence cosine), as for the player's
 * real lights. NPC headlights light the road with it (render/npcBeams), so
 * their beams have the same shape as yours without costing real lights.
 * Texture bottom = at the lamps, top = BEAM_GROUND_L ahead.
 */
export function lowBeamGroundTexture(halfSpacing = 0.55, w = 256, h = 512): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const lampH = BEAM_LAMP_H;
  const sa = Math.sin(AIM_DOWN);
  const ca = Math.cos(AIM_DOWN);
  // The cone's edge, a little wider than the real light's: right in front of the
  // lamps it falls on the ground within a texel or two and would look jagged.
  const cosOuter = Math.cos(HALF_ANGLE + 0.1);
  const cosInner = Math.cos(HALF_ANGLE * (1 - PENUMBRA) - 0.1);
  const illum = (x: number, z: number): number => {
    let e = 0;
    for (const lx of [-halfSpacing, halfSpacing]) {
      const dx = x - lx;
      const d2 = dx * dx + lampH * lampH + z * z;
      const d = Math.sqrt(d2);
      const f = lampH * sa + z * ca; // along the beam axis
      if (f <= 0) continue;
      const up = -lampH * ca + z * sa;
      const fade = THREE.MathUtils.smoothstep(f / d, cosOuter, cosInner);
      e += lowBeamPattern(dx / f, up / f) * fade * lampH / d2;
    }
    return e;
  };
  // Irradiance relative to ~8 m ahead, rolling off softly (no hard-edged plateau) near the car.
  const ref = illum(0, 8);
  for (let y = 0; y < h; y++) {
    const z = (1 - (y + 0.5) / h) * BEAM_GROUND_L;
    for (let x = 0; x < w; x++) {
      const gx = ((x + 0.5) / w - 0.5) * BEAM_GROUND_W;
      // Fade out toward the decal's sides and far end so its border never shows.
      const win =
        THREE.MathUtils.smoothstep(BEAM_GROUND_W / 2 - Math.abs(gx), 0, BEAM_GROUND_W * 0.2) *
        THREE.MathUtils.smoothstep(BEAM_GROUND_L - z, 0, BEAM_GROUND_L * 0.25);
      const lin = (1 - Math.exp(-0.5 * illum(gx, z) / ref)) * win;
      // Stored sRGB-encoded (and decoded by the GPU) for precision in the dim far end.
      const s = lin <= 0.0031308 ? 12.92 * lin : 1.055 * lin ** (1 / 2.4) - 0.055;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * s);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
