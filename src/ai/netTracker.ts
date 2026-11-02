import type { CarParams } from '../vehicles/handling';
import { Brain, createBrain, forward, weightCount } from './brain';
import { trackSteer } from './laneController';
import { Plan, planAt, PLANNER } from './planner';
import type { Rng } from './rng';
import type { SelfState } from './sensors';

/**
 * Steering along a plan by a small network on top of the plain tracker
 * (`baseSteer`): it adds a correction (-1..1) to its steering. The plain
 * tracker only answers to where the car is against the plan; the network also
 * sees where the plan goes next and how fast the car is already moving and
 * turning sideways - so it can start the counter-steer before a move ends
 * instead of swinging past. Trained per car type (training/tracker.train.ts).
 */

/** s ahead on the plan it sees where the plan is and how fast it moves sideways. */
export const TRACKER_LOOK = [0, 0.15, 0.3, 0.5];
export const TRACKER_INPUTS = 2 * TRACKER_LOOK.length + 7;
export const TRACKER_LAYERS = [TRACKER_INPUTS, 12, 12, 1];

const clamp = (x: number, m = 3) => Math.max(-m, Math.min(m, x));

/** The plain tracker's steering: Stanley aiming `PLANNER.trackerLead` s ahead on the plan. */
export function baseSteer(plan: Plan, age: number, self: SelfState, p: CarParams): number {
  const aim = planAt(plan, age + PLANNER.trackerLead);
  return trackSteer(aim.d, aim.dRate, self.d, self.yaw, self.vLong, self.vLat, p);
}

/** The network's inputs, each scaled to about -1..1. */
export function trackerInputs(plan: Plan, age: number, self: SelfState, base: number, out = new Float32Array(TRACKER_INPUTS)): Float32Array {
  let k = 0;
  for (const look of TRACKER_LOOK) {
    const at = planAt(plan, age + look);
    out[k++] = clamp((at.d - self.d) / 2); // m off it then (2 m: half a lane)
    out[k++] = clamp(at.dRate / 5); // m/s sideways it moves there
  }
  out[k++] = clamp((self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw)) / 5); // sideways speed now
  out[k++] = clamp(Math.atan2(self.vLat, Math.max(1, self.vLong)) / 0.1); // body slip
  out[k++] = clamp(self.yaw / 0.1);
  out[k++] = clamp(self.yawRate / 0.5);
  out[k++] = self.vLong / 80;
  out[k++] = self.wheel ?? 0;
  out[k++] = base;
  return out;
}

const inputs = new Float32Array(TRACKER_INPUTS);
const output = new Float32Array(1);

/** Steering (-1..1) along `plan`, `age` s after it was made. */
export function netSteer(b: Brain, plan: Plan, age: number, self: SelfState, p: CarParams): number {
  const base = baseSteer(plan, age, self, p);
  forward(b, trackerInputs(plan, age, self, base, inputs), output);
  return Math.max(-1, Math.min(1, base + output[0]));
}

/** Random weights but an output layer of zeros: steers exactly as the plain tracker until trained. */
export function quietTracker(rng: Rng): Brain {
  const b = createBrain(TRACKER_LAYERS, rng);
  const L = TRACKER_LAYERS;
  b.weights.fill(0, b.weights.length - (L[L.length - 2] + 1) * L[L.length - 1]);
  return b;
}

/** A car type's trained tracker (CarPerformance.tracker), or null if it has none for this layout. */
export function trackerFrom(weights: number[] | undefined): Brain | null {
  if (!weights || weights.length !== weightCount(TRACKER_LAYERS)) return null;
  return { layers: TRACKER_LAYERS.slice(), weights: Float32Array.from(weights) };
}
