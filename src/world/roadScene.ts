import * as THREE from 'three';
import { makeFlareMaterial } from '../render/lightFlares';
import { LANE_COUNT, LANE_WIDTH, LEFT_RAIL_X, MEDIAN_FAR_X, MEDIAN_NEAR_X, ONCOMING_X, RAIL_D, ROAD_HALF_WIDTH, ROAD_LENGTH } from '../config';

const STRIP_PERIOD = 100; // m; lane-dash (20), rail-post (4) and lamp (50) periods all divide it
const STRIP_BEHIND = 300;
const STRIP_AHEAD = 1300;
const STRIP_LEN = STRIP_BEHIND + STRIP_AHEAD;
const TREE_PERIOD = 400;
// Night: near-black sky, distance fading into deep blue-black.
const SKY = 0x03050b;
const FOG = 0x05070d;
// Street lights: neutral white, ~4700 K.
export const LAMP_COLOR = 0xffe9d2;
/** Night lighting levels (mutable: tuned live from the panel). */
export const NIGHT = {
  lampIntensity: 1000, // candela, real street lights near the player (one per lamp pair)
  poolStrength: 0.5, // painted light pools on the road
};
const LAMP_SPACING = 50; // every row has lamps on both sides of each carriageway, facing each other
const LAMP_HEIGHT = 9.8;
const POOL_RADIUS = 14;
// Real (shading) lights for the lamps over our carriageway inside this window;
// everything else is a painted light pool on the road.
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

