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

/**
 * The roof horn the tone plays through: its driver clipping softly (`drive`), no lows below `cut` Hz (the horn's
 * mouth), louder at its fixed `peaks` (Hz, Q, dB - the wail's harmonics swelling as they sweep over them), little past
 * `top` Hz; `level` brings it back to the loudness the plain tone had.
 */
export const HORN = {
  drive: 2.2,
  cut: 450,
  peaks: [
    { f: 1150, q: 3, gain: 7 },
    { f: 2300, q: 4, gain: 5 },
    { f: 3400, q: 5, gain: 3 },
  ],
  top: 5000,
  level: 0.42, // (measured: the wail's RMS through the horn 2.4 times the plain tone's)
};

/** The driver's soft clip as a WaveShaper curve of `n` points over -1..1: tanh(drive·x), scaled to reach ±1. */
export function hornCurve(n: number, drive: number): Float32Array {
  const c = new Float32Array(n);
  const k = Math.tanh(drive);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(drive * ((2 * i) / (n - 1) - 1)) / k;
  return c;
}

/**
 * One siren's voice: placed by hand (pan.ts), pitched by the wail times the Doppler factor and the race's speed,
 * through its horn (HORN).
 */
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
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    const driver = ctx.createWaveShaper();
    driver.curve = hornCurve(1025, HORN.drive) as Float32Array<ArrayBuffer>;
    driver.oversample = '4x';
    const filter = (type: BiquadFilterType, f: number, q: number, gain = 0): BiquadFilterNode => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      n.gain.value = gain;
      return n;
    };
    let tone: AudioNode = mix.connect(driver).connect(filter('highpass', HORN.cut, 0.7));
    for (const p of HORN.peaks) tone = tone.connect(filter('peaking', p.f, p.q, p.gain));
    tone = tone.connect(filter('lowpass', HORN.top, 0.7));
    const level = ctx.createGain();
    level.gain.value = HORN.level;
    tone = tone.connect(level);
    this.left = ctx.createGain();
    this.right = ctx.createGain();
    this.left.gain.value = this.right.gain.value = 0;
    const merge = (this.merge = ctx.createChannelMerger(2));
    this.a.connect(mix);
    this.b.connect(mix);
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
