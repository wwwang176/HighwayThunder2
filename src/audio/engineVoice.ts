import { ENGINE_CLIPS, ENGINE_SETS, type EngineKind } from './engineCatalog';
import { handovers, mixAt, soundRpm } from './engineMix';

/** How quickly the clips' speeds and volumes follow the rpm (s, time constant). */
const FOLLOW = 0.03;
/** ... and the throttle's swell. */
const THROTTLE_FOLLOW = 0.08;
/** A clip silent this long (s) is stopped (one sounding again starts afresh, at a random point of its loop). */
const IDLE_STOP = 1;
/** Off the throttle, the engine this loud (on: 1). */
const OFF_THROTTLE_GAIN = 0.55;

interface Layer {
  buffer: AudioBuffer;
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  silentSince: number;
}

/**
 * One engine's sound: its set's clips (engineCatalog), each a looping source through its own gain, mixed by the rpm
 * (engineMix) into `output`. Only the clips sounding are playing.
 */
export class EngineVoice {
  readonly kind: EngineKind;
  readonly output: GainNode;
  private readonly ctx: BaseAudioContext;
  private readonly layers: Layer[];
  private readonly rpms: number[];
  private readonly bands: [number, number][];
  private readonly pitch: number;
  private readonly gains: number[] = [];
  private readonly rates: number[] = [];

  constructor(ctx: BaseAudioContext, bank: Map<string, AudioBuffer>, kind: EngineKind, out: AudioNode) {
    this.ctx = ctx;
    this.kind = kind;
    const set = ENGINE_SETS[kind];
    this.pitch = set.pitch;
    this.rpms = set.clips.map((id) => ENGINE_CLIPS[id].rpm);
    this.bands = handovers(this.rpms);
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.output.connect(out);
    this.layers = set.clips.map((id) => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.output);
      return { buffer: bank.get(id)!, gain, src: null, silentSince: 0 };
    });
  }

  /**
   * The engine at `rpm` (its car's idle .. redline), `throttle` 0..1, at `volume` (0: silent, the clips stopped
   * after a while).
   */
  update(rpm: number, idle: number, redline: number, throttle: number, volume: number): void {
    const t = this.ctx.currentTime;
    mixAt(soundRpm(rpm, idle, redline, this.rpms), this.rpms, this.pitch, this.bands, this.gains, this.rates);
    this.output.gain.setTargetAtTime(volume * (OFF_THROTTLE_GAIN + (1 - OFF_THROTTLE_GAIN) * throttle), t, THROTTLE_FOLLOW);
    this.layers.forEach((L, i) => {
      const g = volume > 0 ? this.gains[i] : 0;
      if (g > 0) {
        if (!L.src) {
          L.src = this.ctx.createBufferSource();
          L.src.buffer = L.buffer;
          L.src.loop = true;
          L.src.playbackRate.value = this.rates[i];
          L.src.connect(L.gain);
          L.src.start(t, Math.random() * L.buffer.duration);
        }
        L.silentSince = t;
      } else if (L.src && t - L.silentSince > IDLE_STOP) {
        L.src.stop();
        L.src.disconnect();
        L.src = null;
      }
      if (L.src) L.src.playbackRate.setTargetAtTime(this.rates[i], t, FOLLOW);
      L.gain.gain.setTargetAtTime(g, t, FOLLOW);
    });
  }

  /** Its sources stopped, its nodes let go. */
  dispose(): void {
    for (const L of this.layers) {
      L.src?.stop();
      L.src?.disconnect();
      L.gain.disconnect();
    }
    this.output.disconnect();
  }
}
