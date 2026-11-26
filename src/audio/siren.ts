import { azimuthDeg, type EarPose, equalPowerMono, inverseDistanceGain } from './pan';

/**
 * A police car's siren, made here (no recording): a wail - the pitch rising from `lo` to `hi` Hz and falling back
 * once every `period` s - from two detuned oscillators, softened. Heard as loud as `volume` at `ref` m, quieter by
 * inverse distance (`rolloff`), none past `range` m.
 */
export const SIREN = { lo: 640, hi: 1380, period: 3.4, volume: 0.16, ref: 14, rolloff: 1, range: 450 };

/** The wail's pitch (Hz) `t` s into it: up over the first half (eased), down over the second. */
export function sirenPitch(t: number): number {
  const x = (((t / SIREN.period) % 1) + 1) % 1;
  const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
  return SIREN.lo + (SIREN.hi - SIREN.lo) * k;
}

/** One siren's voice: placed by hand (pan.ts), pitched by the wail times the Doppler factor and the race's speed. */
export class Siren {
  private readonly a: OscillatorNode;
  private readonly b: OscillatorNode;
  private readonly left: GainNode;
  private readonly right: GainNode;
  private readonly lr = new Float32Array(2);
  private readonly merge: ChannelMergerNode;

  constructor(private readonly ctx: BaseAudioContext, out: AudioNode) {
    this.a = ctx.createOscillator();
    this.b = ctx.createOscillator();
    this.a.type = 'sawtooth';
    this.b.type = 'square';
    this.b.detune.value = 9;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    tone.Q.value = 0.7;
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    this.left = ctx.createGain();
    this.right = ctx.createGain();
    this.left.gain.value = this.right.gain.value = 0;
    const merge = (this.merge = ctx.createChannelMerger(2));
    this.a.connect(mix);
    this.b.connect(mix);
    mix.connect(tone);
    tone.connect(this.left).connect(merge, 0, 0);
    tone.connect(this.right).connect(merge, 0, 1);
    merge.connect(out);
    this.a.start();
    this.b.start();
  }

  /**
   * Now: `t` s into its wail, at `pos` (world), `doppler` its Doppler factor, the race at `timeScale` of its speed;
   * `on` false: silent.
   */
  update(t: number, pos: readonly number[], ear: EarPose, doppler: number, timeScale: number, on: boolean): void {
    const now = this.ctx.currentTime;
    const d = Math.hypot(pos[0] - ear.px, pos[1] - ear.py, pos[2] - ear.pz);
    const gain = on && d < SIREN.range ? SIREN.volume * inverseDistanceGain(d, SIREN.ref, SIREN.rolloff) : 0;
    equalPowerMono(azimuthDeg(pos[0], pos[1], pos[2], ear), gain, this.lr);
    this.left.gain.setTargetAtTime(this.lr[0], now, 0.05);
    this.right.gain.setTargetAtTime(this.lr[1], now, 0.05);
    const f = sirenPitch(t) * doppler * timeScale;
    this.a.frequency.setTargetAtTime(f, now, 0.02);
    this.b.frequency.setTargetAtTime(f, now, 0.02);
  }

  /** Stopped, and out of the graph (freed). */
  dispose(): void {
    this.a.stop();
    this.b.stop();
    this.a.disconnect();
    this.b.disconnect();
    this.left.disconnect();
    this.right.disconnect();
    this.merge.disconnect();
  }
}
