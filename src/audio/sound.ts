import type { EngineKind } from './engineCatalog';
import { loadEngineBank } from './engineBank';
import { EngineVoice } from './engineVoice';

/** The player's engine, this loud (its clips are at -16 LUFS each). */
const ENGINE_VOLUME = 0.8;

/**
 * Web Audio: the player's engine (recorded, engineVoice; silent without the built sound bundle), procedural crash
 * bursts, tyre squeal and the near-miss whoosh.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineBus!: GainNode;
  private noise!: AudioBuffer;
  private skidGain!: GainNode;
  /** The engine clips (null: none to be had - no bundle - or not loaded yet). */
  private bank: Map<string, AudioBuffer> | null = null;
  private engine: EngineVoice | null = null;
  muted = false;

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    // Everything through a limiter (a fast, hard compressor just under full scale), so a crash on top of the engine
    // doesn't clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(limiter);

    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = ENGINE_VOLUME;
    this.engineBus.connect(this.master);
    void loadEngineBank(ctx).then((bank) => {
      this.bank = bank;
    });

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Tyre squeal: looping noise through a resonant band-pass, volume follows slip.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 6;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    src.connect(bp).connect(this.skidGain).connect(this.master);
    src.start();
  }

  /** Tyre slip speed in m/s (0 = gripping). */
  setSkid(slip: number): void {
    if (!this.ctx) return;
    const k = Math.min(1, Math.max(0, (slip - 1.5) / 10));
    this.skidGain.gain.setTargetAtTime(k * 0.35, this.ctx.currentTime, 0.04);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  suspend(on: boolean): void {
    if (!this.ctx) return;
    if (on) void this.ctx.suspend();
    else void this.ctx.resume();
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
    this.engine.update(rpm, idle, redline, throttle, active ? 1 : 0);
  }

  /** The player's engine silenced (until setEngine sounds it again). */
  silenceEngine(): void {
    this.engine?.update(0, 0, 1, 0, 0);
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

  crash(intensity: number): void {
    const k = Math.min(1, Math.max(0.15, intensity / 30));
    this.burst(0.25 + k * 0.5, 700, 'lowpass', 0.9 * k);
    this.burst(0.15, 2500, 'bandpass', 0.4 * k);
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
