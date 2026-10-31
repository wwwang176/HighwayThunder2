import * as THREE from 'three';
import { lowBeamPattern } from '../vehicles/headlight';

const MAX = 700;
const LIFE = 1.6; // s
const ALBEDO = 0.86;
/** Night sky glow + moon reaching the smoke (irradiance, linear). */
const AMBIENT = new THREE.Color(0x1c2740).multiplyScalar(0.35).add(new THREE.Color(0x8fa4d8).multiplyScalar(0.06));

/**
 * A light the smoke is lit by, in world space: a spot light (with an optional
 * low-beam cookie) or, without `dir`, a point light.
 */
export interface SmokeLight {
  pos: THREE.Vector3;
  color: THREE.Color; // colour × intensity (candela)
  decay: number;
  distance: number; // 0 = unlimited
  dir?: THREE.Vector3;
  cosOuter?: number;
  cosInner?: number;
  /** Low-beam cookie frame (right, up) when the light projects the low-beam pattern. */
  cookie?: { right: THREE.Vector3; up: THREE.Vector3 };
}

/** The smoke's view of a (visible) scene spot light. */
export function smokeLightFromSpot(l: THREE.SpotLight): SmokeLight {
  const pos = l.getWorldPosition(new THREE.Vector3());
  const dir = l.target.getWorldPosition(new THREE.Vector3()).sub(pos).normalize();
  const light: SmokeLight = {
    pos,
    color: l.color.clone().multiplyScalar(l.intensity),
    decay: l.decay,
    distance: l.distance,
    dir,
    cosOuter: Math.cos(l.angle),
    cosInner: Math.cos(l.angle * (1 - l.penumbra)),
  };
  if (l.map) {
    const right = new THREE.Vector3().crossVectors(dir, THREE.Object3D.DEFAULT_UP).normalize();
    light.cookie = { right, up: new THREE.Vector3().crossVectors(right, dir) };
  }
  return light;
}

const L = new THREE.Vector3();
const E = new THREE.Color();
const C = new THREE.Color();

/** Irradiance at p from the lights (three.js's punctual-light falloff), ambient included. */
function irradiance(px: number, py: number, pz: number, lights: SmokeLight[], out: THREE.Color): THREE.Color {
  out.copy(AMBIENT);
  for (const l of lights) {
    L.set(px - l.pos.x, py - l.pos.y, pz - l.pos.z);
    const d = L.length();
    if (d < 1e-3) continue;
    let k = 1 / Math.max(d ** l.decay, 0.01);
    if (l.distance > 0) {
      if (d >= l.distance) continue;
      k *= (1 - (d / l.distance) ** 4) ** 2;
    }
    if (l.dir) {
      const along = L.dot(l.dir);
      const cos = along / d;
      if (cos <= l.cosOuter!) continue;
      k *= THREE.MathUtils.smoothstep(cos, l.cosOuter!, l.cosInner!);
      if (l.cookie) k *= lowBeamPattern(L.dot(l.cookie.right) / along, L.dot(l.cookie.up) / along);
    }
    out.add(C.copy(l.color).multiplyScalar(k));
  }
  return out;
}

/**
 * Tyre smoke: soft grey puffs emitted where a tyre is sliding hard (burnouts,
 * lock-ups, slides). One Points draw call; particles grow, rise and fade, and
 * each is lit by the lights around it (dark in the dark, white in a lamp's pool,
 * red behind brake lights).
 */
export class TireSmoke {
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(LIFE);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly light = new Float32Array(MAX * 3);
  private readonly geo = new THREE.BufferGeometry();
  private next = 0;
  private carry = new Map<number, number>();

  constructor(scene: THREE.Scene) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('light', new THREE.BufferAttribute(this.light, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { scale: { value: 600 } }]),
      vertexShader: `
        attribute float size;
        attribute float alpha;
        attribute vec3 light;
        uniform float scale;
        varying float vAlpha;
        varying vec3 vLight;
        #include <fog_pars_vertex>
        void main() {
          vAlpha = alpha;
          vLight = light;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying float vAlpha;
        varying vec3 vLight;
        #include <fog_pars_fragment>
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          if (d > 0.25) discard;
          float soft = 1.0 - d * 4.0;
          gl_FragColor = vec4(vLight, vAlpha * soft * soft);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const pts = new THREE.Points(this.geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 2;
    scene.add(pts);
  }

  /** Emit for wheel `id` at a contact point; `slip` in m/s, carVel = car velocity (world). */
  emit(id: number, x: number, z: number, slip: number, carVx: number, carVz: number, dt: number): void {
    if (slip < 3) {
      this.carry.delete(id);
      return;
    }
    const rate = Math.min(90, (slip - 3) * 9); // puffs per second
    let n = (this.carry.get(id) ?? 0) + rate * dt;
    while (n >= 1) {
      n -= 1;
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.3;
      this.pos[i * 3 + 1] = 0.25;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
      // Smoke is left behind: it keeps only a little of the car's motion.
      this.vel[i * 3] = carVx * 0.15 + (Math.random() - 0.5) * 1.2;
      this.vel[i * 3 + 1] = 0.5 + Math.random() * 0.6;
      this.vel[i * 3 + 2] = carVz * 0.15 + (Math.random() - 0.5) * 1.2;
      this.age[i] = 0;
    }
    this.carry.set(id, n);
  }

  /** Advance the puffs and light them by `lights` (world space, see smokeLightFromSpot). */
  update(dt: number, lights: SmokeLight[] = []): void {
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= LIFE) {
        this.alpha[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = this.age[i] / LIFE;
      const drag = Math.exp(-2.5 * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = 0.8 + t * 3.2;
      this.alpha[i] = 0.45 * (1 - t) * Math.min(1, t * 8);
      // Outgoing light of a diffuse grey surface (albedo / pi x irradiance), as the scene's materials.
      irradiance(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2], lights, E).multiplyScalar(ALBEDO / Math.PI);
      this.light[i * 3] = E.r;
      this.light[i * 3 + 1] = E.g;
      this.light[i * 3 + 2] = E.b;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('light') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.age.fill(LIFE);
    this.alpha.fill(0);
    this.carry.clear();
  }
}
