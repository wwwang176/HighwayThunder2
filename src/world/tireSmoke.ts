import * as THREE from 'three';
import { lowBeamCookie, TAN_HALF } from '../vehicles/headlight';

const MAX = 700;
const LIFE = 1.6; // s
const ALBEDO = 0.86;
/** Night sky glow + moon reaching the smoke (irradiance, linear). */
const AMBIENT = new THREE.Color(0x1c2740).multiplyScalar(0.35).add(new THREE.Color(0x8fa4d8).multiplyScalar(0.06));
/** Most lights the smoke shader takes (street lights + player + nearest NPC headlights). */
const MAX_LIGHTS = 16;
/** A puff's lit radius relative to its size attribute (matches its look on screen). */
const PUFF_RADIUS = 0.3;

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

const vec3s = () => Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3());
const vec4s = () => Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4());

/**
 * Tyre smoke: soft grey puffs emitted where a tyre is sliding hard (burnouts,
 * lock-ups, slides). One Points draw call; particles grow, rise and fade. Each
 * pixel of a puff is lit by the lights around it (three.js's punctual-light
 * falloff, spot cones, the low-beam pattern), so light fades smoothly across
 * the smoke instead of changing from one puff to the next.
 */
export class TireSmoke {
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(LIFE);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly geo = new THREE.BufferGeometry();
  private readonly uniforms = {
    lightCount: { value: 0 },
    lightPos: { value: vec3s() },
    lightColor: { value: vec3s() },
    lightDir: { value: vec3s() },
    // decay, distance (0 = unlimited), cos outer, cos inner (point light: -2, -1)
    lightParams: { value: vec4s() },
    // cookie right (xyz) + has-cookie flag (w); cookie up
    lightRight: { value: vec4s() },
    lightUp: { value: vec3s() },
    cookieTex: { value: lowBeamCookie(128) },
    ambient: { value: AMBIENT.clone().multiplyScalar(ALBEDO / Math.PI) },
  };
  private next = 0;
  private carry = new Map<number, number>();

  constructor(scene: THREE.Scene) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { scale: { value: 600 } }]),
      vertexShader: `
        attribute float size;
        attribute float alpha;
        uniform float scale;
        varying float vAlpha;
        varying vec3 vCenter;
        varying float vRadius;
        #include <fog_pars_vertex>
        void main() {
          vAlpha = alpha;
          vCenter = (modelMatrix * vec4(position, 1.0)).xyz;
          vRadius = size * ${PUFF_RADIUS.toFixed(2)};
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #define MAX_LIGHTS ${MAX_LIGHTS}
        uniform int lightCount;
        uniform vec3 lightPos[MAX_LIGHTS];
        uniform vec3 lightColor[MAX_LIGHTS];
        uniform vec3 lightDir[MAX_LIGHTS];
        uniform vec4 lightParams[MAX_LIGHTS];
        uniform vec4 lightRight[MAX_LIGHTS];
        uniform vec3 lightUp[MAX_LIGHTS];
        uniform sampler2D cookieTex;
        uniform vec3 ambient;
        varying float vAlpha;
        varying vec3 vCenter;
        varying float vRadius;
        #include <fog_pars_fragment>
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          if (d > 0.25) discard;
          float soft = 1.0 - d * 4.0;
          // Where this pixel is in the world: the sprite faces the camera.
          vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 p = vCenter + (camRight * c.x - camUp * c.y) * 2.0 * vRadius;
          vec3 e = vec3(0.0);
          for (int i = 0; i < MAX_LIGHTS; i++) {
            if (i >= lightCount) break;
            vec3 l = p - lightPos[i];
            float dist = length(l);
            vec4 prm = lightParams[i];
            float k = 1.0 / max(pow(dist, prm.x), 0.01);
            if (prm.y > 0.0) {
              float r = clamp(1.0 - pow(dist / prm.y, 4.0), 0.0, 1.0);
              k *= r * r;
            }
            if (prm.z > -1.5) {
              float along = dot(l, lightDir[i]);
              k *= smoothstep(prm.z, prm.w, along / dist);
              if (lightRight[i].w > 0.5 && along > 0.0) {
                vec2 uv = vec2(dot(l, lightRight[i].xyz), dot(l, lightUp[i])) / along;
                uv = uv / ${(2 * TAN_HALF).toFixed(4)} + 0.5;
                k *= (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) ? texture2D(cookieTex, uv).r : 0.0;
              }
            }
            e += lightColor[i] * k;
          }
          // Outgoing light of a diffuse grey surface (albedo / pi x irradiance), as the scene's materials.
          gl_FragColor = vec4(ambient + e * ${(ALBEDO / Math.PI).toFixed(4)}, vAlpha * soft * soft);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    Object.assign(mat.uniforms, this.uniforms);
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

  /** Advance the puffs; `lights` (world space, see smokeLightFromSpot) light them this frame. */
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
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
    this.setLights(lights);
  }

  private setLights(lights: SmokeLight[]): void {
    const u = this.uniforms;
    const n = Math.min(MAX_LIGHTS, lights.length);
    for (let i = 0; i < n; i++) {
      const l = lights[i];
      u.lightPos.value[i].copy(l.pos);
      u.lightColor.value[i].set(l.color.r, l.color.g, l.color.b);
      if (l.dir) {
        u.lightDir.value[i].copy(l.dir);
        u.lightParams.value[i].set(l.decay, l.distance, l.cosOuter!, l.cosInner!);
      } else u.lightParams.value[i].set(l.decay, l.distance, -2, -1);
      if (l.cookie) {
        const r = l.cookie.right;
        u.lightRight.value[i].set(r.x, r.y, r.z, 1);
        u.lightUp.value[i].copy(l.cookie.up);
      } else u.lightRight.value[i].w = 0;
    }
    u.lightCount.value = n;
  }

  clear(): void {
    this.age.fill(LIFE);
    this.alpha.fill(0);
    this.carry.clear();
  }
}
