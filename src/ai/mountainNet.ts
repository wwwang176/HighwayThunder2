import { type Brain, createBrain, forward, weightCount } from './brain';
import type { Rng } from './rng';
import type { SelfState } from './sensors';
import type { HandlingInput } from '../vehicles/handling';
import type { Centerline } from '../road/centerline';

/**
 * The mountain road's driving network (docs/superpowers/specs/2026-11-16-mountain-planner-net-design.md §6.4): residual,
 * as the highway's (netTracker.ts) - its steer added to the mountain driver's own (its Stanley on the plan), its
 * throttle scaled by 1 + its second output; the brake the driver's. Its inputs all along the road (no highway
 * constants): the plan a moment ahead, the road's bend and slopes, the room either side, how the car moves.
 * Trained by training/mountainNet.train.ts; a car's weights in CarSpec.ai.mountainTracker.
 */

/** Plan look-aheads (s). */
const AHEAD = [0, 0.15, 0.3, 0.5];
export const MOUNTAIN_NET_INPUTS = AHEAD.length * 3 + 3 + 2 + 5 + 3 + 2;
export const MOUNTAIN_NET_LAYERS = [MOUNTAIN_NET_INPUTS, 12, 12, 2];

const clamp3 = (x: number) => (Number.isFinite(x) ? Math.max(-3, Math.min(3, x)) : 0);

/** Its inputs into `out` (MOUNTAIN_NET_INPUTS long): the plan's `d` and `kappa` along the road, `base` the driver's own input this step. */
export function mountainNetInputs(
  self: SelfState,
  plan: { d(s: number): number; kappa(s: number): number },
  road: Centerline,
  room: (s: number) => number,
  base: HandlingInput,
  out: Float32Array,
): Float32Array {
  const v = Math.max(0, self.vLong);
  let k = 0;
  for (const t of AHEAD) {
    const s = self.s + v * t;
    out[k++] = clamp3((plan.d(s) - self.d) / 2);
    out[k++] = clamp3(((plan.d(s + 1) - plan.d(s - 1)) / 2) * 5);
    out[k++] = clamp3(plan.kappa(s) * 20);
  }
  const s = Math.max(0, self.s);
  out[k++] = clamp3(road.curvature(s) * 20);
  out[k++] = clamp3(road.grade(s) * 5);
  out[k++] = clamp3(road.crossSlope(s) * 5);
  const r = room(self.s);
  out[k++] = clamp3((r + self.d) / 3); // (room on its left)
  out[k++] = clamp3((r - self.d) / 3); // (and on its right)
  out[k++] = clamp3(v / 40);
  out[k++] = clamp3(self.vLat / 5);
  out[k++] = clamp3(Math.atan2(self.vLat, Math.max(Math.abs(self.vLong), 1)) / 0.3);
  out[k++] = clamp3(self.yaw / 0.3);
  out[k++] = clamp3(self.yawRate);
  out[k++] = clamp3(self.wheel ?? base.steer);
  out[k++] = clamp3(base.steer);
  out[k++] = clamp3(base.throttle);
  out[k++] = clamp3((self.aLong ?? 0) / 10);
  out[k++] = clamp3((self.aLat ?? 0) / 10);
  return out;
}

/** A network that changes nothing: random hidden layers, its output layer all 0 (the training's start). */
export function quietMountainNet(rng: Rng): Brain {
  const b = createBrain(MOUNTAIN_NET_LAYERS, rng);
  const L = MOUNTAIN_NET_LAYERS;
  const lastLayer = (L[L.length - 2] + 1) * L[L.length - 1];
  b.weights.fill(0, b.weights.length - lastLayer);
  return b;
}

/** A car's weights as a network (none, or of another layout: none). */
export function mountainNetFrom(weights: number[] | undefined): Brain | null {
  if (!weights || weights.length !== weightCount(MOUNTAIN_NET_LAYERS)) return null;
  return { layers: MOUNTAIN_NET_LAYERS.slice(), weights: Float32Array.from(weights) };
}

const OUT = new Float32Array(2);

/** The driver's input with the network's correction: its steer added, its throttle scaled (1 + out), the brake as it was. */
export function applyMountainNet(brain: Brain | null, inputs: Float32Array, base: HandlingInput): HandlingInput {
  if (!brain) return base;
  const o = forward(brain, inputs, OUT);
  return {
    ...base,
    steer: Math.max(-1, Math.min(1, base.steer + o[0])),
    throttle: Math.max(0, Math.min(1, base.throttle * (1 + o[1]))),
  };
}
