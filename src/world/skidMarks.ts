import * as THREE from 'three';

const CAPACITY = 4000; // segments (ring buffer)
const WIDTH = 0.24;
const Y = 0.02;
const MIN_SEG = 0.25; // m between points
const MAX_JUMP = 3; // m: farther than this means the trail was interrupted

/**
 * Tyre marks left on the road while a tyre slides. Each wheel extends its own
 * strip; marks are stored in one ring-buffer geometry (one draw call) and the
 * oldest marks are overwritten.
 */
export class SkidMarks {
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private next = 0;
  private last = new Map<number, { x: number; z: number; lx: number; lz: number; rx: number; rz: number }>();

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(CAPACITY * 6 * 3);
    this.alpha = new Float32Array(CAPACITY * 6);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: `
        attribute float alpha;
        varying float vAlpha;
        #include <fog_pars_vertex>
        void main() {
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying float vAlpha;
        #include <fog_pars_fragment>
        void main() {
          // Black at vAlpha: the road under the mark keeps vAlpha less of its light,
          // like rubber lowering its albedo. (A fixed dark grey instead brightened
          // the road wherever it was darker than that grey, i.e. most of it at night.)
          gl_FragColor = vec4(0.0, 0.0, 0.0, vAlpha);
          #include <fog_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
  }

  /**
   * Report a wheel contact this step. `intensity` 0..1 (0 = not sliding).
   * `dirX/dirZ` is the wheel's heading on the ground (unit vector).
   */
  add(wheel: number, x: number, z: number, dirX: number, dirZ: number, intensity: number): void {
    if (intensity <= 0) {
      this.last.delete(wheel);
      return;
    }
    // Perpendicular to the wheel heading.
    const px = -dirZ * (WIDTH / 2);
    const pz = dirX * (WIDTH / 2);
    const cur = { x, z, lx: x - px, lz: z - pz, rx: x + px, rz: z + pz };
    const prev = this.last.get(wheel);
    if (!prev) {
      this.last.set(wheel, cur);
      return;
    }
    const d = Math.hypot(x - prev.x, z - prev.z);
    if (d > MAX_JUMP) {
      this.last.set(wheel, cur);
      return;
    }
    if (d < MIN_SEG) return;
    this.writeQuad(prev, cur, Math.min(0.7, 0.25 + intensity * 0.45));
    this.last.set(wheel, cur);
  }

  /** Break every trail (e.g. after a reset). */
  cut(): void {
    this.last.clear();
  }

  clear(): void {
    this.pos.fill(0);
    this.alpha.fill(0);
    this.next = 0;
    this.last.clear();
    this.markDirty();
  }

  private writeQuad(
    a: { lx: number; lz: number; rx: number; rz: number },
    b: { lx: number; lz: number; rx: number; rz: number },
    alpha: number,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % CAPACITY;
    const v = [a.lx, a.lz, a.rx, a.rz, b.rx, b.rz, a.lx, a.lz, b.rx, b.rz, b.lx, b.lz];
    for (let k = 0; k < 6; k++) {
      const o = (i * 6 + k) * 3;
      this.pos[o] = v[k * 2];
      this.pos[o + 1] = Y;
      this.pos[o + 2] = v[k * 2 + 1];
      this.alpha[i * 6 + k] = alpha;
    }
    this.markDirty();
  }

  private markDirty(): void {
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}
