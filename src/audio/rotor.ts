import { azimuthDeg, type EarPose, equalPowerMono, inverseDistanceGain } from './pan';

/** The rotor's recording's bundle (built in the private audio repo; git-ignored: docs/sound.md): clip `rotor`. */
export const ROTOR_BUNDLE_URL = 'audio/rotor.bin';

/**
 * The police helicopter's rotor: a recording of one hovering, one seamless lap of it looped (its clip at -16.7 LUFS),
 * heard as loud as `volume` at `ref` m, quieter by inverse distance (`rolloff`), none past `range` m.
 */
export const ROTOR = { volume: 0.45, ref: 40, rolloff: 1, range: 900 };

/** Its playback rate: its Doppler factor at the race's `timeScale` (slow motion: slower and deeper), never quite 0. */
export function rotorRate(doppler: number, timeScale: number): number {
  return Math.max(0.05, doppler * timeScale);
}

/** Its loudness `distance` m off, times `loud` (the game's: half in a bust's slow motion). See ROTOR. */
export function rotorGain(distance: number, loud: number): number {
  return distance < ROTOR.range ? loud * ROTOR.volume * inverseDistanceGain(distance, ROTOR.ref, ROTOR.rolloff) : 0;
}

/** The rotor's voice: its recording looped, placed by hand (pan.ts), played at rotorRate. */
export class Rotor {
  private readonly loop: AudioBufferSourceNode;
  private readonly left: GainNode;
  private readonly right: GainNode;
  private readonly merge: ChannelMergerNode;
  private readonly lr = new Float32Array(2);

  constructor(private readonly ctx: BaseAudioContext, clip: AudioBuffer, out: AudioNode) {
    this.loop = ctx.createBufferSource();
    this.loop.buffer = clip;
    this.loop.loop = true;
    this.left = ctx.createGain();
    this.right = ctx.createGain();
    this.left.gain.value = this.right.gain.value = 0;
    const merge = (this.merge = ctx.createChannelMerger(2));
    this.loop.connect(this.left).connect(merge, 0, 0);
    this.loop.connect(this.right).connect(merge, 0, 1);
    merge.connect(out);
    // (from anywhere in its lap: no two flights' alike)
    this.loop.start(0, Math.random() * clip.duration);
  }

  /**
   * Now: at `pos` (world), `doppler` its Doppler factor, the race at `timeScale` of its speed, `loud` times as loud
   * (rotorGain); `on` false: silent.
   */
  update(pos: readonly number[], ear: EarPose, doppler: number, timeScale: number, on: boolean, loud = 1): void {
    const now = this.ctx.currentTime;
    const d = Math.hypot(pos[0] - ear.px, pos[1] - ear.py, pos[2] - ear.pz);
    const gain = on && timeScale > 0 ? rotorGain(d, loud) : 0;
    equalPowerMono(azimuthDeg(pos[0], pos[1], pos[2], ear), gain, this.lr);
    this.left.gain.setTargetAtTime(this.lr[0], now, 0.08);
    this.right.gain.setTargetAtTime(this.lr[1], now, 0.08);
    this.loop.playbackRate.setTargetAtTime(rotorRate(doppler, timeScale), now, 0.05);
  }

  /** Stopped, and out of the graph (freed). */
  dispose(): void {
    this.loop.stop();
    this.loop.disconnect();
    this.left.disconnect();
    this.right.disconnect();
    this.merge.disconnect();
  }
}
