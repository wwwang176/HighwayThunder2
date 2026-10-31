import * as THREE from 'three';

const MAX = 700;
const LIFE = 1.6; // s

/**
 * Tyre smoke: soft grey puffs emitted where a tyre is sliding hard (burnouts,
 * lock-ups, slides). One Points draw call; particles grow, rise and fade.
 */
export class TireSmoke {
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(LIFE);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly geo = new THREE.BufferGeometry();
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
        #include <fog_pars_vertex>
        void main() {
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying float vAlpha;
        #include <fog_pars_fragment>
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          if (d > 0.25) discard;
          float soft = 1.0 - d * 4.0;
          gl_FragColor = vec4(0.86, 0.86, 0.88, vAlpha * soft * soft);
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

  update(dt: number): void {
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
  }

  clear(): void {
    this.age.fill(LIFE);
    this.alpha.fill(0);
    this.carry.clear();
  }
}
