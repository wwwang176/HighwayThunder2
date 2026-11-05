/**
 * The master limiter, on the audio thread (it can't import modules): the formula of src/audio/limiter.ts, line for
 * line - change one, change both. Lookahead: its output runs LOOKAHEAD behind its input, so its gain is down before
 * a peak arrives (what a DynamicsCompressorNode can't do).
 */
const LOOKAHEAD = 0.005;
const CEILING_DB = -1.5;
const RELEASE = 0.12;
const ATTACK = LOOKAHEAD / 6;
const CEILING = Math.pow(10, CEILING_DB / 20);

class WindowPeak {
  constructor(size) {
    this.size = size;
    this.vals = new Float32Array(size);
    this.ats = new Float64Array(size);
    this.head = 0;
    this.count = 0;
    this.n = 0;
  }

  push(mag) {
    const size = this.size;
    while (this.count > 0 && this.ats[this.head] <= this.n - size) {
      this.head = this.head + 1 === size ? 0 : this.head + 1;
      this.count--;
    }
    while (this.count > 0) {
      const back = (this.head + this.count - 1) % size;
      if (this.vals[back] > mag) break;
      this.count--;
    }
    const at = (this.head + this.count) % size;
    this.vals[at] = mag;
    this.ats[at] = this.n;
    this.count++;
    this.n++;
    return this.vals[this.head];
  }

  clear() {
    this.head = 0;
    this.count = 0;
    this.n = 0;
  }
}

class LimiterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const n = Math.max(1, Math.round(LOOKAHEAD * sampleRate));
    this.size = n;
    this.release = Math.exp(-1 / (RELEASE * sampleRate));
    this.attack = Math.exp(-1 / (ATTACK * sampleRate));
    this.delay = [];
    this.peaks = new WindowPeak(n);
    this.write = 0;
    this.gain = 1;
    // (on a resume: the buffer's few ms were scaled by the old fade - let out, they'd pop)
    this.port.onmessage = (e) => {
      if (e.data === 'reset') this.clear();
    };
  }

  clear() {
    for (const ch of this.delay) ch.fill(0);
    this.peaks.clear();
    this.write = 0;
    this.gain = 1;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (input === undefined || output === undefined) return true;
    const channels = Math.max(input.length, output.length);
    while (this.delay.length < channels) this.delay.push(new Float32Array(this.size));
    const frames = output[0] === undefined ? 0 : output[0].length;
    for (let i = 0; i < frames; i++) {
      const w = this.write;
      let mag = 0;
      for (let c = 0; c < channels; c++) {
        const src = input[c];
        const x = src === undefined ? 0 : src[i];
        const buf = this.delay[c];
        const delayed = buf[w];
        buf[w] = x;
        const dst = output[c];
        if (dst !== undefined) dst[i] = delayed;
        const a = x < 0 ? -x : x;
        if (a > mag) mag = a;
      }
      this.write = w + 1 === this.size ? 0 : w + 1;
      const peak = this.peaks.push(mag);
      // (one NaN sample would hold the gain at NaN for good: the whole mix silent, and no error)
      if (!(peak >= 0)) {
        this.clear();
        continue;
      }
      const target = peak > CEILING ? CEILING / peak : 1;
      const gain = this.gain;
      this.gain = target + (gain - target) * (target < gain ? this.attack : this.release);
      for (let c = 0; c < channels; c++) {
        const dst = output[c];
        if (dst === undefined) continue;
        const y = dst[i] * this.gain;
        dst[i] = y === y ? y : 0;
      }
    }
    return true;
  }
}

registerProcessor('ht2-limiter', LimiterProcessor);
