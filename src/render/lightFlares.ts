import * as THREE from 'three';

/**
 * Soft glowing sprites for light sources (car head/tail lights, lamp heads).
 * Each sprite has a size in metres but never shrinks below a few pixels, so
 * distant lights stay visible and steady instead of shimmering in and out the
 * way sub-pixel geometry does. Additive; occluded by the depth buffer.
 */
export function makeFlareMaterial(minPx = 3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: { scale: { value: 600 }, minPx: { value: minPx }, opacity: { value: 1 } },
    vertexShader: `
      attribute vec3 color;
      attribute float size;
      uniform float scale;
      uniform float minPx;
      uniform float opacity;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float px = size * scale / max(-mv.z, 0.1);
        gl_PointSize = max(px, minPx);
        // Far lights shrink to a steady dot that dims a little with distance.
        vAlpha = px < minPx ? mix(0.55, 1.0, px / minPx) : 1.0;
        vAlpha *= clamp(1.0 - (-mv.z) / 1400.0, 0.0, 1.0) * opacity;
        vColor = color;
        gl_Position = projectionMatrix * mv;
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

/** A dynamic batch of flares rebuilt every frame (moving vehicles). */
export class LightFlares {
  readonly material = makeFlareMaterial(3);
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private n = 0;

  constructor(scene: THREE.Scene, private capacity = 2000) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const pts = new THREE.Points(this.geo, this.material);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    scene.add(pts);
  }

  begin(): void {
    this.n = 0;
  }

  add(x: number, y: number, z: number, r: number, g: number, b: number, sizeM: number): void {
    if (this.n >= this.capacity) return;
    const i = this.n++;
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
    this.material.uniforms.opacity.value = VEHICLE_FLARE.opacity;
    for (const name of ['position', 'color', 'size']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }
}
