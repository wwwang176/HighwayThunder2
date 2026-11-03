import * as THREE from 'three';
import type { Touch } from '../physics/physicsWorld';

/** Collision sparks (tunable). */
export const SPARKS = {
  /** Sliding slower than this (m/s) throws none. */
  minSlide: 2,
  /** Sparks a second, per m/s of sliding over minSlide, while two things scrape. */
  rate: 14,
  /** A hit's burst: per m/s of the surfaces' relative speed, at most `burstMax`. */
  burst: 2,
  burstMax: 50,
  /** Life, s (each one between these). */
  life: [0.15, 0.35] as const,
  /** Air drag on the bits, 1/s. */
  drag: 1.5,
  /**
   * Where between the two surfaces' velocities a spark leaves (0: the second's, 1: the first's), each between
   * these; below 0, flung on past the second (scraping a rail, back past it, off the car faster than it slides).
   */
  fling: [-0.25, 0.6] as const,
  /** Scatter about the slide's direction, times the sliding speed. */
  spread: 0.18,
  /** Kick off the contact (along its normal), at most, times the sliding speed. */
  kick: 0.12,
  /** All of the above, times this: how fast they leave the contact (relative to the surfaces' mean motion). */
  speed: 2,
  /** Of a vertical speed, what a bounce off the road keeps. */
  bounce: 0.35,
};

const MAX = 1500;
const G = -9.81;
/** A streak's length: how far it moves in this long (motion blur), within these. */
const STREAK_T = 0.022;
const STREAK_MIN = 0.08;
const STREAK_MAX = 1.6;
const RADIUS = 0.011;

/** How fast two surfaces slide over each other: their relative velocity across the normal `n`. */
export function slideSpeed(va: THREE.Vector3, vb: THREE.Vector3, n: THREE.Vector3): number {
  const rx = va.x - vb.x;
  const ry = va.y - vb.y;
  const rz = va.z - vb.z;
  const d = rx * n.x + ry * n.y + rz * n.z;
  return Math.hypot(rx - d * n.x, ry - d * n.y, rz - d * n.z);
}

/** How many sparks a scrape throws in `dt` s, on average. */
export function scrapeSparks(slide: number, dt: number): number {
  return SPARKS.rate * Math.max(0, slide - SPARKS.minSlide) * dt;
}

/** How many sparks a hit throws at once, the surfaces' relative speed `rel` (m/s). */
export function burstSparks(rel: number): number {
  return rel < SPARKS.minSlide ? 0 : Math.min(SPARKS.burstMax, Math.round(SPARKS.burst * rel));
}

const UNIT_Z = new THREE.Vector3(0, 0, 1);
const M = new THREE.Matrix4();
const P = new THREE.Vector3();
const D = new THREE.Vector3();
const S = new THREE.Vector3();
const Q = new THREE.Quaternion();
const C = new THREE.Color();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Metal sparks where vehicles hit or scrape anything (each other, the rails, the road): bright streaks flung off
 * the contact along the way the surfaces slide, slowing in the air, falling and bouncing off the road, cooling
 * from white through orange as they die. A burst when two meet, a stream while they grind. One instanced draw.
 */
