import * as THREE from 'three';
import { MEDIAN_NEAR_X, RAIL_D, ROAD_LENGTH } from '../config';

/**
 * The finish: a gate of yellow light across our carriageway at the end of the race (z = -ROAD_LENGTH). Two bars
 * of light standing up off the road, nothing across their tops, and between them a curtain of light; all of it
 * brightest on the road and fading out going up. Every racer goes through the curtain (it flares from where they
 * cross). A checkered line on the road. Its lights are clear of the fog: seen from as far as the camera sees
 * (fading in from there, not popping).
 */
const GATE = {
  /** The gate's sides (m from our carriageway's middle line, x 0; the median's edge on the left, the rail on the right). */
  left: MEDIAN_NEAR_X - 1.2,
  right: RAIL_D + 1.2,
  height: 7.5,
  /** The bars stand this far in from the sides (m), the curtain between them; how thick they are. */
  inset: 0.35,
  bar: 0.2,
  /** The light's colour, and how bright its bars at their feet (over the bloom's threshold: they glow). */
  color: new THREE.Color(1, 0.78, 0.1),
  glow: 3,
  /** Seen from this far (m: the camera's far plane 3000), in fully by `full`. */
  seenFrom: 2900,
  full: 2300,
};
/** A racer's flare through the curtain: rings spreading from where it crossed at `speed` m/s, gone in ~`life` s. */
const FLASH = { speed: 22, life: 1.4, max: 4 };
/**
 * The fountains of sparks at the gate's corners (each bar's foot, both sides), spraying up all the while (a
 * firework on the ground; the gate's own gone, past the player's finish, they still mark it): sparks a second
 * each, how fast up (m/s) and across, how long each lasts (s); only within `near` m of the camera.
 */
const FOUNTAIN = { rate: 120, up: [8, 12] as const, across: 1.2, life: [0.7, 1.3] as const, near: 700 };

/** Where a spark goes: at (x, y, z), going (vx, vy, vz), for `life` s (Sparks.emit). */
export type SparkEmitter = (x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) => void;

const Z = -ROAD_LENGTH;

function checkerTexture(cols: number, rows: number, on: string, off: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  const px = 32;
  c.width = cols * px;
  c.height = rows * px;
  const g = c.getContext('2d')!;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      g.fillStyle = (x + y) % 2 ? off : on;
      g.fillRect(x * px, y * px, px, px);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.anisotropy = 8;
  return t;
}

export class FinishGate {
  private readonly group = new THREE.Group();
  private readonly tube: THREE.MeshBasicMaterial;
  private readonly line: THREE.MeshBasicMaterial;
  private readonly curtain: THREE.ShaderMaterial;
  /** The flares going (x where crossed, age s; age < 0: none). */
  private readonly flashes = Array.from({ length: FLASH.max }, () => new THREE.Vector2(0, -1));
  /** Each racer's distance last frame (pass): who crossed since. */
  private readonly lastS = new Map<number, number>();
  private time = 0;
  /** The fountains' feet (world), and the fraction of a spark each owes. */
  private readonly fountains: THREE.Vector3[];
  private readonly owed: number[];

  /** Over the middle of the gate, a little above its bars (world): where the HUD marks it (Hud: goal). */
  readonly mark = new THREE.Vector3((GATE.left + GATE.right) / 2, GATE.height + 1, Z);

