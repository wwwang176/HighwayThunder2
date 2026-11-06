import { CRACKLE_COUNT, crackleClip, ENGINE_SETS, SKID_CLIP, type EngineKind } from './engineCatalog';
import { EFFECTS_BUNDLE_URL, loadEngineBank, loadSoundBank } from './engineBank';
import { loadCrashBank, type CrashClip } from './crashBank';
import { EngineVoice } from './engineVoice';
import { OtherEngines, type EngineSource } from './otherEngines';
import { azimuthDeg, equalPowerMono, inverseDistanceGain, type EarPose } from './pan';
// (its own file, never inlined as a data: URL - not every browser loads a worklet from one)
import limiterUrl from './limiter.worklet.js?url&no-inline';

/** The player's engine, this loud (its clips are at -16 LUFS each); the others' (each by its distance on top). */
const ENGINE_VOLUME = 0.8;
const OTHERS_VOLUME = 0.8;
/** The whole mix (everything summed) this loud: -6 dB of headroom, so the limiter steps in only on a pile-up. */
const MASTER = 0.5;
/** After a pause (or a tab coming back), everything fades back in over this (s): no pop. */
const RESUME_FADE = 0.8;
/** The start-up this loud (on the engine's own volume); played only if its clips are in within this (s). */
const STARTUP_VOLUME = 1;
const STARTUP_WAIT = 1;
/** A crash recording at full force (k = 1) this loud: -4 dB on its -12 LUFS. */
const CRASH_VOLUME = 10 ** (-4 / 20);
/** A crash's second recording, layered under the first this much quieter (dB). */
const CRASH_LAYER_DB = -6;
/** The tyre squeal at its fullest; the nitro's hiss while it burns, its start as it lights (each clip -16 LUFS). */
const SKID_VOLUME = 0.6;
const NITRO_VOLUME = 0.5;
const NITRO_START_VOLUME = 0.53;
/**
 * A backfire's crackle (each clip's loudest 0.4 s at -16 LUFS): the player's; another car's within BACKFIRE_REF m
 * (fading beyond it, inversely with distance, as the engines), none past BACKFIRE_RANGE m.
 */
const BACKFIRE_VOLUME = 0.7;
const BACKFIRE_OTHERS_VOLUME = 0.8;
const BACKFIRE_REF = 10;
const BACKFIRE_RANGE = 220;
const BACKFIRE_PAN = new Float32Array(2);

/** One of `size`, at random: not `last` (the same recording twice running is heard as one). */
function pickNoRepeat(size: number, last: number): number {
  if (size <= 1) return 0;
  const k = Math.floor(Math.random() * size);
  return k === last ? (k + 1 + Math.floor(Math.random() * (size - 1))) % size : k;
}

