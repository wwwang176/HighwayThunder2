import { MEDIAN_NEAR_X, RAIL_D } from '../config';
import { type CarParams, steerRange } from '../vehicles/handling';
import { Brain, createBrain, forward, weightCount } from './brain';
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
 * Its inputs (trackerInputs): the plan ahead, the car's motion (each scaled to about -1..1, the angles clamped past
 * ~17 deg), what it is told; the car's heading and slide unclamped; how far the road goes on either side, and what
 * the seat feels (acceleration, roll and pitch rates).
 */
export const TRACKER_INPUTS = 2 * TRACKER_LOOK.length + 9 + 3 + 6;
/** Outputs: a steering correction, and how much of the plan's throttle to take back (0..1: none..all). */
export const TRACKER_LAYERS = [TRACKER_INPUTS, 12, 12, 2];
/**
 * Heading off the road's by more than this (rad) it stands across the road: never in a race, only after a crash (put
 * back at 60 km/h). The plan is then followed plainly (PlannerDriver: courseFollow), not by the network.
 */
export const ACROSS_YAW = 0.4;

const clamp = (x: number, m = 3) => Math.max(-m, Math.min(m, x));

/** The plain tracker's pull back onto the plan: cross-track gain (1/s). */
export const TRACK_TUNING = { k: 0.8 };

/**
 * Steering input (-1..1) toward lateral position `dAim` moving sideways at
 * `rate` (both taken a preview time ahead on a path): Stanley (cross-track
 * error at the front axle, the path's lateral speed fed forward), but on the
 * direction the car actually travels (heading plus body slip) and limited only
 * by the car's own grip-derived steering range - the player car understeers far
 * more than the kinematic model the traffic's tracker caps its wheel angle by,
 * and would never finish a lane change at speed under that cap.
 */
export function trackSteer(dAim: number, rate: number, d: number, yaw: number, vLong: number, vLat: number, p: CarParams): number {
  const v = Math.max(vLong, 1);
  const course = yaw + Math.atan2(vLat, v);
  const e = dAim - (d + Math.sin(yaw) * (p.wheelbase / 2));
  const angle = Math.atan2(rate, v) - course + Math.atan2(TRACK_TUNING.k * e, v + 2);
  return Math.max(-1, Math.min(1, angle / steerRange(vLong, p)));
}

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
  // seat feels.
  out[k++] = clamp((RAIL_D - self.d) / 5);
  out[k++] = clamp((self.d - MEDIAN_NEAR_X) / 5);
  out[k++] = clamp((self.aLong ?? 0) / 10);
  out[k++] = clamp((self.aLat ?? 0) / 10);
  out[k++] = clamp((self.rollRate ?? 0) / 0.5);
  out[k++] = clamp((self.pitchRate ?? 0) / 0.5);
  return out;
}

const inputs = new Float32Array(TRACKER_INPUTS);
const output = new Float32Array(2);

/** Steering (-1..1) along `plan`, `age` s after it was made, and the plan's `throttle` with some taken back. */
export function netDrive(b: Brain, plan: Plan, age: number, self: SelfState, p: CarParams, throttle: number): { steer: number; throttle: number } {
  const base = baseSteer(plan, age, self, p);
  forward(b, trackerInputs(plan, age, self, base, throttle, inputs), output);
  const kept = Math.max(0, Math.min(1, 1 + output[1]));
  return { steer: Math.max(-1, Math.min(1, base + output[0])), throttle: throttle * kept };
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

/** A car type's trained tracker (CarPerformance.tracker), or null if it has none for this layout. */
export function trackerFrom(weights: number[] | undefined): Brain | null {
  if (!weights || weights.length !== weightCount(TRACKER_LAYERS)) return null;
  return { layers: TRACKER_LAYERS.slice(), weights: Float32Array.from(weights) };
}
