import * as THREE from 'three';

/** Half angle of the headlight's projection (rad). */
const HALF_ANGLE = 0.75;
/** How far the beam's axis is aimed below horizontal (rad). */
export const AIM_DOWN = THREE.MathUtils.degToRad(3);

/**
 * Low-beam pattern used as the spot light's cookie: a sharp horizontal cut-off
 * just below the horizon (so it lights the road, not the car in front's whole
 * body or oncoming drivers), the right-hand 15° step-up of right-hand-traffic
 * beams, a wide horizontal spread and a gentle fade toward the car.
 * Canvas top = up in the light's view, left = car's left.
 */
export function lowBeamCookie(size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const half = size / 2;
  // Pixels per radian near the centre of the projection.
  const pxPerTan = half / Math.tan(HALF_ANGLE);
  const horizonY = half - Math.tan(AIM_DOWN) * pxPerTan; // horizon sits above centre
  const cutY = horizonY + Math.tan(THREE.MathUtils.degToRad(0.6)) * pxPerTan; // cut-off just below it
  const kink = Math.tan(THREE.MathUtils.degToRad(15));
  const kinkRise = Math.tan(THREE.MathUtils.degToRad(2)) * pxPerTan;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - half;
      // Cut-off line, stepping up on the right (toward the kerb).
      const cut = dx > 0 ? cutY - Math.min(dx * kink, kinkRise) : cutY;
      const below = y - cut;
      const edge = Math.min(1, Math.max(0, below / 2.5)); // ~2 px soft edge
      const spread = Math.exp(-(((dx - 10) / (half * 0.75)) ** 2));
      const fall = 0.3 + 0.7 * Math.exp(-(((below - 8) / (half * 0.45)) ** 2));
      const v = Math.round(255 * edge * spread * fall);
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
  const l = new THREE.SpotLight(0xfff4e6, intensity, 120, HALF_ANGLE, 0.35, 1.0);
  l.map = lowBeamCookie();
  l.castShadow = true;
  l.shadow.mapSize.set(1024, 1024);
  l.shadow.camera.near = 0.3;
  l.shadow.camera.far = 120;
  l.shadow.bias = -0.0004;
  l.shadow.normalBias = 0.02;
  return l;
}
