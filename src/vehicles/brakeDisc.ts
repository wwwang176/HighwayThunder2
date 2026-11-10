import * as THREE from 'three';

/**
 * The cars' brake discs slotted, drawn on at load (the files' discs are plain: tools/models/rims/make_rims.py): curved
 * slots across the friction ring, its face fine-turned, the hat in the middle duller - as maps (a normal map, its
 * colour and its roughness) on uvs laid flat across the disc's face, no extra triangles. The disc is the file's
 * wheel's `wheel_brake` (a cylinder along x): its two faces take the pattern (the inner one mirrored), its edge the
 * ring's outer rim.
 */

/** The map, px (the disc's radius to its edge). */
const S = 256;
/** The slots: how many, from and to (of the radius), how far each sweeps round (rad), how wide (px). */
const SLOTS = { n: 6, from: 0.6, to: 0.93, sweep: 0.55, width: 5 };
/** The hat (the bell the wheel bolts to) out to this, of the radius. */
const HAT = 0.52;
/** The colour (times the material's steel): the slots' floor, the hat. */
const SHADE = { slot: 0.35, hat: 0.68 };
/** Roughness: the ring (fine-turned: +- `lines` across it), the slots, the hat. */
const ROUGH = { ring: 0.3, lines: 0.06, slot: 0.75, hat: 0.6 };

/** A point on the disc's face (y, z; its radius `r`) as its uv: the disc across the map. */
export function discUv(y: number, z: number, r: number): [number, number] {
  return [0.5 + (0.5 * y) / r, 0.5 + (0.5 * z) / r];
}

/** Slot `i`'s centre line, at `t` (0 inner end .. 1 outer): radius (of the disc's) and angle (rad). */
export function slotPoint(i: number, t: number): [number, number] {
  return [SLOTS.from + (SLOTS.to - SLOTS.from) * t, (2 * Math.PI * i) / SLOTS.n + SLOTS.sweep * Math.pow(t, 1.4)];
}

/** The slots, black on white (their depth: how dark). */
function drawSlots(g: CanvasRenderingContext2D) {
  const c = S / 2;
  g.strokeStyle = '#000';
  g.lineWidth = SLOTS.width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let i = 0; i < SLOTS.n; i++) {
    g.beginPath();
    for (let k = 0; k <= 12; k++) {
      const [r, a] = slotPoint(i, k / 12);
      const x = c + r * c * Math.cos(a), y = c + r * c * Math.sin(a);
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
  }
}

const linearByte = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v)));
const srgbByte = (v: number) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2));

let maps: { normal: THREE.Texture; color: THREE.Texture; rough: THREE.Texture } | null = null;

/** The disc's maps (made once, shared by every car's discs). */
function discMaps(anisotropy: number) {
  if (maps) return maps;
  const canvas = () => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    return cv;
  };
  const sharp = canvas();
  const sg = sharp.getContext('2d')!;
  sg.fillStyle = '#fff';
  sg.fillRect(0, 0, S, S);
  drawSlots(sg);
  // a softened height (1 the disc's face, 0 a slot's floor)
  const soft = canvas();
  const bg = soft.getContext('2d', { willReadFrequently: true })!;
  bg.filter = 'blur(1px)';
  bg.drawImage(sharp, 0, 0);
  const src = bg.getImageData(0, 0, S, S).data;
  const clampPx = (v: number) => Math.min(S - 1, Math.max(0, v));
  const height = (x: number, y: number) => src[(clampPx(y) * S + clampPx(x)) * 4] / 255;
  // the turning's fine rings: a fixed ripple by radius (no randomness: the same every load)
  const lines = (rho: number) => 0.5 * Math.sin(rho * 410) + 0.3 * Math.sin(rho * 173 + 1.3) + 0.2 * Math.sin(rho * 61 + 0.4);
  const fill = (paint: (rho: number, h: number, x: number, y: number) => [number, number, number]) => {
    const cv = canvas();
    const cg = cv.getContext('2d')!;
    const img = cg.createImageData(S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const o = (y * S + x) * 4;
        const rho = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
        const [r, g, b] = paint(rho, height(x, y), x, y);
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    cg.putImageData(img, 0, 0);
    return cv;
  };
  const n = new THREE.Vector3();
  const SLOPE = 3;
  const normal = fill((_rho, _h, x, y) => {
    n.set(-(height(x + 1, y) - height(x - 1, y)) * SLOPE, -(height(x, y + 1) - height(x, y - 1)) * SLOPE, 1).normalize();
    return [linearByte(n.x * 0.5 + 0.5), linearByte(n.y * 0.5 + 0.5), linearByte(n.z * 0.5 + 0.5)];
  });
  const color = fill((rho, h) => {
    const face = rho < HAT ? SHADE.hat : 0.96 + 0.04 * lines(rho);
    const v = srgbByte(face * (SHADE.slot + (1 - SHADE.slot) * h));
    return [v, v, v];
  });
  const rough = fill((rho, h) => {
    const face = rho < HAT ? ROUGH.hat : ROUGH.ring + ROUGH.lines * lines(rho);
    const v = linearByte(ROUGH.slot + (face - ROUGH.slot) * h);
    return [v, v, v];
  });
  const tex = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = anisotropy;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  };
  maps = { normal: tex(normal, false), color: tex(color, true), rough: tex(rough, false) };
  return maps;
}

/** A file's wheel: its brake disc (material `wheel_brake`) slotted (uvs, the maps). */
export function addDiscSlots(wheel: THREE.Object3D, anisotropy = 8): void {
  wheel.traverse((o) => {
    const m = o as THREE.Mesh;
    const mat = m.isMesh ? (m.material as THREE.MeshStandardMaterial) : null;
    if (!mat || Array.isArray(mat) || mat.name !== 'wheel_brake') return;
    const g = m.geometry.clone();
    const p = g.attributes.position;
    let r = 0;
    for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getY(i), p.getZ(i)));
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) uv.set(discUv(p.getY(i), p.getZ(i), r), i * 2);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    m.geometry = g;
    const t = discMaps(anisotropy);
    mat.map = t.color;
    mat.normalMap = t.normal;
    mat.roughnessMap = t.rough;
    mat.roughness = 1;
    mat.needsUpdate = true;
  });
}
