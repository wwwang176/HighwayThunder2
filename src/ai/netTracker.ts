import { MEDIAN_NEAR_X, RAIL_D } from '../config';
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
/**
 * Its inputs: the plan ahead, the car's motion (each scaled to about -1..1, the angles clamped past ~17 deg), what it
 * is told; then the car's heading and slide unclamped (HEADING_INPUTS: across the road, after a crash, all of it).
 */
const HEADING_INPUTS = 3;
/** Then how far the road goes on either side, and what the seat feels (acceleration, roll and pitch rates). */
const SENSE_INPUTS = 6;
/** The inputs before the SENSE ones. */
const PLAN_INPUTS = 2 * TRACKER_LOOK.length + 9 + HEADING_INPUTS;
export const TRACKER_INPUTS = PLAN_INPUTS + SENSE_INPUTS;
/**
 * Outputs: a steering correction, how much of the plan's throttle to take back (0..1: none..all) - standing across
 * the road (ACROSS_YAW), the throttle itself, the plan's pedals counting for nothing - and whether to back up (only
 * where REVERSE_V and ACROSS_YAW let it).
 */
export const TRACKER_LAYERS = [TRACKER_INPUTS, 12, 12, 3];
/** The layout before the SENSE inputs. */
const NO_SENSE_LAYERS = [PLAN_INPUTS, 12, 12, 3];
/** The layout before the reverse output. */
const TWO_OUT_LAYERS = [PLAN_INPUTS, 12, 12, 2];
/** The layout before the heading inputs. */
const NO_HEADING_LAYERS = [PLAN_INPUTS - HEADING_INPUTS, 12, 12, 2];
/** It may back up only slower than this (m/s)... */
export const REVERSE_V = 3;
/**
 * Heading off the road's by more than this (rad) it stands across the road: never in a race, only after a crash (put
 * back at 60 km/h). Then the network has the throttle, and may back up (REVERSE_V).
 */
export const ACROSS_YAW = 0.4;
export const REVERSE_YAW = ACROSS_YAW;
/** Of its reverse output, this much is nothing (so a slightly-off weight does not back it up). */
const REVERSE_DEAD = 0.1;
/** The layout before the throttle: steering only, without the wheelspin and throttle inputs. */
const STEER_ONLY_LAYERS = [PLAN_INPUTS - HEADING_INPUTS - 2, 12, 12, 1];

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
  // Its heading off the road's and its slide, all of them: past ~17 deg the ones above all read the same.
  out[k++] = Math.sin(self.yaw);
  out[k++] = 1 - Math.cos(self.yaw); // (0 on the road's heading, 2 the wrong way round)
  out[k++] = Math.atan2(self.vLat, Math.max(1, self.vLong)) / (Math.PI / 2);
  // Where the road ends either side (the rail on the right; the median's grass on the left, - on it) and what the
  // seat feels: SENSE_INPUTS.
  out[k++] = clamp((RAIL_D - self.d) / 5);
  out[k++] = clamp((self.d - MEDIAN_NEAR_X) / 5);
  out[k++] = clamp((self.aLong ?? 0) / 10);
  out[k++] = clamp((self.aLat ?? 0) / 10);
  out[k++] = clamp((self.rollRate ?? 0) / 0.5);
  out[k++] = clamp((self.pitchRate ?? 0) / 0.5);
  return out;
}

const inputs = new Float32Array(TRACKER_INPUTS);
const output = new Float32Array(3);

/**
 * Steering (-1..1) along `plan`, `age` s after it was made, the plan's `throttle` with some taken back (across the
 * road: its own throttle, `across`), and how hard to back up (0..1; the brake pedal: it stops the car, then reverses
 * it). Backing up it steers the other way round (the plain tracker's steering mirrored: the same turn of the car,
 * going backwards) plus its correction.
 */
export function netDrive(b: Brain, plan: Plan, age: number, self: SelfState, p: CarParams, throttle: number): { steer: number; throttle: number; reverse: number; across: boolean } {
  const base = baseSteer(plan, age, self, p);
  forward(b, trackerInputs(plan, age, self, base, throttle, inputs), output);
  const across = Math.abs(self.yaw) > ACROSS_YAW;
  const may = across && self.vLong < REVERSE_V;
  const reverse = may && b.layers[b.layers.length - 1] > 2 ? Math.max(0, Math.min(1, (output[2] - REVERSE_DEAD) / (1 - REVERSE_DEAD))) : 0;
  const steer = (reverse > 0 ? -base : base) + output[0];
  // (across: as if the plan asked for it all - what it nearly always did, so the older networks drive off as they did)
  const kept = Math.max(0, Math.min(1, 1 + output[1]));
  return { steer: Math.max(-1, Math.min(1, steer)), throttle: reverse > 0 ? 0 : across ? kept : throttle * kept, reverse, across };
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
 * A car type's trained tracker (CarPerformance.tracker), or null if it has none for this layout. One of an older
 * layout comes in driving as it did: the inputs added since weigh nothing (the road's ends and the seat's; the heading
 * ones; the wheelspin and throttle ones), and one trained for steering only takes no throttle back.
 */
export function trackerFrom(weights: number[] | undefined): Brain | null {
  if (!weights) return null;
  if (weights.length === weightCount(TRACKER_LAYERS)) return { layers: TRACKER_LAYERS.slice(), weights: Float32Array.from(weights) };
  if (weights.length === weightCount(NO_SENSE_LAYERS)) return trackerFrom(widen(weights, NO_SENSE_LAYERS, SENSE_INPUTS));
  // (one that never backs up: a reverse output row of zeros)
  if (weights.length === weightCount(TWO_OUT_LAYERS)) return trackerFrom([...weights, ...new Array(TWO_OUT_LAYERS[2] + 1).fill(0)]);
  if (weights.length === weightCount(NO_HEADING_LAYERS)) return trackerFrom(widen(weights, NO_HEADING_LAYERS, HEADING_INPUTS));
  const steerAndThrottle = fromSteerOnly(weights);
  return steerAndThrottle && trackerFrom(steerAndThrottle);
}

/** The weights of a network of `layers` with `more` inputs added after its own, weighing nothing. */
function widen(weights: number[], layers: number[], more: number): number[] {
  const [nIn, h1] = layers;
  const out: number[] = [];
  let k = 0;
  for (let o = 0; o < h1; o++) {
    out.push(...weights.slice(k, k + nIn), ...new Array(more).fill(0), weights[k + nIn]); // (its inputs', the new ones', its bias)
    k += nIn + 1;
  }
  out.push(...weights.slice(k));
  return out;
}

/** A steering-only network's weights in the layout before the heading inputs (null: not that layout). */
function fromSteerOnly(weights: number[]): number[] | null {
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
  return out;
}
