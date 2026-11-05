import type { EngineKind } from './engineCatalog';
import { EngineVoice } from './engineVoice';
import { dopplerFactor } from './spatial';

/** An engine heard from outside: a rival's or the traffic's, where it is and what it's doing this frame. */
export interface EngineSource {
  /** Which vehicle (stable while it's around). */
  key: string;
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

/** The ear: where (the camera), facing which way, moving how (the player's car it follows). */
export interface Ear {
  pos: [number, number, number];
  forward: [number, number, number];
  up: [number, number, number];
  vel: [number, number, number];
}

/** At most this many heard at once: the nearest. */
const VOICES = 8;
/** None heard beyond this (m). */
const RANGE = 220;
/** A voice let go fades out over this long (s) before it's dropped. */
const FADE = 0.25;

interface Heard {
  voice: EngineVoice;
  panner: PannerNode;
}

/**
 * The engines around the player, each from where it is: the nearest VOICES within RANGE, each its own engine voice
 * through a panner (direction and distance, from the ear), its pitch shifted by its Doppler factor.
 */
export class OtherEngines {
  private readonly heard = new Map<string, Heard>();

  constructor(
    private readonly ctx: AudioContext,
    private readonly bank: Map<string, AudioBuffer>,
    private readonly out: AudioNode,
  ) {}

  /** This frame's engines, heard from `ear` (`active` false: all silent). */
  update(sources: readonly EngineSource[], ear: Ear, active: boolean): void {
    this.placeEar(ear);
    const near = active
      ? sources
        .map((s) => ({ s, d: Math.hypot(s.pos[0] - ear.pos[0], s.pos[1] - ear.pos[1], s.pos[2] - ear.pos[2]) }))
        .filter((e) => e.d < RANGE)
        .sort((a, b) => a.d - b.d)
        .slice(0, VOICES)
        .map((e) => e.s)
      : [];
    const keep = new Set(near.map((s) => s.key));
    for (const [key, h] of this.heard) {
      if (keep.has(key)) continue;
      this.heard.delete(key);
      h.voice.update(0, 0, 1, 0, 0);
      setTimeout(() => {
        h.voice.dispose();
        h.panner.disconnect();
      }, FADE * 1000);
    }
    const t = this.ctx.currentTime;
    for (const s of near) {
      let h = this.heard.get(s.key);
      if (h && h.voice.kind !== s.kind) {
        h.voice.dispose();
        h.panner.disconnect();
        h = undefined;
      }
      if (!h) {
        const panner = new PannerNode(this.ctx, {
          panningModel: 'equalpower',
          distanceModel: 'inverse',
          refDistance: 6,
          rolloffFactor: 1.2,
          maxDistance: 10000,
          positionX: s.pos[0],
          positionY: s.pos[1],
          positionZ: s.pos[2],
        });
        panner.connect(this.out);
        h = { voice: new EngineVoice(this.ctx, this.bank, s.kind, panner), panner };
        this.heard.set(s.key, h);
      }
      h.panner.positionX.setTargetAtTime(s.pos[0], t, 0.02);
      h.panner.positionY.setTargetAtTime(s.pos[1], t, 0.02);
      h.panner.positionZ.setTargetAtTime(s.pos[2], t, 0.02);
      h.voice.update(s.rpm, s.idle, s.redline, s.throttle, s.gain, dopplerFactor(s.pos, s.vel, ear.pos, ear.vel));
    }
  }

  /** All dropped at once (a race restarting). */
  clear(): void {
    for (const h of this.heard.values()) {
      h.voice.dispose();
      h.panner.disconnect();
    }
    this.heard.clear();
  }

  private placeEar(ear: Ear): void {
    const l = this.ctx.listener, t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(ear.pos[0], t, 0.02);
      l.positionY.setTargetAtTime(ear.pos[1], t, 0.02);
      l.positionZ.setTargetAtTime(ear.pos[2], t, 0.02);
      l.forwardX.setTargetAtTime(ear.forward[0], t, 0.02);
      l.forwardY.setTargetAtTime(ear.forward[1], t, 0.02);
      l.forwardZ.setTargetAtTime(ear.forward[2], t, 0.02);
      l.upX.setTargetAtTime(ear.up[0], t, 0.02);
      l.upY.setTargetAtTime(ear.up[1], t, 0.02);
      l.upZ.setTargetAtTime(ear.up[2], t, 0.02);
    } else {
      // (older Safari: no AudioParams on the listener)
      l.setPosition(...ear.pos);
      l.setOrientation(...ear.forward, ...ear.up);
    }
  }
}
