import { EarMotion } from './earMotion';
import { azimuthDeg, equalPowerMono, inverseDistanceGain, nearestWithin, type EarPose } from './pan';
import { dopplerFactor } from './spatial';

/**
 * The tyres rolling on the road: one recording (a car's road noise at ROLL_RECORDED m/s: effects.bin's `roll`, a
 * seamless loop), played for every vehicle - faster with its speed (its rate the speed over the recording's, as a
 * recording at that speed would be) and louder (ROLL_POWER: about +9 dB each doubling of the speed), none at a
 * standstill. The player's unplaced, as its engine; the others' each from where it is (OtherRolls).
 */
export const ROLL_RECORDED = 97 / 3.6; // m/s (60 mph)
/** The loudness's growth with the speed: the level as (speed / ROLL_RECORDED) to this. */
const ROLL_POWER = 1.5;
/** Under this speed (m/s) faded down to none (linearly): a car pulling away comes in, not on. */
const ROLL_FADE_IN = 3;
/** The level's ceiling (a car flat out: about 3x the recording's, +10 dB). */
const ROLL_LEVEL_MAX = 3;
/** The rate's bounds: slower the recording turns to a rumble, faster to a whine. */
const ROLL_RATE_MIN = 0.35;
const ROLL_RATE_MAX = 2.2;

/** How loud a vehicle's tyres roll at `speed` (m/s): 1 at the recording's speed. */
export function rollLevel(speed: number): number {
  const v = Math.max(0, speed);
  if (!Number.isFinite(v) || v === 0) return 0;
  const level = Math.min(ROLL_LEVEL_MAX, (v / ROLL_RECORDED) ** ROLL_POWER);
  return v < ROLL_FADE_IN ? level * (v / ROLL_FADE_IN) : level;
}

/** The recording's rate for a vehicle at `speed` (m/s): 1 at the recording's speed, within its bounds. */
export function rollRate(speed: number): number {
  const r = Math.max(0, speed) / ROLL_RECORDED;
  return Number.isFinite(r) ? Math.min(ROLL_RATE_MAX, Math.max(ROLL_RATE_MIN, r)) : 1;
}

/** A vehicle's tyres heard from outside: where they are, how they move this frame. */
export interface RollSource {
  /** Which (stable while it's around): one per vehicle, a container's trailer its own. */
  key: number;
  pos: [number, number, number];
  vel: [number, number, number];
  /** Its speed over the road (m/s). */
  speed: number;
  /** How loud against a car's (1), and its pitch against a car's (bigger, slower-turning tyres: lower). */
  gain: number;
  pitch: number;
}

/** At most this many heard at once: the nearest. */
const VOICES = 8;
/** None heard beyond this (m): road noise doesn't carry as an engine does. */
const RANGE = 150;
/** Full volume within this (m), then the inverse law (each doubling of the distance -6 dB). */
const REF_DISTANCE = 8;
/** A voice's level's smoothing (s, time constant): rising and the frame's changes; let go, faded over RELEASE. */
const SMOOTH = 0.05;
const RELEASE = 0.4;
const PAN_SMOOTH = 0.02;
/** m/s: no vehicle goes this fast (a body faster: the physics blew up on it). */
const MAX_SOURCE_SPEED = 300;

const NEAR = new Int32Array(VOICES);
const NEAR_D = new Float64Array(VOICES);
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

const finite = (s: RollSource): boolean =>
  Number.isFinite(s.speed) && Number.isFinite(s.gain) && Number.isFinite(s.pitch) && s.pos.every(Number.isFinite)
  && s.vel.every(Number.isFinite) && Math.hypot(s.vel[0], s.vel[1], s.vel[2]) < MAX_SOURCE_SPEED;

/**
 * The others' tyres (the rivals', the traffic's), as the others' engines are heard (otherEngines.ts): the nearest
 * VOICES within RANGE, each its own loop of the recording (from its own random point: two never sound as one),
 * panned by hand, fading with distance, Doppler-shifted against the ear's own motion.
 */
export class OtherRolls {
  private readonly voices: Voice[] = [];
  private readonly motion = new EarMotion();
  private readonly earPos: [number, number, number] = [0, 0, 0];

  constructor(
    private readonly ctx: AudioContext,
    private readonly buffer: AudioBuffer,
    private readonly out: AudioNode,
  ) {}

  /**
   * This frame's tyres (the first `count` of `sources`), heard from the camera at `ear` (`dt` the race's time since
   * the last frame; `timeScale` how fast it runs, every rate by it; `active` false: all let go).
   */
  update(sources: readonly RollSource[], count: number, ear: EarPose, dt: number, timeScale: number, active: boolean): void {
    if (!Object.values(ear).every(Number.isFinite)) return;
    this.earPos[0] = ear.px; this.earPos[1] = ear.py; this.earPos[2] = ear.pz;
    this.motion.update(this.earPos, dt);
    for (const v of this.voices) v.assigned = false;
    const n = active ? nearestWithin(sources, count, ear, RANGE, NEAR, NEAR_D) : 0;
    const now = this.ctx.currentTime;
    for (let k = 0; k < n; k++) {
      const s = sources[NEAR[k]];
      if (!finite(s)) continue;
      let v = this.voices.find((x) => x.key === s.key);
      const fresh = !v;
      v ??= this.add(s.key);
      v.assigned = true;
      v.releaseAt = -1;
      equalPowerMono(azimuthDeg(s.pos[0], s.pos[1], s.pos[2], ear), inverseDistanceGain(Math.sqrt(NEAR_D[k]), REF_DISTANCE, 1), PAN);
      if (fresh) {
        v.left.gain.setValueAtTime(PAN[0], now);
        v.right.gain.setValueAtTime(PAN[1], now);
      } else {
        v.left.gain.setTargetAtTime(PAN[0], now, PAN_SMOOTH);
        v.right.gain.setTargetAtTime(PAN[1], now, PAN_SMOOTH);
      }
      v.level.gain.setTargetAtTime(rollLevel(s.speed) * s.gain, now, SMOOTH);
      const rate = rollRate(s.speed) * s.pitch * dopplerFactor(s.pos, s.vel, this.earPos, this.motion.velocity) * timeScale;
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
