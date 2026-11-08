import { EarMotion } from './earMotion';
import { azimuthDeg, equalPowerMono, inverseDistanceGain, nearestWithin, type EarPose } from './pan';
import { dopplerFactor } from './spatial';

/** A vehicle heard by one steady loop from outside (its tyres, the wind past it): where, how it moves this frame. */
export interface LoopSource {
  /** Which (stable while it's around). */
  key: number;
  pos: [number, number, number];
  vel: [number, number, number];
  /** Its speed (m/s): the loop's level and rate by it (PlacedLoopSpec). */
  speed: number;
  /** How loud against the spec's own (1), and its pitch against it. */
  gain: number;
  pitch: number;
}

/** How a kind of loop is heard from outside. */
export interface PlacedLoopSpec {
  /** At most this many heard at once: the nearest. */
  voices: number;
  /** None heard beyond this (m). */
  range: number;
  /** Full volume within this (m), then the inverse law (each doubling of the distance -6 dB). */
  refDistance: number;
  /** Its level and its rate at a speed (m/s). */
  level(speed: number): number;
  rate(speed: number): number;
}

/** A voice's level's smoothing (s, time constant): rising and the frame's changes; let go, faded over RELEASE. */
const SMOOTH = 0.05;
const RELEASE = 0.4;
const PAN_SMOOTH = 0.02;
/** m/s: no vehicle goes this fast (a body faster: the physics blew up on it). */
const MAX_SOURCE_SPEED = 300;
const PAN = new Float32Array(2);

interface Voice {
  key: number;
  src: AudioBufferSourceNode;
  level: GainNode;
  left: GainNode;
  right: GainNode;
  merge: ChannelMergerNode;
  assigned: boolean;
  releaseAt: number;
}

const finite = (s: LoopSource): boolean =>
  Number.isFinite(s.speed) && Number.isFinite(s.gain) && Number.isFinite(s.pitch) && s.pos.every(Number.isFinite)
  && s.vel.every(Number.isFinite) && Math.hypot(s.vel[0], s.vel[1], s.vel[2]) < MAX_SOURCE_SPEED;

/**
 * One steady loop for each vehicle around (the traffic's tyres: rolling.ts; the rivals' wind: wind.ts), as the
 * others' engines are heard (otherEngines.ts): the nearest `spec.voices` within its range, each its own loop of the
 * recording (from its own random point: two never sound as one), panned by hand, fading with distance,
 * Doppler-shifted against the ear's own motion.
 */
export class PlacedLoops {
  private readonly voices: Voice[] = [];
  private readonly motion = new EarMotion();
  private readonly earPos: [number, number, number] = [0, 0, 0];
  private readonly near: Int32Array;
  private readonly nearD: Float64Array;

  constructor(
    private readonly ctx: AudioContext,
    private readonly buffer: AudioBuffer,
    private readonly out: AudioNode,
    private readonly spec: PlacedLoopSpec,
  ) {
    this.near = new Int32Array(spec.voices);
    this.nearD = new Float64Array(spec.voices);
  }

  /**
   * This frame's (the first `count` of `sources`), heard from the camera at `ear` (`dt` the race's time since the
   * last frame; `timeScale` how fast it runs, every rate by it; `active` false: all let go).
   */
  update(sources: readonly LoopSource[], count: number, ear: EarPose, dt: number, timeScale: number, active: boolean): void {
    if (!Object.values(ear).every(Number.isFinite)) return;
    const spec = this.spec;
    this.earPos[0] = ear.px; this.earPos[1] = ear.py; this.earPos[2] = ear.pz;
    this.motion.update(this.earPos, dt);
    for (const v of this.voices) v.assigned = false;
    const n = active ? nearestWithin(sources, count, ear, spec.range, this.near, this.nearD) : 0;
    const now = this.ctx.currentTime;
    for (let k = 0; k < n; k++) {
      const s = sources[this.near[k]];
      if (!finite(s)) continue;
      let v = this.voices.find((x) => x.key === s.key);
      const fresh = !v;
      v ??= this.add(s.key);
      v.assigned = true;
      v.releaseAt = -1;
      equalPowerMono(azimuthDeg(s.pos[0], s.pos[1], s.pos[2], ear), inverseDistanceGain(Math.sqrt(this.nearD[k]), spec.refDistance, 1), PAN);
      if (fresh) {
        v.left.gain.setValueAtTime(PAN[0], now);
        v.right.gain.setValueAtTime(PAN[1], now);
      } else {
        v.left.gain.setTargetAtTime(PAN[0], now, PAN_SMOOTH);
        v.right.gain.setTargetAtTime(PAN[1], now, PAN_SMOOTH);
      }
      v.level.gain.setTargetAtTime(spec.level(s.speed) * s.gain, now, SMOOTH);
      const rate = spec.rate(s.speed) * s.pitch * dopplerFactor(s.pos, s.vel, this.earPos, this.motion.velocity) * timeScale;
      v.src.playbackRate.setTargetAtTime(rate, now, SMOOTH);
    }
    for (const v of [...this.voices]) {
      if (v.assigned) continue;
      if (v.releaseAt < 0) {
        v.releaseAt = now + RELEASE;
        v.level.gain.setTargetAtTime(0, now, RELEASE / 3);
      } else if (now >= v.releaseAt) this.drop(v);
    }
  }

  /** All dropped at once (a race restarting), and the ear's motion forgotten. */
  clear(): void {
    for (const v of [...this.voices]) this.drop(v);
    this.motion.reset();
  }

  private add(key: number): Voice {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(), level = ctx.createGain();
    const left = ctx.createGain(), right = ctx.createGain(), merge = ctx.createChannelMerger(2);
    src.buffer = this.buffer;
    src.loop = true;
    level.gain.value = 0;
    left.gain.value = right.gain.value = 0;
    src.connect(level);
    level.connect(left).connect(merge, 0, 0);
    level.connect(right).connect(merge, 0, 1);
    merge.connect(this.out);
    src.start(ctx.currentTime, Math.random() * this.buffer.duration);
    const v: Voice = { key, src, level, left, right, merge, assigned: true, releaseAt: -1 };
    this.voices.push(v);
    return v;
  }

  private drop(v: Voice): void {
    v.src.stop();
    for (const n of [v.src, v.level, v.left, v.right, v.merge]) n.disconnect();
    this.voices.splice(this.voices.indexOf(v), 1);
  }
}
