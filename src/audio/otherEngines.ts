import type { EngineKind } from './engineCatalog';
import { EngineVoice } from './engineVoice';
import { EarMotion } from './earMotion';
import { azimuthDeg, equalPowerMono, inverseDistanceGain, nearestWithin, type EarPose } from './pan';
import { dopplerFactor } from './spatial';

/** An engine heard from outside: a rival's or the traffic's, where it is and what it's doing this frame. */
export interface EngineSource {
  /** Which vehicle (stable while it's around). */
  key: number;
  kind: EngineKind;
  pos: [number, number, number];
  vel: [number, number, number];
  rpm: number;
  idle: number;
  redline: number;
  throttle: number;
  /** How loud, against the others (1: a rival's). */
  gain: number;
}

/** At most this many heard at once: the nearest (grok-aircraft2's vehicles: 8). */
const VOICES = 8;
/** None heard beyond this (m). */
const RANGE = 220;
/** Full volume within this (m), then the inverse law (each doubling of the distance -6 dB). */
const REF_DISTANCE = 10;
const ROLLOFF = 1;
/** Rising (a new one, or one called back while fading): its volume's time constant, s. Not at once: it'd pop up. */
const ATTACK = 0.1;
/** Let go: faded over this long (s; time constant a third of it), then dropped. */
const RELEASE = 0.4;
/** The pan's smoothing (s, time constant): about a frame, so a car flashing past doesn't step across. */
const PAN_SMOOTH = 0.02;
/** Pan changes under this aren't sent (about -60 dB): hundreds of events a frame saved, none heard. */
const PAN_EPSILON = 1e-3;

interface Heard {
  key: number;
  voice: EngineVoice;
  /** Its two gains, left and right (the pan and the distance's attenuation), into the stereo merger. */
  left: GainNode;
  right: GainNode;
  merge: ChannelMergerNode;
  last: Float32Array;
  /** Still wanted this frame. */
  assigned: boolean;
  /** When its fade-out ends (-1: not fading). */
  releaseAt: number;
}

/** Whether every number of a source is one (none NaN or infinite). */
function finiteSource(s: EngineSource): boolean {
  // (and its speed one a car can have: blown up, a body's numbers ran past what a float32 AudioParam holds)
  return Number.isFinite(s.rpm) && Number.isFinite(s.throttle) && Number.isFinite(s.gain) && Number.isFinite(s.idle) && Number.isFinite(s.redline)
    && s.pos.every(Number.isFinite) && s.vel.every(Number.isFinite) && Math.hypot(s.vel[0], s.vel[1], s.vel[2]) < MAX_SOURCE_SPEED;
}
/** m/s: no car goes this fast (a body faster: the physics blew up on it). */
const MAX_SOURCE_SPEED = 300;

const NEAR = new Int32Array(VOICES);
const NEAR_D = new Float64Array(VOICES);
const PAN = new Float32Array(2);

/**
 * The engines around the player, each from where it is (as grok-aircraft2 places its sounds): the nearest VOICES
 * within RANGE, each its own engine voice, panned by hand (pan.ts: azimuth, equal power, inverse distance; no
 * PannerNode) and pitched by its Doppler factor against the ear's own motion (EarMotion: the camera's).
 */
export class OtherEngines {
  private readonly heard: Heard[] = [];
  private readonly motion = new EarMotion();
  private readonly ear: EarPose = { px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };
  private readonly earPos: [number, number, number] = [0, 0, 0];

  constructor(
    private readonly ctx: AudioContext,
    private readonly bank: Map<string, AudioBuffer>,
    private readonly out: AudioNode,
  ) {}