function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
  // Speckle.
  const rnd = seeded(7);
  for (let i = 0; i < 9000; i++) {
    const v = 50 + Math.floor(rnd() * 60);
    g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
    g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5);
  }
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
  tex.repeat.set(1, STRIP_LEN / 20);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function grassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5f8a3a';
  g.fillRect(0, 0, 256, 256);
  const rnd = seeded(3);
  for (let i = 0; i < 4000; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? 'rgba(80,120,45,0.6)' : 'rgba(120,150,70,0.5)';
    g.fillRect(rnd() * 256, rnd() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2000 / 20, STRIP_LEN / 20);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function textPanel(lines: string[], w: number, h: number, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 8;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const size = Math.floor((h * 0.7) / lines.length);
  g.font = `bold ${size}px "Microsoft JhengHei", "Noto Sans TC", sans-serif`;
  lines.forEach((l, i) => g.fillText(l, w / 2, (h / (lines.length + 1)) * (i + 1)));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function checkerTexture(cols: number, rows: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = cols * 16;
  c.height = rows * 16;
  const g = c.getContext('2d')!;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class RoadScene {
  private strip = new THREE.Group();
  private trees = new THREE.Group();
  private far = new THREE.Group();
  private lampHeads: LampHead[] = [];
  private lampRows: LampRow[] = [];
  readonly lampFlareMaterial = makeFlareMaterial(2.5);
  /** Road and grass surfaces (receive NPC headlight beams, see render/npcBeams). */
  readonly groundMaterials: THREE.MeshStandardMaterial[] = [];
  private pools!: THREE.InstancedMesh;
  private realLights: THREE.SpotLight[] = [];
  private readonly poolColor = new THREE.Color(LAMP_COLOR);
  private readonly tmpColor = new THREE.Color();

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(FOG, 60, 650);

    // Faint sky glow and a weak bluish moonlight keep silhouettes readable.
    scene.add(new THREE.HemisphereLight(0x1c2740, 0x07080a, 0.35));
    const moon = new THREE.DirectionalLight(0x8fa4d8, 0.12);
    moon.position.set(-200, 300, 100);
    scene.add(moon);

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
    this.buildLandmarks();
    scene.add(this.strip, this.trees, this.far);
  }

  private buildStrip(renderer: THREE.WebGLRenderer): void {
    const midZ = -(STRIP_AHEAD - STRIP_BEHIND) / 2;

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * RAIL_D, STRIP_LEN).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: roadTexture(renderer), roughness: 0.92 }),
    );
    road.position.set(0, 0.01, midZ);
    road.receiveShadow = true;
    this.strip.add(road);

    // Oncoming carriageway: same surface mirrored, so its yellow edge line sits
    // next to the median like ours.
    const roadMat2 = (road.material as THREE.MeshStandardMaterial).clone();
    roadMat2.side = THREE.DoubleSide;
    const road2 = new THREE.Mesh(road.geometry, roadMat2);
    road2.scale.x = -1;
    road2.position.set(ONCOMING_X, 0.01, midZ);
    road2.receiveShadow = true;
    this.strip.add(road2);
    this.groundMaterials.push(road.material as THREE.MeshStandardMaterial, roadMat2);

    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, STRIP_LEN).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }),
    );
    grass.position.set(0, -0.02, midZ);
    grass.receiveShadow = true;
    this.strip.add(grass);
    this.groundMaterials.push(grass.material);

    // Guardrails: beam + posts every 4 m.
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.4, metalness: 0.7 });
    const railX = [RAIL_D, LEFT_RAIL_X];
    for (const x of railX) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, STRIP_LEN), metal);
      beam.position.set(x + Math.sign(x) * 0.06, 0.62, midZ);
      beam.castShadow = true;
      this.strip.add(beam);
    }
    const postCount = (STRIP_LEN / 4) * 2;
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.8, 0.14), metal, postCount);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let s = -STRIP_BEHIND; s < STRIP_AHEAD; s += 4)
      for (const x of railX) posts.setMatrixAt(i++, m.makeTranslation(x + Math.sign(x) * 0.2, 0.4, -s));
    this.strip.add(posts);

    // Street lights, opposite arrangement: each row has a lamp on the right shoulder
    // and one on the median facing it, so their pools meet across our carriageway
    // and a single real light can stand in for the pair. The median lamps have a
    // second arm over the oncoming carriageway, which also has lamps on its outer edge.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.6, metalness: 0.5 });
    const headMat = new THREE.MeshBasicMaterial({ color: LAMP_COLOR });
    const medianX = (MEDIAN_NEAR_X + MEDIAN_FAR_X) / 2;
    // Each pole: position, stagger, and arms as (direction, reach to the lamp head).
    const poleSpecs: { x: number; offset: number; arms: [number, number][] }[] = [
      { x: RAIL_D + 1.6, offset: 0, arms: [[-1, 2.3]] },
      { x: medianX, offset: 0, arms: [[-1, 4.5], [1, 4.5]] },
      { x: LEFT_RAIL_X - 1.6, offset: 0, arms: [[1, 2.3]] },
    ];
    const rows = STRIP_LEN / LAMP_SPACING;
    const poleCount = rows * poleSpecs.length;
    const armCount = rows * poleSpecs.reduce((n, p) => n + p.arms.length, 0);
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 10, 8), poleMat, poleCount);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.12, 0.12), poleMat, armCount);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.16, 0.4), headMat, armCount);
    this.pools = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(POOL_RADIUS * 2, POOL_RADIUS * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: poolTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
      armCount,
    );
    this.pools.frustumCulled = false;
    let pi = 0;
    let ai = 0;
    for (let r = 0; r < rows; r++) {
      for (const spec of poleSpecs) {
        const sPos = -STRIP_BEHIND + r * LAMP_SPACING + spec.offset;
        poles.setMatrixAt(pi++, m.makeTranslation(spec.x, 5, -sPos));
        for (const [dir, reach] of spec.arms) {
          const hx = spec.x + dir * reach;
          arms.setMatrixAt(
            ai,
            m.compose(new THREE.Vector3(spec.x + (dir * (reach + 0.2)) / 2, 9.9, -sPos), new THREE.Quaternion(), new THREE.Vector3(reach + 0.2, 1, 1)),
          );
          heads.setMatrixAt(ai, m.makeTranslation(hx, LAMP_HEIGHT, -sPos));
          // Pool centred a little toward the road from the head.
          this.pools.setMatrixAt(ai, m.makeTranslation(hx + dir * 1.0, 0.03, -sPos));
          this.pools.setColorAt(ai, this.poolColor);
          if (hx > MEDIAN_NEAR_X - 4) {
            // Over our carriageway: pair it with the row's other lamp.
            const row = this.lampRows.find((w) => w.s === sPos);
            if (row) {
              row.heads.push(ai);
              row.x = (row.x + hx) / 2;
            } else this.lampRows.push({ x: hx, s: sPos, heads: [ai] });
          }
          this.lampHeads.push({ x: hx, s: sPos });
          ai++;
        }
      }
    }
    this.strip.add(poles, arms, heads, this.pools);

    // Lamp-head glows: soft sprites that stay a few pixels wide in the distance.
    const fpos = new Float32Array(this.lampHeads.length * 3);
    const fcol = new Float32Array(this.lampHeads.length * 3);
    const fsize = new Float32Array(this.lampHeads.length);
    const c = new THREE.Color(LAMP_COLOR);
    this.lampHeads.forEach((h, k) => {
      fpos.set([h.x, LAMP_HEIGHT - 0.15, -h.s], k * 3);
      fcol.set([c.r, c.g, c.b], k * 3);
      fsize[k] = 1.6;
    });
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    fgeo.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
    fgeo.setAttribute('size', new THREE.BufferAttribute(fsize, 1));
    const lampFlares = new THREE.Points(fgeo, this.lampFlareMaterial);
    lampFlares.frustumCulled = false;
    lampFlares.renderOrder = 3;
    this.strip.add(lampFlares);
  }

  private buildTrees(): void {
    const rnd = seeded(42);
    const per = 70;
    const reps = Math.ceil(STRIP_LEN / TREE_PERIOD) + 1;
    const count = per * reps;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.25, 0.35, 2, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a2a20 }),
      count,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.2, 6, 7),
      new THREE.MeshStandardMaterial({ color: 0x1f3d1c, flatShading: true }),
      count,
    );
    const base: { x: number; s: number; k: number }[] = [];
    for (let j = 0; j < per; j++) {
      const right = rnd() < 0.5;
      const off = 6 + rnd() * rnd() * 90;
      base.push({ x: right ? RAIL_D + off : LEFT_RAIL_X - off, s: rnd() * TREE_PERIOD, k: 0.7 + rnd() * 0.8 });
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const pos = new THREE.Vector3();
    let i = 0;
    for (let r = 0; r < reps; r++)
      for (const t of base) {
        const s = -STRIP_BEHIND + r * TREE_PERIOD + t.s;
        scl.setScalar(t.k);
        trunks.setMatrixAt(i, m.compose(pos.set(t.x, 1 * t.k, -s), q, scl));
        crowns.setMatrixAt(i, m.compose(pos.set(t.x, 4.5 * t.k, -s), q, scl));
        i++;
      }
    crowns.castShadow = true;
    this.trees.add(trunks, crowns);
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

  private buildLandmarks(): void {
    const grp = new THREE.Group();
    // Start and finish lines on the road.
    const lineGeo = new THREE.PlaneGeometry(2 * ROAD_HALF_WIDTH, 2).rotateX(-Math.PI / 2);
    const checker = new THREE.MeshBasicMaterial({ map: checkerTexture(30, 4) });
    const start = new THREE.Mesh(lineGeo, checker);
    start.position.set(0, 0.03, 0);
    const finish = new THREE.Mesh(lineGeo, checker);
    finish.position.set(0, 0.03, -ROAD_LENGTH);
    grp.add(start, finish);

    // Gantries.
    const steel = new THREE.MeshStandardMaterial({ color: 0x7d838a, metalness: 0.6, roughness: 0.4 });
    // Gantries span both carriageways.
    const spanL = LEFT_RAIL_X - 1;
    const spanR = RAIL_D + 1;
    const gantry = (s: number, tex: THREE.Texture) => {
      for (const x of [spanL, spanR]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), steel);
        p.position.set(x, 4, -s);
        p.castShadow = true;
        grp.add(p);
      }
      const banner = new THREE.Mesh(
        new THREE.BoxGeometry(spanR - spanL + 0.6, 2.4, 0.3),
        [steel, steel, steel, steel, new THREE.MeshBasicMaterial({ map: tex }), new THREE.MeshBasicMaterial({ map: tex })],
      );
      banner.position.set((spanL + spanR) / 2, 7.6, -s);
      banner.castShadow = true;
      grp.add(banner);
    };
    gantry(40, textPanel(['START 起點'], 2048, 128, '#1b3d7a', '#ffffff'));
    gantry(ROAD_LENGTH, textPanel(['FINISH  終點'], 2048, 128, '#111111', '#ffd400'));

    // Distance signs every km on the right shoulder.
    for (let k = 1; k <= 9; k++) {
      const s = k * 1000;
      const tex = textPanel(['終點', `${10 - k} km`], 256, 192, '#1f6e3a', '#ffffff');
      const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), new THREE.MeshBasicMaterial({ map: tex }));
      board.position.set(RAIL_D + 2.2, 4.2, -s);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 0.15), steel);
      pole.position.set(RAIL_D + 2.2, 1.6, -s - 0.05);
      grp.add(board, pole);
    }
    this.scene.add(grp);
  }

  /**
   * Keep the repeating scenery under the player, and hand the real street lights to
   * the lamp pairs over our carriageway nearest ahead (one light per pair). Their painted pools fade out as
   * the real light fades in, so nothing pops.
   */
  update(playerS: number, _playerX: number): void {
    const stripS = Math.floor(playerS / STRIP_PERIOD) * STRIP_PERIOD;
    this.strip.position.z = -stripS;
    this.trees.position.z = -Math.floor(playerS / TREE_PERIOD) * TREE_PERIOD;
    this.far.position.z = -playerS;

    for (let i = 0; i < this.lampHeads.length; i++) {
      this.tmpColor.copy(this.poolColor).multiplyScalar(NIGHT.poolStrength);
      this.pools.setColorAt(i, this.tmpColor);
    }
    let li = 0;
    for (const row of this.lampRows) {
      const ds = stripS + row.s - playerS;
      if (ds <= -REAL_LIGHT_BEHIND || ds >= REAL_LIGHT_AHEAD || li >= this.realLights.length) continue;
      const real = Math.min(1, (ds + REAL_LIGHT_BEHIND) / REAL_LIGHT_FADE, (REAL_LIGHT_AHEAD - ds) / REAL_LIGHT_FADE);
      const l = this.realLights[li++];
      const z = -(stripS + row.s);
      l.visible = true;
      l.intensity = NIGHT.lampIntensity * real;
      l.position.set(row.x, LAMP_HEIGHT - 0.2, z);
      l.target.position.set(row.x, 0, z);
      l.target.updateMatrixWorld();
      this.tmpColor.copy(this.poolColor).multiplyScalar((1 - real) * NIGHT.poolStrength);
      for (const hi of row.heads) this.pools.setColorAt(hi, this.tmpColor);
    }
    for (; li < this.realLights.length; li++) this.realLights[li].visible = false;
    if (this.pools.instanceColor) this.pools.instanceColor.needsUpdate = true;
  }
}
