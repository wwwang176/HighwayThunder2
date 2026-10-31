/**
 * Driver-side vehicle logic for the player car: how pedal and steering input map
 * to engine force, brake impulses and front-wheel angle. The tyres, suspension
 * and chassis are simulated in playerCar.ts / tireModel.ts. There are no driving
 * aids: the car goes wherever its nose points.
 */

export interface CarParams {
  mass: number; // kg
  power: number; // W at the rear wheels
  maxDriveForce: number; // N at the rear axle, low-speed torque limit
  maxSpeed: number; // m/s, rev limiter (wheel surface speed)
  reverseMax: number; // m/s
  reverseForce: number; // N
  brakeForceMax: number; // N, all four brakes at full pedal (enough to lock)
  brakeFrontBias: number; // share of brake torque on the front axle
  dragK: number; // aero drag F = dragK * v^2
  downforceK: number; // aero downforce F = downforceK * v^2
  wheelbase: number; // m
  maxSteer: number; // rad, front wheel lock
  latAccelLimit: number; // m/s^2, keyboard steering limit (above grip so you can overdrive)
  steerRise: number; // input ramp (1/s)
  steerFall: number; // input return to centre (1/s)
  throttleRise: number; // pedal travel speed (1/s)
  // Suspension (per wheel)
  suspensionRest: number; // m
  suspensionTravel: number; // m
  springK: number; // N/m
  damperBump: number; // N·s/m
  damperRebound: number; // N·s/m
  antiRollFront: number; // N/m (stiffer front = understeer = high-speed stability)
  antiRollRear: number; // N/m
  wheelInertia: number; // kg·m²
  // Tyres
  muPeak: number;
  muSlide: number;
  slipAnglePeak: number; // rad
  rearGrip: number; // rear tyre grip multiplier (wider rear tyres)
}

export const DEFAULT_CAR: CarParams = {
  mass: 1300,
  power: 390_000,
  maxDriveForce: 9_500,
  maxSpeed: 83.3,
  reverseMax: 8,
  reverseForce: 4_000,
  brakeForceMax: 20_000,
  brakeFrontBias: 0.65,
  dragK: 0.62,
  downforceK: 0.55,
  wheelbase: 2.6,
  maxSteer: 0.55,
  latAccelLimit: 45,
  steerRise: 6,
  steerFall: 9,
  throttleRise: 5,
  suspensionRest: 0.3,
  suspensionTravel: 0.2,
  springK: 35_000,
  damperBump: 3_000,
  damperRebound: 4_500,
  antiRollFront: 22_000,
  antiRollRear: 8_000,
  wheelInertia: 1.2,
  muPeak: 1.15,
  muSlide: 0.85,
  slipAnglePeak: 0.08,
  rearGrip: 1.1,
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
 * Pedal mapping. The S key brakes while rolling forward and reverses once stopped.
 * @param vForward speed along the car's nose (m/s, negative when reversing)
 * @returns rear-axle engine force (N, + = forward) and brake pedal 0..1
 */
export function driveCommand(input: DriveInput, vForward: number, p: CarParams): { engineForce: number; brake: number } {
  if (input.handbrake) return { engineForce: 0, brake: 1 };
  if (input.brake > 0) {
    if (vForward > 0.5) return { engineForce: 0, brake: input.brake };
    if (vForward < -p.reverseMax) return { engineForce: 0, brake: 0 };
    return { engineForce: -p.reverseForce * input.brake, brake: 0 };
  }
  if (input.throttle > 0) {
    if (vForward < -0.5) return { engineForce: 0, brake: input.throttle };
    if (vForward >= p.maxSpeed) return { engineForce: 0, brake: 0 };
    const f = Math.min(p.maxDriveForce, p.power / Math.max(vForward, 1));
    return { engineForce: f * input.throttle, brake: 0 };
  }
  return { engineForce: 0, brake: 0 };
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

/** Top wheel-surface speed of each gear (rev limiter), km/h. */
export const GEAR_TOP_KMH = [70, 115, 160, 205, 255, 310];
const SHIFT_UP = 0.93;
const SHIFT_DOWN = 0.6;
const SHIFT_TIME = 0.25;

/**
 * Automatic gearbox. Shifts on road speed (so wheelspin does not trigger an
 * upshift) and caps the driven wheels' surface speed at the current gear's limit,
 * which is what bounds wheelspin on a full-throttle launch.
 */
export class Gearbox {
  gear = 1;
  private cooldown = 0;

  update(roadSpeed: number, dt: number): void {
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    const v = Math.abs(roadSpeed) * 3.6;
    if (this.gear < GEAR_TOP_KMH.length && v > GEAR_TOP_KMH[this.gear - 1] * SHIFT_UP) {
      this.gear++;
      this.cooldown = SHIFT_TIME;
    } else if (this.gear > 1 && v < GEAR_TOP_KMH[this.gear - 2] * SHIFT_DOWN) {
      this.gear--;
      this.cooldown = SHIFT_TIME;
    }
  }

  /** Driven wheel surface speed at the rev limiter (m/s). */
  wheelSpeedLimit(): number {
    return GEAR_TOP_KMH[this.gear - 1] / 3.6;
  }

  reset(): void {
    this.gear = 1;
    this.cooldown = 0;
  }
}