export class Sparks {
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(Infinity);
  private readonly life = new Float32Array(MAX).fill(1);
  private readonly mesh: THREE.InstancedMesh;
  private next = 0;
  /** The fraction of a spark owed (a slow scrape throws one every few steps). */
  private carry = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, 1, 3, 1, true).rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, HIDDEN);
      this.mesh.setColorAt(i, C.setRGB(0, 0, 0));
    }
    this.mesh.frustumCulled = false; // (its bounds are its first frame's)
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** A pair touching after a physics step of `dt` s (PhysicsWorld.touches). */
  touch(t: Touch, dt: number): void {
    const slide = slideSpeed(t.va, t.vb, t.normal);
    let n = scrapeSparks(slide, dt);
    if (t.fresh) n += burstSparks(Math.hypot(t.va.x - t.vb.x, t.va.y - t.vb.y, t.va.z - t.vb.z));
    this.carry += n;
    const whole = Math.floor(this.carry);
    this.carry -= whole;
    for (let k = 0; k < whole; k++) this.spawn(t, slide);
  }

  private spawn(t: Touch, slide: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const at = t.points[Math.floor(Math.random() * t.count)];
    // Off one surface or the other, at a speed between theirs or flung on past the slower one's: along the
    // slide, scattered (less up than across), kicked off the contact and up a little.
    const u = SPARKS.fling[0] + Math.random() * (SPARKS.fling[1] - SPARKS.fling[0]);
    const kick = (Math.random() < 0.5 ? -1 : 1) * Math.random() * SPARKS.kick * slide;
    const s = SPARKS.spread * slide;
    const o = i * 3;
    this.pos[o] = at.x;
    this.pos[o + 1] = Math.max(0.03, at.y);
    this.pos[o + 2] = at.z;
    const vx = t.vb.x + (t.va.x - t.vb.x) * u + (Math.random() - 0.5) * 2 * s + t.normal.x * kick;
    const vy = t.vb.y + (t.va.y - t.vb.y) * u + Math.random() * s * 0.35 + 0.3 + Math.random() * 1.2;
    const vz = t.vb.z + (t.va.z - t.vb.z) * u + (Math.random() - 0.5) * 2 * s + t.normal.z * kick;
    // Off the contact SPARKS.speed times as fast (as seen moving with the two surfaces' mean).
    const k = SPARKS.speed;
    this.vel[o] = (t.va.x + t.vb.x) / 2 * (1 - k) + vx * k;
    this.vel[o + 1] = (t.va.y + t.vb.y) / 2 * (1 - k) + vy * k;
    this.vel[o + 2] = (t.va.z + t.vb.z) / 2 * (1 - k) + vz * k;
    this.age[i] = 0;
    this.life[i] = SPARKS.life[0] + Math.random() * (SPARKS.life[1] - SPARKS.life[0]);
  }

  /**
   * Moves them on `dt` s (each frame; 0 while paused). `view`: how the camera moves (its streaks are blurred
   * by how they move across the picture, not through the world).
   */
  update(dt: number, view: { x: number; y: number; z: number }): void {
    const damp = Math.exp(-SPARKS.drag * dt);
    let top = -1;
    for (let i = 0; i < MAX; i++) {
      const a = this.age[i];
      if (a === Infinity) continue;
      const na = a + dt;
      if (na >= this.life[i]) {
        this.age[i] = Infinity;
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      this.age[i] = na;
      const o = i * 3;
      let vx = this.vel[o] * damp;
      let vy = this.vel[o + 1] * damp + G * dt;
      let vz = this.vel[o + 2] * damp;
      let y = this.pos[o + 1] + vy * dt;
      if (y < 0.02 && vy < 0) {
        y = 0.02;
        vy = -vy * SPARKS.bounce;
        vx *= 0.7;
        vz *= 0.7;
      }
      this.pos[o] += vx * dt;
      this.pos[o + 1] = y;
      this.pos[o + 2] += vz * dt;
      this.vel[o] = vx;
      this.vel[o + 1] = vy;
      this.vel[o + 2] = vz;

      const rx = vx - view.x;
      const ry = vy - view.y;
      const rz = vz - view.z;
      const speed = Math.hypot(rx, ry, rz);
      if (speed > 1e-4) Q.setFromUnitVectors(UNIT_Z, D.set(rx / speed, ry / speed, rz / speed));
      else Q.identity();
      S.set(1, 1, THREE.MathUtils.clamp(speed * STREAK_T, STREAK_MIN, STREAK_MAX));
      // Its tail where it was: the streak trails behind it.
      P.set(this.pos[o], y, this.pos[o + 2]).addScaledVector(D, -S.z / 2);
      this.mesh.setMatrixAt(i, M.compose(P, Q, S));
      // Cooling: white-hot, yellow, orange, gone (additive: dark is see-through).
      const f = na / this.life[i];
      const k = 1 - f * f;
      this.mesh.setColorAt(i, C.setRGB(3 * k, (2.4 - 1.4 * f) * k, (1.6 - 1.5 * Math.min(1, f * 2)) * k));
      top = i;
    }
    this.mesh.count = top + 1;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.age.fill(Infinity);
    this.carry = 0;
    this.next = 0;
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, HIDDEN);
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
