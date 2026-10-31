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
  counterSteer: number; // 0..1 hands off, front wheels turn this share toward the direction of travel
  steerSlowdownSpeed: number; // m/s; turn-in rate is halved at this speed (Infinity = never slower)
  escGain: number; // stability control: N·m of yaw correction per rad/s of yaw-rate error (0 = off)
  escMaxTorque: number; // N·m
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
  downforceK: 1.6,
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
  slipAnglePeak: 0.105, // ~6 deg, performance street tyre
  rearGrip: 1.12,
  slipFalloff: 18,
  lsd: 150,
  counterSteer: 0.8,
  steerSlowdownSpeed: Infinity,
  escGain: 9000,
  escMaxTorque: 12000,
};

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  handbrake?: boolean;
}

/** Kept for callers that only deal with pedals and steering. */
export type HandlingInput = DriveInput;

export type DriveMode = 'D' | 'R';

const STOPPED = 0.5; // m/s

/**
 * Pedal mapping with an explicit D / R selector. R is engaged only when the
 * car is (nearly) stopped and the back key is pressed; D again only when
 * stopped and the throttle key is pressed. Otherwise the key that opposes the
 * car's motion or the selected direction is a brake (so after a spin, throttle
 * in D first brakes the backwards slide).
 * @param vForward speed along the car's nose (m/s, negative when moving backwards)
 * @returns engine force (N, + = forward), brake pedal 0..1 and the selected mode
 */
export function driveCommand(
  input: DriveInput,
  vForward: number,
  p: CarParams,
  mode: DriveMode = 'D',
): { engineForce: number; brake: number; mode: DriveMode } {
  if (input.handbrake) return { engineForce: 0, brake: 1, mode };
  let m = mode;
  if (Math.abs(vForward) < STOPPED) {
    if (input.brake > 0 && input.throttle === 0) m = 'R';
    else if (input.throttle > 0 && input.brake === 0) m = 'D';
  }
  if (m === 'D') {
    if (input.brake > 0) return { engineForce: 0, brake: input.brake, mode: m };
    if (input.throttle > 0) {
      if (vForward < -STOPPED) return { engineForce: 0, brake: input.throttle, mode: m };
      if (vForward >= p.maxSpeed) return { engineForce: 0, brake: 0, mode: m };
      const f = Math.min(p.maxDriveForce, p.power / Math.max(vForward, 1));
      return { engineForce: f * input.throttle, brake: 0, mode: m };
    }
  } else {
    if (input.throttle > 0) return { engineForce: 0, brake: input.throttle, mode: m };
    if (input.brake > 0) {
      if (vForward > STOPPED) return { engineForce: 0, brake: input.brake, mode: m };
      if (vForward < -p.reverseMax) return { engineForce: 0, brake: 0, mode: m };
      return { engineForce: -p.reverseForce * input.brake, brake: 0, mode: m };
    }
  }
  return { engineForce: 0, brake: 0, mode: m };
}

/** Front-wheel lock allowed at this speed (speed-sensitive steering). */
export function steerLimit(speed: number, p: CarParams): number {
  const v = Math.abs(speed);
  if (v < 1) return p.maxSteer;
  return Math.min(p.maxSteer, Math.atan((p.latAccelLimit * p.wheelbase) / (v * v)));
}

/**
 * Smooth the digital keyboard steering into a -1..1 value. Turning in slows with
 * speed (a driver eases the wheel in at 200 km/h instead of yanking it), which
 * avoids the yaw overshoot-and-dip a step input causes; returning stays quick.
 */
export function smoothSteer(current: number, target: number, p: CarParams, dt: number, speed = 0): number {
  const returning = target === 0 || (current !== 0 && Math.sign(target) !== Math.sign(current));
  const rise = p.steerRise / (1 + Math.abs(speed) / p.steerSlowdownSpeed);
  const rate = (returning ? p.steerFall : rise) * dt;
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


const G = 9.81;

/**
 * Steering range from speed alone: the front wheel angle at which the car turns
 * at its grip limit - the geometric angle for the tightest turn the tyres allow
 * (wheelbase · μg / v²) plus the tyre's peak slip angle. Full lock at low speed,
 * just past the peak slip angle at 250 km/h. One formula, no speed bands.
 */
export function steerRange(speed: number, p: CarParams): number {
  const v = Math.max(Math.abs(speed), 1);
  return Math.min(p.maxSteer, Math.atan((p.wheelbase * effectiveMu(v, p) * G) / (v * v)) + p.slipAnglePeak);
}

/** Grip coefficient including aerodynamic downforce at this speed. */
export function effectiveMu(speed: number, p: CarParams): number {
  return p.muPeak * (1 + (p.downforceK * speed * speed) / (p.mass * G));
}

/** Highest yaw rate the tyres (with downforce) can sustain at this speed. */
export function escYawCap(speed: number, p: CarParams): number {
  const v = Math.max(Math.abs(speed), 1);
  return (effectiveMu(v, p) * G) / v;
}

/** Yaw rate the driver is asking for with this wheel angle, capped by grip. */
export function escTargetYawRate(wheelAngle: number, speed: number, p: CarParams): number {
  const cap = escYawCap(speed, p);
  const r = (speed * Math.tan(wheelAngle)) / p.wheelbase;
  return Math.max(-cap, Math.min(cap, r));
}

const ESC_MIN_SPEED = 5;

/**
 * Stability control (like a real car's ESC, which brakes single wheels): a yaw
 * torque nudging the car's rotation toward what the driver asks for - helps it
 * turn in when it pushes, pulls it back when the tail steps out.
 */
export function escTorque(yawRate: number, target: number, speed: number, p: CarParams): number {
  if (p.escGain <= 0 || speed < ESC_MIN_SPEED) return 0;
  return Math.max(-p.escMaxTorque, Math.min(p.escMaxTorque, p.escGain * (target - yawRate)));
}

const FOLLOW_FADE_LO = 3; // m/s
const FOLLOW_FADE_HI = 8; // m/s

/**
 * Front wheel angle for a -1..1 (smoothed) steering input (rad, + = right).
 *
 * While the driver steers, the wheels do exactly what the input says, relative
 * to the car's nose, up to the speed-derived grip-limit range - no automatic
 * correction. With hands off, the wheels swing toward the direction the car is
 * travelling (caster self-alignment) by `counterSteer`; a partly pressed key
 * blends between the two.
 * @param vLat sideways speed of the car's centre, + = to its right
 */
export function steerAngle(input: number, vLong: number, vLat: number, p: CarParams): number {
  if (vLong <= 0) return input * p.maxSteer;
  const driver = input * steerRange(vLong, p);
  const fade = Math.min(1, Math.max(0, (vLong - FOLLOW_FADE_LO) / (FOLLOW_FADE_HI - FOLLOW_FADE_LO)));
  const trail = Math.atan2(vLat, vLong) * p.counterSteer * fade;
  const handsOff = 1 - Math.min(1, Math.abs(input));
  const a = driver + trail * handsOff;
  return Math.max(-p.maxSteer, Math.min(p.maxSteer, a));
}
