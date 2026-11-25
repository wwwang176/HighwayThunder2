import { azimuthDeg, type EarPose, equalPowerMono, inverseDistanceGain } from './pan';

/**
 * The police helicopter's rotor, made here (no recording): its blades' slap - `blades` x `rotorHz` beats a second
 * (src/game/helicopter.ts HELI.rotorHz), the sound gated by each from silence - of noise between `noiseBand` Hz
 * (`noise` loud) over a `thumpHz` tone (`thump` loud), with its turbine's steady `whineHz` whine (`whine` loud).
 * Heard as loud as `volume` at `ref` m, quieter by inverse distance (`rolloff`), none past `range` m. (A rumble under
 * 420 Hz and a 55 Hz tone at first: almost all of it under 150 Hz, unheard on a laptop's speakers or most headphones
 * however loud.)
 */
export const ROTOR = {
  blades: 2, rotorHz: 5.5, noiseBand: [180, 1600] as const, noise: 3, thumpHz: 70, thump: 0.25, whineHz: 1150, whine: 0.035,
  volume: 0.65, ref: 40, rolloff: 1, range: 900,
};

/** The blades' beat (Hz): its pulse train's rate, at the race's `timeScale` and a Doppler factor. */
export function rotorBeat(doppler: number, timeScale: number): number {
  return ROTOR.blades * ROTOR.rotorHz * doppler * timeScale;
}

/** The rotor's voice: placed by hand (pan.ts), beating at rotorBeat. */
export class Rotor {
  private readonly noise: AudioBufferSourceNode;
  private readonly thump: OscillatorNode;
  private readonly beat: OscillatorNode;
  private readonly whine: OscillatorNode;
  private readonly left: GainNode;
  private readonly right: GainNode;
  private readonly merge: ChannelMergerNode;
  private readonly lr = new Float32Array(2);

  constructor(private readonly ctx: BaseAudioContext, out: AudioNode) {
    // A second of white noise, looped.
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = ROTOR.noiseBand[0];
    low.Q.value = 0.7;
    const high = ctx.createBiquadFilter();
    high.type = 'lowpass';
    high.frequency.value = ROTOR.noiseBand[1];
    high.Q.value = 0.7;
    const noiseLevel = ctx.createGain();
    noiseLevel.gain.value = ROTOR.noise;
    this.thump = ctx.createOscillator();
    this.thump.frequency.value = ROTOR.thumpHz;
    const thumpLevel = ctx.createGain();
    thumpLevel.gain.value = ROTOR.thump;
    // The beat: a pulse train (a blade going by: sharp up, slow down) gating the slap from silence (0..1).
    this.beat = ctx.createOscillator();
    const harmonics = 16;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let n = 1; n <= harmonics; n++) imag[n] = 1 / n; // (a sawtooth's: falling after each beat)
    this.beat.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    const level = ctx.createGain();
    level.gain.value = 0.5;
    this.beat.connect(depth).connect(level.gain);
    // The turbine's whine, steady (not gated).
    this.whine = ctx.createOscillator();
    this.whine.frequency.value = ROTOR.whineHz;
    const whineLevel = ctx.createGain();
    whineLevel.gain.value = ROTOR.whine;
    this.left = ctx.createGain();
    this.right = ctx.createGain();
    this.left.gain.value = this.right.gain.value = 0;
    const merge = (this.merge = ctx.createChannelMerger(2));
    this.noise.connect(low).connect(high).connect(noiseLevel).connect(level);
    this.thump.connect(thumpLevel).connect(level);
    this.whine.connect(whineLevel);
    for (const src of [level, whineLevel]) {
      src.connect(this.left);
      src.connect(this.right);
    }
    this.left.connect(merge, 0, 0);
    this.right.connect(merge, 0, 1);
    merge.connect(out);
    this.noise.start();
    this.thump.start();
    this.beat.start();
    this.whine.start();
  }

  /** Now: at `pos` (world), `doppler` its Doppler factor, the race at `timeScale` of its speed; `on` false: silent. */
  update(pos: readonly number[], ear: EarPose, doppler: number, timeScale: number, on: boolean): void {
    const now = this.ctx.currentTime;
    const d = Math.hypot(pos[0] - ear.px, pos[1] - ear.py, pos[2] - ear.pz);
    const gain = on && d < ROTOR.range && timeScale > 0 ? ROTOR.volume * inverseDistanceGain(d, ROTOR.ref, ROTOR.rolloff) : 0;
    equalPowerMono(azimuthDeg(pos[0], pos[1], pos[2], ear), gain, this.lr);
    this.left.gain.setTargetAtTime(this.lr[0], now, 0.08);
    this.right.gain.setTargetAtTime(this.lr[1], now, 0.08);
    const rate = Math.max(0.05, doppler * timeScale);
    this.beat.frequency.setTargetAtTime(rotorBeat(doppler, timeScale), now, 0.05);
    this.thump.frequency.setTargetAtTime(ROTOR.thumpHz * rate, now, 0.05);
    this.whine.frequency.setTargetAtTime(ROTOR.whineHz * rate, now, 0.05);
    this.noise.playbackRate.setTargetAtTime(rate, now, 0.05);
  }

  /** Stopped, and out of the graph (freed). */
  dispose(): void {
    this.noise.stop();
    this.thump.stop();
    this.beat.stop();
    this.whine.stop();
    this.noise.disconnect();
    this.thump.disconnect();
    this.beat.disconnect();
    this.whine.disconnect();
    this.left.disconnect();
    this.right.disconnect();
    this.merge.disconnect();
  }
}
