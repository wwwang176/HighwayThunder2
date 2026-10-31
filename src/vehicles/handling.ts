/**
 * Driver-side vehicle logic for the player car: how pedal and steering input map
 * to engine force, brake impulses and front-wheel angle. The tyres, suspension
 * and chassis themselves are simulated by Rapier's ray-cast vehicle. There are
 * no driving aids: the car goes wherever its nose points.
 */

export interface CarParams {
  mass: number; // kg
  power: number; // W at the rear wheels
  maxDriveForce: number; // N, traction limit at low speed
  maxSpeed: number; // m/s, speed limiter
  reverseMax: number; // m/s
  reverseForce: number; // N
  brakeDecel: number; // m/s^2 target from the brake pedal
  dragK: number; // aero drag F = dragK * v^2
  downforceK: number; // aero downforce F = downforceK * v^2
  wheelbase: number; // m
  maxSteer: number; // rad, front wheel lock
  latAccelLimit: number; // m/s^2, steering limit keeps v^2*tan(angle)/L below this
  steerRise: number; // input ramp (1/s)
  steerFall: number; // input return to centre (1/s)
  // Tyres & suspension (per wheel)
  suspensionRest: number;
  suspensionTravel: number;
  suspensionStiffness: number;
  suspensionCompression: number;
  suspensionRelaxation: number;
  maxSuspensionForce: number;
  frictionSlip: number;
  sideFrictionStiffness: number;
}

export const DEFAULT_CAR: CarParams = {
  mass: 1300,
  power: 390_000,
  maxDriveForce: 9_500,
  maxSpeed: 83.3,
  reverseMax: 8,
  reverseForce: 4_000,
  brakeDecel: 11,
  dragK: 0.62,
  downforceK: 0.55,
  wheelbase: 2.6,
  maxSteer: 0.55,
  latAccelLimit: 24,
  steerRise: 6,
  steerFall: 9,
  suspensionRest: 0.3,
  suspensionTravel: 0.18,
  suspensionStiffness: 38,
  suspensionCompression: 3.2,
  suspensionRelaxation: 3.6,
  maxSuspensionForce: 20_000,
  frictionSlip: 2.6,
  sideFrictionStiffness: 1.0,
};

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  handbrake?: boolean;
}

/** Kept for callers that only deal with pedals and steering. */
export type HandlingInput = DriveInput;

/**
 * @param vForward speed along the car's nose (m/s, negative when reversing)
 * @returns total rear-axle engine force (N, + = forward) and per-wheel brake impulse
 */
export function driveCommand(input: DriveInput, vForward: number, p: CarParams, dt: number): { engineForce: number; brakeImpulse: number } {
  const brakeImpulse = (decel: number) => (decel * p.mass * dt) / 4;
  if (input.handbrake) return { engineForce: 0, brakeImpulse: brakeImpulse(p.brakeDecel) };

  if (input.brake > 0) {
    if (vForward > 0.5) return { engineForce: 0, brakeImpulse: brakeImpulse(p.brakeDecel * input.brake) };
    if (vForward < -p.reverseMax) return { engineForce: 0, brakeImpulse: 0 };
    return { engineForce: -p.reverseForce * input.brake, brakeImpulse: 0 };
  }
  if (input.throttle > 0) {
    if (vForward < -0.5) return { engineForce: 0, brakeImpulse: brakeImpulse(p.brakeDecel * input.throttle) };
    if (vForward >= p.maxSpeed) return { engineForce: 0, brakeImpulse: 0 };
    const f = Math.min(p.maxDriveForce, p.power / Math.max(vForward, 1));
    return { engineForce: f * input.throttle, brakeImpulse: 0 };
  }
  return { engineForce: 0, brakeImpulse: 0 };
}

/** Front-wheel lock allowed at this speed (speed-sensitive steering). */
export function steerLimit(speed: number, p: CarParams): number {
  const v = Math.abs(speed);
  if (v < 1) return p.maxSteer;
  return Math.min(p.maxSteer, Math.atan((p.latAccelLimit * p.wheelbase) / (v * v)));
}

/** Smooth the digital keyboard steering into a -1..1 value. */
export function smoothSteer(current: number, target: number, p: CarParams, dt: number): number {
  const returning = target === 0 || (current !== 0 && Math.sign(target) !== Math.sign(current));
  const rate = (returning ? p.steerFall : p.steerRise) * dt;
  if (current < target) return Math.min(target, current + rate);
  return Math.max(target, current - rate);
}