  constructor(scene: THREE.Scene) {
    const { left, right, height: h, inset, bar } = GATE;
    const width = right - left;
    const mid = (left + right) / 2;
    const inner = h - 0.2;
    // The bars: lit whole, brightest at their feet, fading out to their tops (added on: their dark is see-through).
    this.tube = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    const barGeo = new THREE.BoxGeometry(bar, inner, bar, 1, 12, 1).translate(0, inner / 2, 0);
    const ys = barGeo.attributes.position;
    const shade = new Float32Array(ys.count * 3);
    for (let i = 0; i < ys.count; i++) shade.fill(Math.max(0, 1 - ys.getY(i) / inner) ** 1.3, i * 3, i * 3 + 3);
    barGeo.setAttribute('color', new THREE.BufferAttribute(shade, 3));
    for (const x of [left + inset, right - inset]) {
      const b = new THREE.Mesh(barGeo, this.tube);
      b.position.x = x;
      b.renderOrder = 2;
      this.group.add(b);
    }
    // The line on the road, across our carriageway and its shoulders.
    this.line = new THREE.MeshBasicMaterial({
      map: checkerTexture(Math.round((2 * RAIL_D) / 0.5), 2, '#ffd21a', '#151515'),
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(2 * RAIL_D, 1), this.line);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.02, 0);
    this.group.add(line);
    // The curtain of light between the bars.
    this.curtain = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: {
        color: { value: GATE.color.clone() },
        time: { value: 0 },
        seen: { value: 1 },
        flashes: { value: this.flashes },
        size: { value: new THREE.Vector2(width - 2 * inset, inner) },
      },
      vertexShader: `
        varying vec2 vAt;
        uniform vec2 size;
        void main() {
          vAt = uv * size;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 color;
        uniform float time;
        uniform float seen;
        uniform vec2 flashes[${FLASH.max}];
        uniform vec2 size;
        varying vec2 vAt;
        void main() {
          // Rising off the road: brightest on it, gone by the bars' tops, bands of it drifting up; brighter at its edges.
          float y = vAt.y / size.y;
          float edge = min(vAt.x, size.x - vAt.x);
          float rise = pow(1.0 - y, 2.2);
          float a = 0.16 * rise + 0.06 * smoothstep(0.6, 1.0, sin(vAt.y * 2.2 - time * 3.0) * 0.5 + 0.5) * rise;
          a += 0.1 * exp(-edge * 2.0) * (1.0 - y);
          // The flares: a ring spreading out from where each racer crossed (at its height: 0.7 m), the curtain lit
          // all over a little as it goes.
          for (int i = 0; i < ${FLASH.max}; i++) {
            float age = flashes[i].y;
            if (age < 0.0) continue;
            float fade = exp(-age * ${(3 / FLASH.life).toFixed(3)});
            float r = length(vAt - vec2(flashes[i].x, 0.7));
            float ring = exp(-pow((r - age * ${FLASH.speed.toFixed(1)}) / 1.2, 2.0));
            a += fade * (0.7 * ring + 0.08);
          }
          gl_FragColor = vec4(color * a * seen * 1.3, 1.0);
        }`,
    });
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(width - 2 * inset, inner), this.curtain);
    curtain.position.set(mid, inner / 2, 0);
    curtain.renderOrder = 2;
    this.group.add(curtain);
    this.group.position.z = Z;
    scene.add(this.group);
    this.fade(1);
    this.fountains = [];
    for (const x of [left + inset + 0.25, right - inset - 0.25])
      for (const z of [0.3, -0.3]) this.fountains.push(new THREE.Vector3(x, 0.05, Z + z));
    this.owed = this.fountains.map(() => 0);
  }

  /** The gate seen or not (gone past the player's finish: the show's shots without it; its fountains go on). */
  set shown(on: boolean) {
    this.group.visible = on;
  }

  /** The fountains `play` s on (the race's time), into `emit`, the camera `cameraZ` along (none from far off). */
  spray(play: number, cameraZ: number, emit: SparkEmitter): void {
    if (play <= 0 || Math.abs(cameraZ - Z) > FOUNTAIN.near) return;
    const within = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);
    this.fountains.forEach((at, i) => {
      this.owed[i] += FOUNTAIN.rate * play;
      for (; this.owed[i] >= 1; this.owed[i]--) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * FOUNTAIN.across;
        emit(at.x, at.y, at.z, Math.cos(a) * r, within(FOUNTAIN.up), Math.sin(a) * r, within(FOUNTAIN.life));
      }
    });
  }

  /** A racer (`key`: its own) at `s` along the road, `x` across: through the gate since the last frame, a flare. */
  pass(key: number, s: number, x: number): void {
    const prev = this.lastS.get(key);
    this.lastS.set(key, s);
    if (prev === undefined || prev >= ROAD_LENGTH || s < ROAD_LENGTH) return;
    const f = this.flashes.find((v) => v.y < 0) ?? this.flashes.reduce((a, b) => (b.y > a.y ? b : a));
    f.set(x - GATE.left - GATE.inset, 0);
  }

  /** `play` s on (the race's time), the camera `cameraZ` along: the curtain's drift, the flares, the fade in from far. */
  update(play: number, cameraZ: number): void {
    this.time += play;
    this.curtain.uniforms.time.value = this.time;
    for (const f of this.flashes) if (f.y >= 0) f.y = f.y + play > FLASH.life * 2 ? -1 : f.y + play;
    const far = Math.abs(cameraZ - Z);
    this.fade(1 - THREE.MathUtils.smoothstep(far, GATE.full, GATE.seenFrom));
  }

  /** A new race: nobody through yet, no flares, the gate up. */
  reset(): void {
    this.shown = true;
    this.lastS.clear();
    for (const f of this.flashes) f.set(0, -1);
  }

  private fade(k: number): void {
    this.tube.color.copy(GATE.color).multiplyScalar(GATE.glow * k);
    this.line.color.setScalar(0.35 + 0.65 * k);
    this.curtain.uniforms.seen.value = k;
  }
}
