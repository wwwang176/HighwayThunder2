import * as THREE from 'three';

/**
 * The cars' tyre tread, drawn on at load (the files' tyres are plain: tools/models/wheels.py): three grooves round
 * the tyre, slanted lateral grooves on the shoulders, thin sipes on the inner ribs - as maps (a normal map, its
 * colour and its roughness), no extra triangles. The file's tyre (one material, `tyre`) gets uvs: u round the
 * tyre (TREAD_TILES pattern tiles a turn), v across - the tread in the band [TREAD_MARGIN, 1 - TREAD_MARGIN],
 * each sidewall in the flat margin on its side (v 0 on +x, 1 on -x).
 */

/** The pattern's tiles round the tyre (two lateral grooves each). */
export const TREAD_TILES = 20;
/** One tile, px: round the tyre (W) and across it (H: the tread's band and a flat margin each side). */
const W = 128;
const BAND = 320;
const EDGE = 16;
const H = BAND + 2 * EDGE;
/** The flat margins' share of v (the sidewalls'). */
export const TREAD_MARGIN = EDGE / H;
/** The rubber (linear): the sidewall's and the tread's, the grooves' floor darker (the colour map). */
const RUBBER = 0.012;
const GROOVE_SHADE = 0.3;
const ROUGH = { wall: 0.9, tread: 0.78, groove: 0.95 };

/** Tread (r at the top) or not: within this of the tyre's outside radius (m). */
const TOP_EPS = 1e-4;

/**
 * A point's v: on the tread (`onTread`, its x within +-`halfTread`) across the band, +x side toward 0; on a
 * sidewall the margin's outer edge on its side.
 */
export function treadV(x: number, onTread: boolean, halfTread: number): number {
  if (!onTread) return x > 0 ? 0 : 1;
  const s = halfTread > 0 ? Math.min(1, Math.max(0, (halfTread - x) / (2 * halfTread))) : 0.5;
  return TREAD_MARGIN + (1 - 2 * TREAD_MARGIN) * s;
}

/**
 * A triangle's three angles round the axle (rad) as u's (`tiles` a turn), unwrapped: the one past the seam taken a
 * turn on, so a triangle across it doesn't run the pattern back round the tyre.
 */
export function triangleU(a0: number, a1: number, a2: number, tiles: number): [number, number, number] {
  const turn = 2 * Math.PI;
  const near = (a: number) => a + turn * Math.round((a0 - a) / turn);
  return [a0, near(a1), near(a2)].map((a) => (a / turn) * tiles) as [number, number, number];
}

/**
 * The tyre's geometry, its triangles each its own (a seam's u's can't share a vertex), with uvs (the axle along
 * x): a new geometry (the file's own normals kept).
 */
export function treadGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g.clone();
  const p = out.attributes.position;
  let top = 0;
  for (let i = 0; i < p.count; i++) top = Math.max(top, Math.hypot(p.getY(i), p.getZ(i)));
  let half = 0;
  for (let i = 0; i < p.count; i++) if (Math.hypot(p.getY(i), p.getZ(i)) > top - TOP_EPS) half = Math.max(half, Math.abs(p.getX(i)));
  const uv = new Float32Array(p.count * 2);
  for (let t = 0; t < p.count; t += 3) {
    const us = triangleU(
      Math.atan2(p.getZ(t), p.getY(t)),
      Math.atan2(p.getZ(t + 1), p.getY(t + 1)),
      Math.atan2(p.getZ(t + 2), p.getY(t + 2)),
      TREAD_TILES,
    );
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      uv[i * 2] = us[k];
      uv[i * 2 + 1] = treadV(p.getX(i), Math.hypot(p.getY(i), p.getZ(i)) > top - TOP_EPS, half);
    }
  }
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

