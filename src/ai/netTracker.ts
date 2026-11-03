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
export const TRACKER_INPUTS = 2 * TRACKER_LOOK.length + 9;
/** Outputs: a steering correction, and how much of the plan's throttle to take back (0..1: none..all). */
export const TRACKER_LAYERS = [TRACKER_INPUTS, 12, 12, 2];
/** The layout before the throttle: steering only, without the wheelspin and throttle inputs. */
const STEER_ONLY_LAYERS = [TRACKER_INPUTS - 2, 12, 12, 1];

const clamp = (x: number, m = 3) => Math.max(-m, Math.min(m, x));

/** The plain tracker's steering: Stanley aiming `PLANNER.trackerLead` s ahead on the plan. */
export function baseSteer(plan: Plan, age: number, self: SelfState, p: CarParams): number {
  const aim = planAt(plan, age + PLANNER.trackerLead);
  return trackSteer(aim.d, aim.dRate, self.d, self.yaw, self.vLong, self.vLat, p);
}

/** The network's inputs, each scaled to about -1..1. */
export function trackerInputs(plan: Plan, age: number, self: SelfState, base: number, throttle: number, out = new Float32Array(TRACKER_INPUTS)): Float32Array {
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
  out[k++] = clamp((self.rearSpin ?? 0) / 5); // m/s the driven wheels spin faster than the car goes
  out[k++] = throttle; // what the plan asks of the pedal
  return out;
}

const inputs = new Float32Array(TRACKER_INPUTS);
const output = new Float32Array(2);

/** Steering (-1..1) along `plan`, `age` s after it was made, and the plan's `throttle` with some taken back. */
export function netDrive(b: Brain, plan: Plan, age: number, self: SelfState, p: CarParams, throttle: number): { steer: number; throttle: number } {
  const base = baseSteer(plan, age, self, p);
  forward(b, trackerInputs(plan, age, self, base, throttle, inputs), output);
  return { steer: Math.max(-1, Math.min(1, base + output[0])), throttle: throttle * Math.max(0, Math.min(1, 1 + output[1])) };
}

/** Steering (-1..1) along `plan` (the throttle left as the plan has it). */
export function netSteer(b: Brain, plan: Plan, age: number, self: SelfState, p: CarParams): number {
  return netDrive(b, plan, age, self, p, 0).steer;
}

/** Random weights but an output layer of zeros: steers exactly as the plain tracker until trained. */
export function quietTracker(rng: Rng): Brain {
  const b = createBrain(TRACKER_LAYERS, rng);
  const L = TRACKER_LAYERS;
  b.weights.fill(0, b.weights.length - (L[L.length - 2] + 1) * L[L.length - 1]);
  return b;
}

/**
 * A car type's trained tracker (CarPerformance.tracker), or null if it has none for this layout. One trained
 * for steering only comes in as is: the new inputs weigh nothing and it takes no throttle back.
 */
export function trackerFrom(weights: number[] | undefined): Brain | null {
  if (!weights) return null;
  if (weights.length === weightCount(TRACKER_LAYERS)) return { layers: TRACKER_LAYERS.slice(), weights: Float32Array.from(weights) };
  if (weights.length !== weightCount(STEER_ONLY_LAYERS)) return null;
  const [nIn, h1, h2] = STEER_ONLY_LAYERS;
  const out: number[] = [];
  let k = 0;
  for (let o = 0; o < h1; o++) {
    out.push(...weights.slice(k, k + nIn), 0, 0, weights[k + nIn]); // the two new inputs, then the bias
    k += nIn + 1;
  }
  out.push(...weights.slice(k, k + (h1 + 1) * h2));
  k += (h1 + 1) * h2;
  out.push(...weights.slice(k, k + h2 + 1), ...new Array(h2 + 1).fill(0)); // the steering row; the throttle's quiet
  return { layers: TRACKER_LAYERS.slice(), weights: Float32Array.from(out) };
}
