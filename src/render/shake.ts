/**
 * Camera shakes, one at a time: a new shake smaller than what is left of the one going is dropped (a scrape
 * during a crash adds nothing); a bigger one takes over.
 *
 * Each has a direction (world space: a hit from the side shakes the camera sideways), a frequency, a swing
 * and how long it lasts; it fades evenly to nothing over that time (fading as the square of the time left,
 * a crash was over in its first few frames: hardly seen).
 * - `sine`: one swing and its echoes along its direction, from rest (a gear going in: a push, then settled);
 * - `noise`: smooth noise, mostly along its direction, a little across it (a crash). Value noise (random
 *   values on whole steps, smoothstep between them), never white noise: frame to frame the camera moves
 *   continuously, so it reads as a shake, not as dropped frames. Its clock runs on between shakes, so two
 *   crashes don't shake alike.
 * And a steady `rumble` beside them (rough ground), giving way to them.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Shake {
  /** Which way it swings (world space; its length is ignored). */
  dir: Vec3;
  /** Its largest swing, m. */
  amplitude: number;
  /** Swings (sine) or noise steps (noise) a second. */
  frequency: number;
  /** How long it lasts, s. */
  seconds: number;
  wave: 'sine' | 'noise';
  /** Noise: the swing across its direction, of the swing along it (default ACROSS). */
  across?: number;
}

/** Noise across the direction, of the swing along it. */
const ACROSS = 0.3;
/** The rumble's sway from side to side (world x: across the road), of its up and down (at half its frequency: the body rocking). */
const RUMBLE_SWAY = 1;
/** Its sway along the road (world z), of its up and down. */
const RUMBLE_SURGE = 0.3;
/**
 * The camera tilts with a sway (rad per m): moved sideways alone, still looking at the same point ahead of the
 * car, it is hardly seen to shake. The rumble's: 4 cm of sway, 1.4 degrees.
 */
const RUMBLE_ROLL = 0.6;
/** A noise shake's tilt (rad per m across it): a hard hit (0.4 m across), 3.4 degrees. */
const SHAKE_ROLL = 0.15;

/** A random value in [-1, 1] for a whole number (a hash: the same n, the same value). */
function hash(n: number): number {
  let h = Math.imul(n | 0, 0x27d4eb2d) ^ 0x165667b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x7fffffff - 1;
}

/**
 * Smooth noise in [-1, 1]; `channel` keeps the axes apart (shared, they'd move together: a line). Pushed out
 * toward its ends (x1.6, held at 1): plain value noise lingers near 0 and a shake reads weak.
 */
function noise(channel: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash(channel * 8191 + i);
  const b = hash(channel * 8191 + i + 1);
  return Math.max(-1, Math.min(1, 1.6 * (a + (b - a) * f * f * (3 - 2 * f))));
}

export class ShakeManager {
  private shake: Shake | null = null;
  private dir: Vec3 = { x: 0, y: 0, z: 0 };
  private side: Vec3 = { x: 0, y: 0, z: 0 };
  private up: Vec3 = { x: 0, y: 0, z: 0 };
  private t = 0; // since it started
  private clock = 0; // the noise's, never reset
  private rumbleSwing = 0;
  private rumbleFrequency = 0;
  private rumblePhase = 0; // its noise steps so far (summed: a changing frequency doesn't jump)

  /**
   * A steady shake, set every frame (0: none): mostly up and down, a little across - rough ground under the
   * wheels. It gives way to a shake bigger than it (and comes back as that one dies).
   */
  rumble(swing: number, frequency: number): void {
    this.rumbleSwing = swing;
    this.rumbleFrequency = frequency;
  }

  /** What is left of the shake going (its swing now at most), m. */
  level(): number {
    const s = this.shake;
    if (!s || this.t >= s.seconds) return 0;
    return s.amplitude * (1 - this.t / s.seconds);
  }

  /** Start `s` unless it's smaller than what is left of the shake going. Whether it started. */
  add(s: Shake): boolean {
    if (s.amplitude <= this.level()) return false;
    const n = Math.hypot(s.dir.x, s.dir.y, s.dir.z) || 1;
    const d = { x: s.dir.x / n, y: s.dir.y / n, z: s.dir.z / n };
    // Two directions square to it (for the noise across it): one level, one up from it.
    const flat = Math.hypot(d.x, d.z);
    this.side = flat > 1e-6 ? { x: -d.z / flat, y: 0, z: d.x / flat } : { x: 1, y: 0, z: 0 };
    this.up = {
      x: d.y * this.side.z - d.z * this.side.y,
      y: d.z * this.side.x - d.x * this.side.z,
      z: d.x * this.side.y - d.y * this.side.x,
    };
    this.shake = s;
    this.dir = d;
    this.t = 0;
    return true;
  }

  update(dt: number): void {
    this.clock += dt;
    this.rumblePhase += dt * this.rumbleFrequency;
    if (!this.shake) return;
    this.t += dt;
    if (this.t >= this.shake.seconds) this.shake = null;
  }

  /** The rumble's swing now, as far as the shake going leaves room for it: none while it's bigger, fading back in after. */
  private rumbleNow(): number {
    const room = this.rumbleSwing > 0 ? 1 - this.level() / this.rumbleSwing : 0;
    return room > 0 ? this.rumbleSwing * room : 0;
  }

  /** The camera's tilt now (rad, about its view direction). */
  roll(): number {
    let r = 0;
    const a = this.rumbleNow();
    if (a > 0) r += a * RUMBLE_SWAY * RUMBLE_ROLL * noise(5, this.rumblePhase / 2);
    const s = this.shake;
    if (s && s.wave === 'noise') r += this.level() * (s.across ?? ACROSS) * SHAKE_ROLL * noise(7, this.clock * s.frequency);
    return r;
  }

  /** The camera's offset now (world space, m). */
  offset(): Vec3 {
    const o = this.shakeOffset();
    const a = this.rumbleNow();
    if (a > 0) {
      o.x += a * RUMBLE_SWAY * noise(5, this.rumblePhase / 2);
      o.y += a * noise(4, this.rumblePhase);
      o.z += a * RUMBLE_SURGE * noise(6, this.rumblePhase / 2);
    }
    return o;
  }

  private shakeOffset(): Vec3 {
    const s = this.shake;
    const a = this.level();
    if (!s || a <= 0) return { x: 0, y: 0, z: 0 };
    if (s.wave === 'sine') {
      const k = a * Math.sin(2 * Math.PI * s.frequency * this.t);
      return { x: this.dir.x * k, y: this.dir.y * k, z: this.dir.z * k };
    }
    const t = this.clock * s.frequency;
    const across = s.across ?? ACROSS;
    const along = a * noise(1, t);
    const side = a * across * noise(2, t);
    const up = a * across * noise(3, t);
    return {
      x: this.dir.x * along + this.side.x * side + this.up.x * up,
      y: this.dir.y * along + this.side.y * side + this.up.y * up,
      z: this.dir.z * along + this.side.z * side + this.up.z * up,
    };
  }

  stop(): void {
    this.shake = null;
  }
}