/** The pattern, black on white, in the band (its grooves' depth: how dark). */
function drawTread(g: CanvasRenderingContext2D) {
  g.save();
  g.beginPath();
  g.rect(-1, EDGE, W + 2, BAND);
  g.clip();
  g.translate(0, EDGE);
  g.strokeStyle = '#000';
  // the three grooves round the tyre
  g.lineCap = 'butt';
  g.lineWidth = 18;
  for (const y of [0.25, 0.5, 0.75]) {
    g.beginPath();
    g.moveTo(-10, BAND * y);
    g.lineTo(W + 10, BAND * y);
    g.stroke();
  }
  g.lineCap = 'round';
  for (const dx of [-W, 0, W])
    for (const x of [0.2, 0.7]) {
      const x0 = dx + W * x;
      // shoulders: from the edge in, stopping short of the outer groove
      g.lineWidth = 10;
      g.beginPath();
      g.moveTo(x0 - 8, -6);
      g.lineTo(x0 + 6, BAND * 0.25 - 22);
      g.moveTo(x0 - 8, BAND + 6);
      g.lineTo(x0 + 6, BAND * 0.75 + 22);
      g.stroke();
      // inner ribs: a sipe from the centre groove half across
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x0 + 26, BAND * 0.5);
      g.lineTo(x0 + 34, BAND * 0.36);
      g.moveTo(x0 + 26, BAND * 0.5);
      g.lineTo(x0 + 34, BAND * 0.64);
      g.stroke();
    }
  g.restore();
}

const linearByte = (v: number) => Math.round(255 * v);
const srgbByte = (v: number) => Math.round(255 * Math.pow(v, 1 / 2.2));

let maps: { normal: THREE.Texture; color: THREE.Texture; rough: THREE.Texture } | null = null;

/** The tread's maps (made once, shared by every car's tyre). */
function treadMaps(anisotropy: number) {
  if (maps) return maps;
  const canvas = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c;
  };
  const sharp = canvas();
  const sg = sharp.getContext('2d')!;
  sg.fillStyle = '#fff';
  sg.fillRect(0, 0, W, H);
  drawTread(sg);
  // a softened height (1 the tread's face, 0 a groove's floor)
  const soft = canvas();
  const bg = soft.getContext('2d', { willReadFrequently: true })!;
  bg.filter = 'blur(2px)';
  bg.drawImage(sharp, 0, 0);
  const src = bg.getImageData(0, 0, W, H).data;
  const height = (x: number, y: number) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  const fill = (paint: (x: number, y: number, h: number) => [number, number, number]) => {
    const c = canvas();
    const cg = c.getContext('2d')!;
    const img = cg.createImageData(W, H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const [r, g, b] = paint(x, y, height(x, y));
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    cg.putImageData(img, 0, 0);
    return c;
  };
  const n = new THREE.Vector3();
  const SLOPE = 3.5;
  const normal = fill((x, y) => {
    n.set(-(height(x + 1, y) - height(x - 1, y)) * SLOPE, -(height(x, y + 1) - height(x, y - 1)) * SLOPE, 1).normalize();
    return [linearByte(n.x * 0.5 + 0.5), linearByte(n.y * 0.5 + 0.5), linearByte(n.z * 0.5 + 0.5)];
  });
  const color = fill((_x, _y, h) => {
    const v = srgbByte(GROOVE_SHADE + (1 - GROOVE_SHADE) * h);
    return [v, v, v];
  });
  const rough = fill((_x, y, h) => {
    const r = y < EDGE || y >= H - EDGE ? ROUGH.wall : ROUGH.groove + (ROUGH.tread - ROUGH.groove) * h;
    const v = linearByte(r);
    return [v, v, v];
  });
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = anisotropy;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  };
  maps = { normal: tex(normal, false), color: tex(color, true), rough: tex(rough, false) };
  return maps;
}

/** A file's wheel: its tyre (material `tyre`) given the tread (uvs, the maps; the rubber's own colour). */
export function addTread(wheel: THREE.Object3D, anisotropy = 8): void {
  wheel.traverse((o) => {
    const m = o as THREE.Mesh;
    const mat = m.isMesh ? (m.material as THREE.MeshStandardMaterial) : null;
    if (!mat || Array.isArray(mat) || mat.name !== 'tyre') return;
    m.geometry = treadGeometry(m.geometry);
    const t = treadMaps(anisotropy);
    mat.color.setRGB(RUBBER, RUBBER, RUBBER, THREE.LinearSRGBColorSpace);
    mat.map = t.color;
    mat.normalMap = t.normal;
    mat.normalScale.set(1.4, 1.4);
    mat.roughnessMap = t.rough;
    mat.roughness = 1;
    mat.needsUpdate = true;
  });
}
