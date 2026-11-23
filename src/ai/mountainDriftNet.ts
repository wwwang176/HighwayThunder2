import { clamp3 } from '../math';
import { type Brain, createBrain, forward, weightCount } from './brain';
import type { Rng } from './rng';
import type { DriveInput } from '../vehicles/handling';

/**
 * The mountain road's drift network: round a hairpin, after the kick (MountainDriver.driftView), on top of the
 * mountain driver's own drift - its wheel added to, its throttle moved up or down, its handbrake pulled or let go.
 * Trained (training/mountainNet.train.ts NET=drift) to slide further without hitting more walls; a car's weights in
 * CarSpec.ai.mountainDrift.
 */

/** What the driver sees round a hairpin (MountainDriver.driftView). */
export interface DriftView {
  /** Which way the bend turns (+1 right): its wheel in and out mirrored by it - a left-hand bend the mirror of a right-hand one. */
  dir: number;
  /** How far wide of its exit point it is going (m; -: inside it) - turning on as it turns now till it heads down the straight out - and how fast that is changing (m/s). */
  miss: number;
  missRate: number;
  /** Room to the inside's edge and the outside's (m). */
  roomIn: number;
  roomOut: number;
  /** Its slide into the bend (rad), its turning (rad/s; + into the bend), its speed across the road (m/s; + inward), its speed (m/s). */
  slide: number;
  yawRate: number;
  vIn: number;
  v: number;
  /** How far through the bend (0 at its start, 1 at its end), the bend's curvature (1/m), the time since the kick (s). */
  through: number;
  kappa: number;
  sinceKick: number;
}

export const DRIFT_NET_INPUTS = 14;
export const DRIFT_NET_LAYERS = [DRIFT_NET_INPUTS, 10, 3];


/**
 * Its inputs into `out` (DRIFT_NET_INPUTS long): what it sees, and the driver's own input this step - its wheel into
 * the bend (+), as all it sees: one network for both ways (not mirrored, it learned left-hand bends apart - its wheel in
 * 0.75 there, 0.97 in right-hand ones, and slid late into a quarter of the left-hand downhill hairpins).
 */
export function driftNetInputs(view: DriftView, base: DriveInput, out: Float32Array): Float32Array {
  let k = 0;
  out[k++] = clamp3(view.miss / 3);
  out[k++] = clamp3(view.missRate / 5);
  out[k++] = clamp3(view.roomIn / 3);
  out[k++] = clamp3(view.roomOut / 3);
  out[k++] = clamp3(view.slide / 0.6);
  out[k++] = clamp3(view.yawRate);
  out[k++] = clamp3(view.vIn / 5);
  out[k++] = clamp3(view.v / 25);
  out[k++] = clamp3(view.through * 2 - 1);
  out[k++] = clamp3(view.kappa * 20);
  out[k++] = clamp3(view.sinceKick);
  out[k++] = clamp3(view.dir * base.steer);
  out[k++] = clamp3(base.throttle);
  out[k++] = base.handbrake ? 1 : 0;
  return out;
}

/** A network that changes nothing: random hidden layer, its output layer all 0 (the training's start). */
export function quietDriftNet(rng: Rng): Brain {
  const b = createBrain(DRIFT_NET_LAYERS, rng);
  const L = DRIFT_NET_LAYERS;
  b.weights.fill(0, b.weights.length - (L[L.length - 2] + 1) * L[L.length - 1]);
  return b;
}

/** A car's weights as a drift network (none, or of another layout: none). */
export function driftNetFrom(weights: number[] | undefined): Brain | null {
  if (!weights || weights.length !== weightCount(DRIFT_NET_LAYERS)) return null;
  return { layers: DRIFT_NET_LAYERS.slice(), weights: Float32Array.from(weights) };
}

/** Its handbrake out past this pulls it, under minus this lets it go; between, the driver's own. */
export const DRIFT_NET_HB = 0.5;
const OUT = new Float32Array(3);

/**
 * The driver's input with the drift network's: its wheel added to (into the bend +: `dir` the bend's way, as its inputs),
 * its throttle moved (either way), its handbrake pulled or let go.
 */
export function applyDriftNet(brain: Brain | null, inputs: Float32Array, base: DriveInput, dir: number): DriveInput {
  if (!brain) return base;
  const o = forward(brain, inputs, OUT);
  return {
    ...base,
    steer: Math.max(-1, Math.min(1, base.steer + dir * o[0])),
    throttle: Math.max(0, Math.min(1, base.throttle + o[1])),
    handbrake: o[2] > DRIFT_NET_HB ? true : o[2] < -DRIFT_NET_HB ? false : base.handbrake,
  };
}
