import * as THREE from 'three';
import { LANE_COUNT, LANE_WIDTH, LEFT_RAIL_X, ONCOMING_X, RAIL_D, ROAD_HALF_WIDTH, ROAD_LENGTH } from '../config';

const STRIP_PERIOD = 100; // m; lane-dash (20), rail-post (4) and lamp (50) periods all divide it
const STRIP_BEHIND = 300;
const STRIP_AHEAD = 1300;
const STRIP_LEN = STRIP_BEHIND + STRIP_AHEAD;
const TREE_PERIOD = 400;
const SKY = 0xa9c8e6;

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
  readonly sun: THREE.DirectionalLight;
  private strip = new THREE.Group();
  private trees = new THREE.Group();
  private far = new THREE.Group();

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 220, 900);

    scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4d5e33, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -35;
    sc.right = 35;
    sc.top = 60;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 250;
    this.sun.shadow.bias = -0.0005;
    scene.add(this.sun, this.sun.target);

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

    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, STRIP_LEN).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }),
    );
    grass.position.set(0, -0.02, midZ);
    grass.receiveShadow = true;
    this.strip.add(grass);

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

    // Lamp posts every 50 m on both sides.
    const lampCount = (STRIP_LEN / 50) * 2;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8c9196, roughness: 0.5, metalness: 0.5 });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 10, 8), poleMat, lampCount);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), poleMat, lampCount);
    const heads = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 0.18, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xf5f1dc, emissive: 0x6b6650 }),
      lampCount,
    );
    i = 0;
    for (let s = -STRIP_BEHIND; s < STRIP_AHEAD; s += 50)
      for (const rx of railX) {
        const side = Math.sign(rx);
        const x = rx + side * 1.6;
        poles.setMatrixAt(i, m.makeTranslation(x, 5, -s));
        arms.setMatrixAt(i, m.makeTranslation(x - side * 1.2, 9.9, -s));
        heads.setMatrixAt(i, m.makeTranslation(x - side * 2.3, 9.8, -s));
        i++;
      }
    poles.castShadow = true;
    this.strip.add(poles, arms, heads);
  }

  private buildTrees(): void {
    const rnd = seeded(42);
    const per = 70;
    const reps = Math.ceil(STRIP_LEN / TREE_PERIOD) + 1;
    const count = per * reps;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.25, 0.35, 2, 6),
      new THREE.MeshStandardMaterial({ color: 0x5b4030 }),
      count,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.2, 6, 7),
      new THREE.MeshStandardMaterial({ color: 0x2f5d2a, flatShading: true }),
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
    const mat = new THREE.MeshStandardMaterial({ color: 0x6f8aa3, flatShading: true, fog: false });
    const mat2 = new THREE.MeshStandardMaterial({ color: 0x7f9a86, flatShading: true, fog: false });
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      const h = 60 + rnd() * 160;
      const mtn = new THREE.Mesh(new THREE.ConeGeometry(h * 1.6, h, 6), rnd() < 0.5 ? mat : mat2);
      mtn.position.set(side * (700 + rnd() * 500), h / 2 - 5, -(rnd() * 3000 - 600));
      this.far.add(mtn);
    }
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

  /** Keep the repeating scenery under the player and the sun's shadow box on them. */
  update(playerS: number, playerX: number): void {
    this.strip.position.z = -Math.floor(playerS / STRIP_PERIOD) * STRIP_PERIOD;
    this.trees.position.z = -Math.floor(playerS / TREE_PERIOD) * TREE_PERIOD;
    this.far.position.z = -playerS;
    const z = -playerS;
    this.sun.position.set(playerX + 40, 70, z + 25);
    this.sun.target.position.set(playerX, 0, z - 15);
  }
}
