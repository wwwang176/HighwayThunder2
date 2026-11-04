import * as THREE from 'three';
import type { FlareDepth } from './flarePass';

/**
 * Soft glowing sprites for light sources (car head/tail lights, lamp heads).
 * Each sprite has a size in metres but never shrinks below a few pixels, so
 * distant lights stay visible and steady instead of shimmering in and out the
 * way sub-pixel geometry does. Additive; occluded by the depth buffer.
 * `aimed`: each flare has a direction its lamp shines in (`aim`, world; none:
 * all round) and fades seen from off it (flareFacing). `depth` (a FlarePass's):
 * not depth tested but each faded whole by how much of it the scene hides.
 */
export function makeFlareMaterial(minPx = 3, aimed = false, depth?: FlareDepth): THREE.ShaderMaterial {
  const defines: Record<string, string> = {};
  if (aimed) defines.AIMED = '';
  if (depth) defines.OCCLUDED = '';
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: !depth,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    defines,
    uniforms: {
      scale: { value: 600 },
      minPx: { value: minPx },
      opacity: { value: 1 },
      aimFull: { value: Math.cos(THREE.MathUtils.degToRad(FLARE_AIM.full)) },
      aimGone: { value: Math.cos(THREE.MathUtils.degToRad(FLARE_AIM.gone)) },
      ...depth,
    },
    vertexShader: `
      #ifdef OCCLUDED
      #include <packing>
      uniform sampler2D tDepth;
      uniform vec2 depthRes;
      uniform float cameraNear;
      uniform float cameraFar;
      #endif
      attribute vec3 color;
      attribute float size;
      uniform float scale;
      uniform float minPx;
      uniform float opacity;
      varying vec3 vColor;
      varying float vAlpha;
      #ifdef AIMED
      attribute vec3 aim;
      uniform float aimFull;
      uniform float aimGone;
      #endif
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float px = size * scale / max(-mv.z, 0.1);
        gl_PointSize = max(px, minPx);
        // Far lights shrink to a steady dot that dims a little with distance.
        vAlpha = px < minPx ? mix(0.55, 1.0, px / minPx) : 1.0;
        vAlpha *= clamp(1.0 - (-mv.z) / 1400.0, 0.0, 1.0) * opacity;
        #ifdef AIMED
        // (flareFacing; the points are in world space)
        if (dot(aim, aim) > 0.25) {
          vec3 toCam = normalize(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);
          vAlpha *= smoothstep(aimGone, aimFull, dot(aim, toCam));
        }
        #endif
        vColor = color;
        gl_Position = projectionMatrix * mv;
        #ifdef OCCLUDED
        // How much of it the scene hides: its middle and six points round it (a third of its size out), each
        // seen unless something is drawn nearer (by more than a little: its own lamp's glass behind it).
        vec2 uv = gl_Position.xy / gl_Position.w * 0.5 + 0.5;
        vec2 r = vec2(max(1.0, 0.35 * px)) / depthRes;
        float bias = max(0.2, 0.02 * -mv.z);
        float seen = 0.0;
        for (int i = 0; i < 7; i++) {
          float a = float(i) * 1.0472;
          vec2 at = i == 0 ? uv : uv + vec2(cos(a), sin(a)) * r;
          bool off = at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0;
          float z = -perspectiveDepthToViewZ(texture2D(tDepth, at).x, cameraNear, cameraFar);
          seen += off || z >= -mv.z - bias ? 1.0 : 0.0;
        }
        vAlpha *= seen / 7.0;
        #endif
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = 1.0 - d;
        float glow = core * core * core * 1.2 + core * 0.25;
        gl_FragColor = vec4(vColor * glow * vAlpha, 1.0);
      }`,
  });
}

/** Keep flare sizes right for the camera's vertical FOV and the canvas height. */
export function updateFlareScale(mat: THREE.ShaderMaterial, camera: THREE.PerspectiveCamera, heightPx: number): void {
  mat.uniforms.scale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}

/** The vehicles' flares (tunable): how strongly they glow (1: full, lower: see-through). */
export const VEHICLE_FLARE = { opacity: 0.6 };

/**
 * A lamp's glow seen from off its axis (tunable, degrees): full within `full` of straight ahead of it, fading out
 * to none at `gone` (a lamp's reflector throws its light forward: from beside it, little; from behind, none).
 */
export const FLARE_AIM = { full: 55, gone: 95 };

/** How much of a lamp's glow shows from a direction `cos` (the cosine of its angle off the lamp's axis). */
export function flareFacing(cos: number): number {
  const full = Math.cos(THREE.MathUtils.degToRad(FLARE_AIM.full));
  const gone = Math.cos(THREE.MathUtils.degToRad(FLARE_AIM.gone));
  const t = Math.min(1, Math.max(0, (cos - gone) / (full - gone)));
  return t * t * (3 - 2 * t);
}

/**
 * A dynamic batch of flares rebuilt every frame (moving vehicles), each aimed as its lamp; in `scene`, depth tested,
 * or (`depth`: a FlarePass's, `scene` its own) each faded whole by how much of it is hidden.
 */
export class LightFlares {
  readonly material: THREE.ShaderMaterial;
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly aim: Float32Array;
  private n = 0;

  constructor(scene: THREE.Scene, private capacity = 2000, depth?: FlareDepth) {
    this.material = makeFlareMaterial(3, true, depth);
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.aim = new Float32Array(capacity * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aim', new THREE.BufferAttribute(this.aim, 3).setUsage(THREE.DynamicDrawUsage));
    const pts = new THREE.Points(this.geo, this.material);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    scene.add(pts);
  }

  begin(): void {
    this.n = 0;
  }

  /** A flare; `aim`, the way its lamp shines (world, unit; none: all round). */
  add(x: number, y: number, z: number, r: number, g: number, b: number, sizeM: number, aim?: THREE.Vector3): void {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    this.aim[i * 3] = aim ? aim.x : 0;
    this.aim[i * 3 + 1] = aim ? aim.y : 0;
    this.aim[i * 3 + 2] = aim ? aim.z : 0;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    this.size[i] = sizeM;
  }

  end(): void {
    this.geo.setDrawRange(0, this.n);
    const u = this.material.uniforms;
    u.opacity.value = VEHICLE_FLARE.opacity;
    u.aimFull.value = Math.cos(THREE.MathUtils.degToRad(FLARE_AIM.full));
    u.aimGone.value = Math.cos(THREE.MathUtils.degToRad(FLARE_AIM.gone));
    for (const name of ['position', 'color', 'size', 'aim']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }
}
