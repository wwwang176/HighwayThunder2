import { ENGINE_CLIPS, ENGINE_SETS, type EngineKind } from './engineCatalog';
import { atLimiter, handovers, mixAt, soundRpm } from './engineMix';

/** How quickly the clips' speeds and volumes follow the rpm (s, time constant). */
const FOLLOW = 0.03;
/** ... and the throttle's swell. */
const THROTTLE_FOLLOW = 0.08;

/** A clip's playback rate as an AudioParam takes it: a number, within what any engine sounds at (else as recorded). */
const playRate = (x: number) => (Number.isFinite(x) ? Math.min(Math.max(x, 0.01), 16) : 1);
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
 * (engineMix) into `output` - those on the throttle and those off it (overrunning) crossfaded by the throttle (as it
 * follows, THROTTLE_FOLLOW; equal power), the idle the same clip either way; on the rev limiter its limiter clip
 * instead. Only the clips sounding are playing. (A bundle without the revs off the throttle: those on it alone.)
 */
export class EngineVoice {
  readonly kind: EngineKind;
  readonly output: GainNode;
  private readonly ctx: BaseAudioContext;
  /** The revs on the throttle, then the limiter, then the revs off it (as many as on it; the idle's null: shared). */
  private readonly layers: (Layer | null)[];
  private readonly offThrottle: boolean;
  /** The throttle as it follows (0..1; NaN: not yet set), and when it was. */
  private load = NaN;
  private loadAt = 0;
  private readonly rpms: number[];
  private readonly bands: [number, number][];
  private readonly pitch: number;
  /** Its set's own loudness on top (EngineSet.gainDb, as a factor). */
  private readonly level: number;
  /** The limiter clip's rpm (it's the last of `layers`, after the revs). */
  private readonly limiterRpm: number;
  private readonly gains: number[] = [];
  private readonly rates: number[] = [];
  /** When it was last asked to sound (its volume above 0). */
  private quietSince = 0;
  /** Every clip of its set in the bundle (any missing: silent). */
  private readonly playable: boolean;

  constructor(ctx: BaseAudioContext, bank: Map<string, AudioBuffer>, kind: EngineKind, out: AudioNode) {
    this.ctx = ctx;
    this.kind = kind;
    const set = ENGINE_SETS[kind];
    this.pitch = set.pitch;
    this.level = 10 ** (set.gainDb / 20);
    this.rpms = set.clips.map((id) => ENGINE_CLIPS[id].rpm);
    this.bands = handovers(this.rpms);
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.output.connect(out);
    this.limiterRpm = ENGINE_CLIPS[set.limiter].rpm;
    const layer = (id: string): Layer => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.output);
      return { buffer: bank.get(id)!, gain, src: null, silentSince: 0 };
    };
    this.layers = [...set.clips, set.limiter].map(layer);
    // (a clip missing from the bundle - the catalog ahead of it, built apart: the set silent, not thrown on each frame)
    this.playable = [...set.clips, set.limiter].every((id) => bank.has(id));
    this.offThrottle = set.offClips.every((id) => bank.has(id));
    if (this.offThrottle) for (let i = 0; i < set.clips.length; i++) this.layers.push(set.offClips[i] === set.clips[i] ? null : layer(set.offClips[i]));
  }

  /**
   * The engine at `rpm` (its car's idle .. redline), `throttle` 0..1, at `volume` (0: silent, the clips stopped
   * after a while); `rateScale`: every clip that much faster on top (a Doppler shift, the race's time scale);
   * `follow`: how quickly its volume goes where it's set (s, time constant).
   */
  update(rpm: number, idle: number, redline: number, throttle: number, volume: number, rateScale = 1, follow = THROTTLE_FOLLOW): void {
    // Every number into a sane range first (a body the physics blew up on gave rpm and speeds past what a float32
    // AudioParam holds: setting one threw, in the frame's loop). Its range broken: nothing changed.
    if (!this.playable || !(Number.isFinite(idle) && Number.isFinite(redline) && redline > idle)) return;
    rpm = Number.isFinite(rpm) ? Math.min(Math.max(rpm, 0), redline * 1.5) : idle;
    throttle = Number.isFinite(throttle) ? Math.min(Math.max(throttle, 0), 1) : 0;
    volume = Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 4) : 0;
    rateScale = Number.isFinite(rateScale) ? Math.min(Math.max(rateScale, 0.05), 8) : 1;
    if (!(Number.isFinite(follow) && follow > 0)) follow = THROTTLE_FOLLOW;
    const t = this.ctx.currentTime;
    const s = soundRpm(rpm, idle, redline, this.rpms), n = this.rpms.length;
    mixAt(s, this.rpms, this.pitch, this.bands, this.gains, this.rates);
    // On the rev limiter: the limiter clip (the top rev, stuttering) in the revs' place, crossfaded as they follow.
    const limiting = atLimiter(rpm, redline, throttle);
    if (limiting) for (let i = 0; i < n; i++) this.gains[i] = 0;
    this.gains[n] = limiting ? 1 : 0;
    this.rates[n] = (s / this.limiterRpm) * this.pitch;
    // On the throttle or off it: each rev's two clips crossfaded by the throttle as it follows (the idle's one clip
    // either way, whole).
    if (this.offThrottle) {
      const k = Number.isNaN(this.load) ? 1 : 1 - Math.exp(-Math.max(0, t - this.loadAt) / THROTTLE_FOLLOW);
      this.load = Number.isNaN(this.load) ? throttle : this.load + (throttle - this.load) * k;
      this.loadAt = t;
      const on = Math.sin((this.load * Math.PI) / 2), off = Math.cos((this.load * Math.PI) / 2);
      for (let i = 0; i < n; i++) {
        const shared = this.layers[n + 1 + i] === null;
        this.gains[n + 1 + i] = shared ? 0 : this.gains[i] * off;
        this.rates[n + 1 + i] = this.rates[i];
        if (!shared) this.gains[i] *= on;
      }
    }
    this.output.gain.setTargetAtTime(volume * this.level * (OFF_THROTTLE_GAIN + (1 - OFF_THROTTLE_GAIN) * throttle), t, follow);
    // Silenced: its clips carry on under the fade (`follow`), and stop once it's been silent a while.
    if (volume > 0) this.quietSince = t;
    const stopped = t - this.quietSince > IDLE_STOP;
    this.layers.forEach((L, i) => {
      if (!L) return; // (the idle off the throttle: its one clip, on it)
      const g = stopped ? 0 : this.gains[i];
      if (g > 0 && (L.src || volume > 0)) {
        if (!L.src) {
          L.src = this.ctx.createBufferSource();
          L.src.buffer = L.buffer;
          L.src.loop = true;
          L.src.playbackRate.value = playRate(this.rates[i] * rateScale);
          L.src.connect(L.gain);
          L.src.start(t, Math.random() * L.buffer.duration);
        }
        L.silentSince = t;
      } else if (L.src && (stopped || t - L.silentSince > IDLE_STOP)) {
        L.src.stop();
        L.src.disconnect();
        L.src = null;
      }
      if (L.src) L.src.playbackRate.setTargetAtTime(playRate(this.rates[i] * rateScale), t, FOLLOW);
      L.gain.gain.setTargetAtTime(Number.isFinite(g) ? g : 0, t, FOLLOW);
    });
  }

  /** Its sources stopped, its nodes let go. */
  dispose(): void {
    for (const L of this.layers) {
      if (!L) continue;
      L.src?.stop();
      L.src?.disconnect();
      L.gain.disconnect();
    }
    this.output.disconnect();
  }
}
