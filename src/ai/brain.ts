import { gaussian, Rng } from './rng';

/**
 * A small fully connected network (tanh on every layer). Weights are stored
 * layer by layer; each layer is `out` rows of `in` weights followed by a bias.
 */
export interface Brain {
  layers: number[];
  weights: Float32Array;
}

export function weightCount(layers: number[]): number {
  let n = 0;
  for (let l = 1; l < layers.length; l++) n += (layers[l - 1] + 1) * layers[l];
  return n;
}

/** Random weights, uniform in ±1/sqrt(inputs) per layer. */
export function createBrain(layers: number[], rng: Rng): Brain {
  const weights = new Float32Array(weightCount(layers));
  let k = 0;
  for (let l = 1; l < layers.length; l++) {
    const scale = 1 / Math.sqrt(layers[l - 1]);
    for (let i = 0; i < (layers[l - 1] + 1) * layers[l]; i++) weights[k++] = (rng() * 2 - 1) * scale;
  }
  return { layers: layers.slice(), weights };
}

export function cloneBrain(b: Brain): Brain {
  return { layers: b.layers.slice(), weights: Float32Array.from(b.weights) };
}

let bufA = new Float32Array(64);
let bufB = new Float32Array(64);

/** Run the network. Writes into `out` (allocated if missing) and returns it. */
export function forward(b: Brain, input: ArrayLike<number>, out?: Float32Array): Float32Array {
  const L = b.layers;
  const widest = Math.max(...L);
  if (bufA.length < widest) {
    bufA = new Float32Array(widest);
    bufB = new Float32Array(widest);
  }
  let src = bufA;
  let dst = bufB;
  for (let i = 0; i < L[0]; i++) src[i] = input[i];
  const w = b.weights;
  let k = 0;
  for (let l = 1; l < L.length; l++) {
    const nIn = L[l - 1];
    const nOut = L[l];
    for (let o = 0; o < nOut; o++) {
      let sum = 0;
      for (let i = 0; i < nIn; i++) sum += w[k++] * src[i];
      sum += w[k++];
      dst[o] = Math.tanh(sum);
    }
    const t = src;
    src = dst;
    dst = t;
  }
  const n = L[L.length - 1];
  const res = out ?? new Float32Array(n);
  for (let i = 0; i < n; i++) res[i] = src[i];
  return res;
}

/** A copy with each weight nudged by sigma·N(0,1), with probability `rate`. */
export function mutate(b: Brain, rng: Rng, sigma: number, rate: number): Brain {
  const c = cloneBrain(b);
  for (let i = 0; i < c.weights.length; i++) if (rng() < rate) c.weights[i] += sigma * gaussian(rng);
  return c;
}
