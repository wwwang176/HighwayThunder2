/**
 * Driver-side vehicle logic for the player car: how pedal and steering input map
 * to engine force, brake impulses and front-wheel angle. The tyres, suspension
 * and chassis are simulated in playerCar.ts / tireModel.ts. There are no driving
 * aids: the car goes wherever its nose points.
 */

export interface CarParams {
  mass: number; // kg
  power: number; // W, engine peak power
  maxDriveForce: number; // N at the rear axle when reversing / pedal-mapping limit
  engineTorque: number; // N·m, engine peak torque
  redline: number; // rpm
  idleRpm: number; // rpm
  driveEfficiency: number; // driveline efficiency
  wheelRadius: number; // m
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
  slipFalloff: number; // m/s of slip over which sliding friction falls from muPeak to muSlide
  lsd: number; // limited-slip diff: N·m moved to the slower rear wheel per rad/s of speed difference
}

export const DEFAULT_CAR: CarParams = {
  mass: 1300,
  power: 290_000,
  maxDriveForce: 9_500,
  engineTorque: 400,
  redline: 7500,
  idleRpm: 900,
  driveEfficiency: 0.9,
  wheelRadius: 0.34,
  maxSpeed: 83.3,
  reverseMax: 8,
  reverseForce: 4_000,
  brakeForceMax: 26_000,
  brakeFrontBias: 0.75,
  dragK: 0.4,
  downforceK: 0.55,
  wheelbase: 2.6,
  maxSteer: 0.55,
  latAccelLimit: 55,
  steerRise: 6,
  steerFall: 9,
  throttleRise: 20,
  suspensionRest: 0.3,
  suspensionTravel: 0.2,
  springK: 35_000,
  damperBump: 3_000,
  damperRebound: 4_500,
  antiRollFront: 18_000,
  antiRollRear: 8_000,
  wheelInertia: 1.2,
  muPeak: 1.3,
  muSlide: 0.85,
  slipAnglePeak: 0.08,
  rearGrip: 1.12,
  slipFalloff: 22,
  lsd: 150,
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
export const GEAR_TOP_KMH = [95, 140, 185, 230, 270, 310];
const SHIFT_UP = 0.93;
const SHIFT_DOWN = 0.6;
const SHIFT_TIME = 0.25;

const RPM_TO_RAD = (2 * Math.PI) / 60;
const TC_MAX_MULT = 2.0; // torque converter multiplication at stall
const TC_STALL_RPM = 3000;

/**
 * Engine + automatic gearbox. Each gear's ratio is chosen so the engine hits
 * the redline at GEAR_TOP_KMH; low gears multiply engine torque far beyond what
 * the tyres can transmit, so a full-throttle launch lights up the rear tyres
 * until a taller gear (or speed) brings the force under the grip limit. Shifts
 * happen on road speed so wheelspin itself does not trigger an upshift.
 */
export class Gearbox {
  gear = 1;
  private cooldown = 0;

  /** Overall ratio (engine revs per wheel rev) of a gear. */
  ratio(gear = this.gear, p: CarParams = DEFAULT_CAR): number {
    const wheelOmegaAtRedline = GEAR_TOP_KMH[gear - 1] / 3.6 / p.wheelRadius;
    return (p.redline * RPM_TO_RAD) / wheelOmegaAtRedline;
  }

  /** Engine rpm for a driven-wheel angular velocity (rad/s). */
  engineRpm(wheelOmega: number, p: CarParams = DEFAULT_CAR): number {
    const rpm = (Math.abs(wheelOmega) * this.ratio(this.gear, p)) / RPM_TO_RAD;
    return Math.max(p.idleRpm, rpm);
  }

  /**
   * Total torque at the driven wheels (N·m) for a throttle position: engine
   * torque, capped by power at the current rpm, times the gear ratio. Zero at
   * the rev limiter.
   */
  wheelTorque(throttle: number, wheelOmega: number, p: CarParams = DEFAULT_CAR): number {
    const rpm = this.engineRpm(wheelOmega, p);
    if (rpm >= p.redline) return 0;
    const omegaE = rpm * RPM_TO_RAD;
    const engine = Math.min(p.engineTorque, p.power / omegaE);
    // Torque converter: multiplies torque while the driveline turns slower than stall speed.
    const turbineRpm = (Math.abs(wheelOmega) * this.ratio(this.gear, p)) / RPM_TO_RAD;
    const tc = 1 + (TC_MAX_MULT - 1) * Math.max(0, 1 - turbineRpm / TC_STALL_RPM);
    return engine * tc * this.ratio(this.gear, p) * p.driveEfficiency * throttle;
  }

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