  /**
   * This frame's engines (the first `count` of `sources`), heard from the camera at `ear` (`dt`: the race's time
   * since the last frame, 0 paused; `timeScale` how fast the race's time runs, every rate by it; `active` false:
   * all let go).
   */
  update(sources: readonly EngineSource[], count: number, ear: EarPose, dt: number, timeScale: number, active: boolean): void {
    // (The ear not where numbers say - the camera blown up with a body it follows: nothing set this frame.)
    if (!Object.values(ear).every(Number.isFinite)) return;
    Object.assign(this.ear, ear);
    this.earPos[0] = ear.px; this.earPos[1] = ear.py; this.earPos[2] = ear.pz;
    this.motion.update(this.earPos, dt);
    for (const h of this.heard) h.assigned = false;
    const n = active ? this.nearest(sources, count) : 0;
    const now = this.ctx.currentTime;
    for (let k = 0; k < n; k++) {
      const s = sources[NEAR[k]];
      if (!finiteSource(s)) continue; // (a body the physics blew up on: let go - a NaN set on a gain throws)
      let h = this.heard.find((x) => x.key === s.key);
      if (h && h.voice.kind !== s.kind) {
        this.drop(h);
        h = undefined;
      }
      const fresh = !h;
      if (!h) h = this.add(s);
      const rising = fresh || h.releaseAt >= 0;
      h.assigned = true;
      h.releaseAt = -1;
      const d = Math.sqrt(NEAR_D[k]);
      equalPowerMono(azimuthDeg(s.pos[0], s.pos[1], s.pos[2], this.ear), inverseDistanceGain(d, REF_DISTANCE, ROLLOFF), PAN);
      this.pan(h, now, fresh ? 0 : PAN_SMOOTH);
      const doppler = dopplerFactor(s.pos, s.vel, this.earPos, this.motion.velocity);
      h.voice.update(s.rpm, s.idle, s.redline, s.throttle, s.gain, doppler * timeScale, rising ? ATTACK : undefined);
    }
    // The rest: faded out, then dropped.
    for (const h of [...this.heard]) {
      if (h.assigned) continue;
      if (h.releaseAt < 0) {
        h.releaseAt = now + RELEASE;
        h.voice.update(0, 0, 1, 0, 0, timeScale, RELEASE / 3);
      } else if (now >= h.releaseAt) this.drop(h);
    }
  }

  /** All dropped at once (a race restarting), and the ear's motion forgotten. */
  clear(): void {
    for (const h of [...this.heard]) this.drop(h);
    this.motion.reset();
  }

  /** The nearest VOICES of the sources within RANGE (indices into NEAR, squared distances into NEAR_D, by distance). */
  private nearest(sources: readonly EngineSource[], count: number): number {
    return nearestWithin(sources, count, this.ear, RANGE, NEAR, NEAR_D);
  }

  private add(s: EngineSource): Heard {
    const ctx = this.ctx;
    const merge = ctx.createChannelMerger(2);
    const left = ctx.createGain(), right = ctx.createGain();
    left.gain.value = 0;
    right.gain.value = 0;
    left.connect(merge, 0, 0);
    right.connect(merge, 0, 1);
    merge.connect(this.out);
    const voice = new EngineVoice(ctx, this.bank, s.kind, left);
    voice.output.connect(right);
    const h: Heard = { key: s.key, voice, left, right, merge, last: new Float32Array(2).fill(Number.NaN), assigned: true, releaseAt: -1 };
    this.heard.push(h);
    return h;
  }

  private drop(h: Heard): void {
    h.voice.dispose();
    h.left.disconnect();
    h.right.disconnect();
    h.merge.disconnect();
    this.heard.splice(this.heard.indexOf(h), 1);
  }

  /** Its left/right gains to PAN (`smooth` 0: at once - a voice starting isn't to slide in from elsewhere). */
  private pan(h: Heard, now: number, smooth: number): void {
    const gains = [h.left.gain, h.right.gain];
    for (let i = 0; i < 2; i++) {
      const v = PAN[i], p = gains[i];
      if (smooth <= 0) {
        p.cancelScheduledValues(now);
        p.setValueAtTime(v, now);
      } else {
        if (Math.abs(v - h.last[i]) <= PAN_EPSILON) continue;
        p.setTargetAtTime(v, now, smooth);
      }
      h.last[i] = v;
    }
  }
}
