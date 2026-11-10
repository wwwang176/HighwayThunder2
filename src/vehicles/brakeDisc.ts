import * as THREE from 'three';

/**
 * The cars' brake discs slotted, drawn on at load (the files' discs are plain: tools/models/rims/make_rims.py): thin
 * straight dark lines across the friction ring (each off the centre, pointed at both ends), its face faintly
 * fine-turned, the hat in the middle darker - one colour map on uvs laid flat across the disc's face, no extra
 * triangles. The disc is the file's wheel's `wheel_brake` (a cylinder along x): its two faces take the pattern (the
 * inner one mirrored), its edge the ring's outer rim.
 */

/** The map, px (the disc's radius to its edge). */
const S = 512;
/**
 * The slots (of the radius): how many; each along a line passing the centre by `pass`, from radius `from` out to
 * `to`; at its widest (its middle; px: thin, about 3 mm).
 */
const SLOTS = { n: 8, pass: 0.6, from: 0.64, to: 0.965, width: 4 };
/** The hat (the bell the wheel bolts to) out to this, of the radius. */
const HAT = 0.56;
/** The colour (times the material's steel): the slots, the hat; the turning's rings +- this on the ring. */
const SHADE = { slot: 0.3, hat: 0.68, rings: 0.04 };

/** A point on the disc's face (y, z; its radius `r`) as its uv: the disc across the map. */
export function discUv(y: number, z: number, r: number): [number, number] {
  return [0.5 + (0.5 * y) / r, 0.5 + (0.5 * z) / r];
}

/**
 * Slot `i`'s ends (of the radius, the disc's centre at 0): on the line touching the circle of radius `pass` at
 * angle 2 pi i / n, from where it is `from` out from the centre to where it is `to`.
 */
export function slotEnds(i: number): [[number, number], [number, number]] {
  const a = (2 * Math.PI * i) / SLOTS.n;
  const at = (r: number): [number, number] => {
    const s = Math.sqrt(r * r - SLOTS.pass * SLOTS.pass);
    return [SLOTS.pass * Math.cos(a) - s * Math.sin(a), SLOTS.pass * Math.sin(a) + s * Math.cos(a)];
  };
  return [at(SLOTS.from), at(SLOTS.to)];
}

/** The slots, in black (at the context's alpha): each straight, pointed at both ends. */
function drawSlots(g: CanvasRenderingContext2D) {
  const c = S / 2;
  g.fillStyle = '#000';
  for (let i = 0; i < SLOTS.n; i++) {
    const [[x0, y0], [x1, y1]] = slotEnds(i);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len; // across it
    // its width along it a flattened arch: widest in the middle, to a point at each end
    const edge = (k: number, sgn: number): [number, number] => {
      const t = k / 16, w = ((sgn * SLOTS.width) / 2 / c) * Math.pow(Math.sin(Math.PI * t), 0.5);
      return [c + c * (x0 + (x1 - x0) * t + nx * w), c + c * (y0 + (y1 - y0) * t + ny * w)];
    };
    g.beginPath();
    for (let k = 0; k <= 16; k++) g.lineTo(...edge(k, 1));
    for (let k = 16; k >= 0; k--) g.lineTo(...edge(k, -1));
    g.closePath();
    g.fill();
  }
}

let map: THREE.Texture | null = null;

/** The disc's colour map (made once, shared by every car's discs). */
function discMap(anisotropy: number): THREE.Texture {
  if (map) return map;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(S, S);
  // the face: the hat, the ring faintly fine-turned (a fixed ripple by radius: the same every load)
  const rings = (rho: number) => 0.5 * Math.sin(rho * 410) + 0.3 * Math.sin(rho * 173 + 1.3) + 0.2 * Math.sin(rho * 61 + 0.4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const rho = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
      const v = Math.round(255 * Math.pow(rho < HAT ? SHADE.hat : 1 - SHADE.rings + SHADE.rings * rings(rho), 1 / 2.2));
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  // the slots, dark lines over it
  g.globalAlpha = 1 - SHADE.slot;
  drawSlots(g);
  map = new THREE.CanvasTexture(cv);
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = anisotropy;
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/** A file's wheel: its brake disc (material `wheel_brake`) slotted (uvs, the colour map). */
export function addDiscSlots(wheel: THREE.Object3D, anisotropy = 8): void {
  wheel.traverse((o) => {
    const m = o as THREE.Mesh;
    const mat = m.isMesh ? (m.material as THREE.MeshStandardMaterial) : null;
    if (!mat || Array.isArray(mat) || mat.name !== 'wheel_brake') return;
    const geo = m.geometry.clone();
    const p = geo.attributes.position;
    let r = 0;
    for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getY(i), p.getZ(i)));
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) uv.set(discUv(p.getY(i), p.getZ(i), r), i * 2);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    m.geometry = geo;
    mat.map = discMap(anisotropy);
    mat.needsUpdate = true;
  });
}