/**
 * Web Audio: the engines (recorded, engineVoice: the player's unplaced - straight into the mix, whichever way the
 * camera looks - the others' each from where it is, otherEngines; silent without the built sound bundle), the crashes
 * (recorded, crashBank; silent without their bundle), the tyre squeal (the pack's, with the engines), the nitro
 * (recorded: effects.bin; silent without it) and the near-miss whoosh. All of it through a lookahead limiter (limiter.worklet.js).
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private fade!: GainNode;
  private limiter: AudioWorkletNode | null = null;
  private engineBus!: GainNode;
  private noise!: AudioBuffer;
  private skidGain!: GainNode;
  private nitroGain!: GainNode;
  /** The nitro's clips (null: none to be had, or not loaded yet); its loop and the squeal's, once going. */
  private effects: Map<string, AudioBuffer> | null = null;
  private skidLoop: AudioBufferSourceNode | null = null;
  private nitroLoop: AudioBufferSourceNode | null = null;
  private nitroOn = false;
  /** The crackle last played: not the same one twice running. */
  private lastCrackle = -1;
  /** The engine clips (null: none to be had - no bundle - or not loaded yet). */
  private bank: Map<string, AudioBuffer> | null = null;
  /** The clips' loading (resolved once they're in, or known not to be had). */
  private bankLoaded: Promise<void> = Promise.resolve();
  private engine: EngineVoice | null = null;
  private others: OtherEngines | null = null;
  private othersBus!: GainNode;
  /** The crash recordings (null: none to be had, or not loaded yet), and the last one played (not twice running). */
  private crashes: CrashClip[] | null = null;
  private lastCrash = -1;
  /** How fast the race's time runs (the finish's slow motion): every engine's rate by it. */
  private timeScale = 1;
  muted = false;

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER;
    this.fade = ctx.createGain();
    this.master.connect(this.fade);
    // Straight out until the limiter's in (its module loads asynchronously, and may fail: then it stays out); out of
    // the way again if it ever fails (a failed worklet outputs silence for good - the whole mix gone).
    this.fade.connect(ctx.destination);
    void ctx.audioWorklet?.addModule(limiterUrl).then(() => {
      const node = new AudioWorkletNode(ctx, 'ht2-limiter', { outputChannelCount: [2] });
      node.onprocessorerror = () => {
        this.limiter = null;
        node.disconnect();
        this.fade.disconnect();
        this.fade.connect(ctx.destination);
      };
      this.fade.disconnect();
      this.fade.connect(node).connect(ctx.destination);
      this.limiter = node;
    }).catch(() => { this.limiter = null; });

    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = ENGINE_VOLUME;
    this.engineBus.connect(this.master);
    this.othersBus = ctx.createGain();
    this.othersBus.gain.value = OTHERS_VOLUME;
    this.othersBus.connect(this.master);
    // The tyre squeal and the nitro's hiss: their loops running from the start, silent until called for.
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.skidGain.connect(this.master);
    this.nitroGain = ctx.createGain();
    this.nitroGain.gain.value = 0;
    this.nitroGain.connect(this.master);
    this.bankLoaded = loadEngineBank(ctx).then((bank) => {
      this.bank = bank;
      if (bank) this.others = new OtherEngines(ctx, bank, this.othersBus);
      this.skidLoop = this.startLoop(bank?.get(SKID_CLIP.id), this.skidGain); // (the pack's, with the engines)
    });
    void loadCrashBank(ctx).then((clips) => { this.crashes = clips; });

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    void loadSoundBank(ctx, EFFECTS_BUNDLE_URL).then((effects) => {
      this.effects = effects;
      this.nitroLoop = this.startLoop(effects?.get('nitro'), this.nitroGain);
    });
  }

  /** A loop played on and on into `out` (null: no clip). */
  private startLoop(buffer: AudioBuffer | undefined, out: GainNode): AudioBufferSourceNode | null {
    if (!this.ctx || !buffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(out);
    src.start(0, Math.random() * buffer.duration);
    return src;
  }

  /**
   * The player's tyres' slip, m/s (its strongest sliding tyre's; 0 gripping): the squeal from 1.5 m/s, full at 11.5,
   * pitched with the race's time. Silent without its recording.
   */
  setSkid(slip: number): void {
    if (!this.ctx) return;
    const k = Math.min(1, Math.max(0, (slip - 1.5) / 10));
    this.skidGain.gain.setTargetAtTime(k * SKID_VOLUME, this.ctx.currentTime, 0.04);
    if (this.skidLoop) this.skidLoop.playbackRate.value = this.timeScale;
  }

  /**
   * Whether the player's nitro burns: as it lights, its start (once); while it burns, its hiss (in over ~0.3 s, out
   * over ~0.6 s). Silent without their recordings.
   */
  setNitro(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.nitroLoop) this.nitroLoop.playbackRate.value = this.timeScale;
    if (on === this.nitroOn) return;
    this.nitroOn = on;
    this.nitroGain.gain.setTargetAtTime(on ? NITRO_VOLUME : 0, ctx.currentTime, on ? 0.1 : 0.2);
    const start = this.effects?.get('nitro-start');
    if (!on || !start) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = start;
    src.playbackRate.value = this.timeScale;
    g.gain.value = NITRO_START_VOLUME;
    src.connect(g).connect(this.master);
    src.onended = () => g.disconnect();
    src.start();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER, this.ctx.currentTime, 0.05);
  }

  /** Paused (the whole context stopped) or going again: faded back in, the limiter's buffer cleared first. */
  suspend(on: boolean): void {
    if (!this.ctx) return;
    if (on) {
      void this.ctx.suspend();
      return;
    }
    if (this.ctx.state === 'running') return;
    // (its few ms of lookahead were scaled by the mix as it stopped: let out, they'd pop)
    this.limiter?.port.postMessage('reset');
    const g = this.fade.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.setTargetAtTime(1, now, RESUME_FADE / 4);
    void this.ctx.resume();
  }

  /** How fast the race's time runs (1: as it is; the finish's slow motion below): every engine pitched by it. */
  setTimeScale(scale: number): void {
    if (scale > 0) this.timeScale = scale;
  }

  /**
   * A backfire's crackle (one for its run of pops), one of the pack's at random (not the last one again), its pitch
   * ±3 % and with the race's time: the player's (`at` null) unplaced, as its engine; another car's (`at` its place)
   * placed from `ear` as the engines are (panned, fading with distance; none past
   * BACKFIRE_RANGE). Silent without the clips.
   */
  backfire(at: { x: number; y: number; z: number } | null, ear?: EarPose): void {
    const ctx = this.ctx, bank = this.bank;
    if (!ctx || !bank) return;
    const own = at === null;
    let gain = BACKFIRE_VOLUME;
    if (at) {
      if (!ear) return;
      const d = Math.hypot(at.x - ear.px, at.y - ear.py, at.z - ear.pz);
      if (d > BACKFIRE_RANGE) return;
      equalPowerMono(azimuthDeg(at.x, at.y, at.z, ear), inverseDistanceGain(d, BACKFIRE_REF, 1) * BACKFIRE_OTHERS_VOLUME, BACKFIRE_PAN);
      gain = 1;
    }
    const k = pickNoRepeat(CRACKLE_COUNT, this.lastCrackle);
    this.lastCrackle = k;
    const buffer = bank.get(crackleClip(k + 1).id);
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = (0.97 + Math.random() * 0.06) * this.timeScale;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    const nodes: AudioNode[] = [g];
    if (own) g.connect(this.master);
    else {
      const l = ctx.createGain(), r = ctx.createGain(), merge = ctx.createChannelMerger(2);
      l.gain.value = BACKFIRE_PAN[0];
      r.gain.value = BACKFIRE_PAN[1];
      g.connect(l).connect(merge, 0, 0);
      g.connect(r).connect(merge, 0, 1);
      merge.connect(this.master);
      nodes.push(l, r, merge);
    }
    src.onended = () => { for (const n of nodes) n.disconnect(); };
    src.start();
  }

  /**
   * The player's engine follows its real rpm (gears, wheelspin, rev limiter): `kind` the car's engine, `idle` and
   * `redline` its range. Silent until the clips are in (and for good without them).
   */
  setEngine(kind: EngineKind, rpm: number, idle: number, redline: number, throttle: number, active: boolean): void {
    if (!this.ctx || !this.bank) return;
    if (this.engine?.kind !== kind) {
      this.engine?.dispose();
      this.engine = new EngineVoice(this.ctx, this.bank, kind, this.engineBus);
    }
    this.engine.update(rpm, idle, redline, throttle, active ? 1 : 0, this.timeScale);
  }

  /**
   * The player's car starting up (its engine's start-up, once, unplaced). On the race's first start the clips may
   * still be loading: then it waits for them, if not for long (STARTUP_WAIT).
   */
  startup(kind: EngineKind): void {
    const asked = performance.now();
    void this.bankLoaded.then(() => {
      const ctx = this.ctx, buffer = this.bank?.get(ENGINE_SETS[kind].startup);
      if (!ctx || !buffer || performance.now() - asked > STARTUP_WAIT * 1000) return;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buffer;
      src.playbackRate.value = ENGINE_SETS[kind].pitch;
      g.gain.value = STARTUP_VOLUME;
      src.connect(g).connect(this.engineBus);
      src.onended = () => g.disconnect();
      src.start();
    });
  }

  /** The player's engine silenced (until setEngine sounds it again), and the others'. */
  silenceEngine(): void {
    this.engine?.update(0, 0, 1, 0, 0);
    this.others?.clear();
  }

  /**
   * The engines around the player (the rivals', the traffic's: the first `count` of `sources`), each heard from
   * where it is from `ear` (the camera; `dt` the race's time since the last frame): the nearest, panned, fading with
   * distance, Doppler-shifted. The player's own isn't among them: straight into the mix, never panned.
   */
  setOtherEngines(sources: readonly EngineSource[], count: number, ear: EarPose, dt: number, active: boolean): void {
    this.others?.update(sources, count, ear, dt, this.timeScale, active);
  }

  private burst(duration: number, freq: number, type: BiquadFilterType, gain: number, sweepTo?: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const t = ctx.currentTime;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration);
  }

  /**
   * A hit, `intensity` its closing speed (m/s): as loud as it was hard (full at 30 m/s, never under 0.15). Two of
   * the recordings at random, layered: the first (not the last hit's again), and another under it - CRASH_LAYER_DB
   * down, 0-30 ms later (in step it's one hit, fuller; as loud, or further apart, it'd be two). Their pitch a little
   * off each time (±4 %) and with the race's time (the finish's slow motion). Silent without them.
   */
  crash(intensity: number): void {
    const ctx = this.ctx, clips = this.crashes;
    if (!ctx || !clips) return;
    const k = Math.min(1, Math.max(0.15, intensity / 30));
    const first = pickNoRepeat(clips.length, this.lastCrash);
    this.lastCrash = first;
    const rate = (0.96 + Math.random() * 0.08) * this.timeScale;
    this.playCrash(clips[first], k, rate, 0);
    if (clips.length > 1) {
      this.playCrash(clips[pickNoRepeat(clips.length, first)], k * 10 ** (CRASH_LAYER_DB / 20), rate, Math.random() * 0.03);
    }
  }

  private playCrash(clip: CrashClip, k: number, rate: number, delay: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = clip.buffer;
    src.playbackRate.value = rate;
    g.gain.value = k * CRASH_VOLUME * clip.gain;
    src.connect(g).connect(this.master);
    src.onended = () => g.disconnect();
    src.start(ctx.currentTime + delay);
  }

  whoosh(): void {
    this.burst(0.35, 2500, 'bandpass', 0.5, 400);
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + 0.12);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
  }
}
