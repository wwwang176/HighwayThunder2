/** Procedural Web Audio: engine drone, crash bursts and the near-miss whoosh. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineGain!: GainNode;
  private oscA!: OscillatorNode;
  private oscB!: OscillatorNode;
  private filter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private skidGain!: GainNode;
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
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.filter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.filter.connect(this.engineGain).connect(this.master);
    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator();
    this.oscB.type = 'square';
    const bGain = ctx.createGain();
    bGain.gain.value = 0.35;
    this.oscA.connect(this.filter);
    this.oscB.connect(bGain).connect(this.filter);
    this.oscA.start();
    this.oscB.start();

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

  /** Engine note follows the real engine rpm (gears, wheelspin, rev limiter). */
  setEngine(rpm: number, throttle: number, active: boolean): void {
    if (!this.ctx) return;
    const r = Math.min(1, Math.max(0, rpm / 7500));
    const f = 32 + r * 175;
    const t = this.ctx.currentTime;
    this.oscA.frequency.setTargetAtTime(f, t, 0.02);
    this.oscB.frequency.setTargetAtTime(f * 0.5, t, 0.02);
    this.filter.frequency.setTargetAtTime(450 + r * 1600 + throttle * 700, t, 0.04);
    this.engineGain.gain.setTargetAtTime(active ? 0.08 + throttle * 0.1 + r * 0.04 : 0, t, 0.06);
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
