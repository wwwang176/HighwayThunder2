/**
 * Driver-side vehicle logic for the player car: how pedal and steering input map
 * to engine force, brake impulses and front-wheel angle. The tyres, suspension
 * and chassis are simulated in playerCar.ts / tireModel.ts. There are no driving
 * aids: the car goes wherever its nose points.
 */

import { STREET_RACER } from './cars/streetRacer';

export interface CarParams {
  mass: number; // kg
  comY: number; // m, centre of mass height relative to the body's centre (which rides 0.55 m up); lower = harder to roll
  comFwd: number; // m, centre of mass ahead of the axles' midpoint: the front tyres carry 0.5 + comFwd / wheelbase of the weight
  power: number; // W, engine peak power
  maxDriveForce: number; // N at the rear axle when reversing / pedal-mapping limit
  engineTorque: number; // N·m, engine peak torque
  redline: number; // rpm
  idleRpm: number; // rpm
  driveEfficiency: number; // driveline efficiency
  wheelRadius: number; // m
  width: number; // m, the body (collider, the box others see and the AI keeps clear with)
  length: number; // m
  maxSpeed: number; // m/s, rev limiter (wheel surface speed)
  reverseMax: number; // m/s
  reverseForce: number; // N
  brakeForceMax: number; // N, all four brakes at full pedal (enough to lock)
  brakeFrontBias: number; // share of brake torque on the front axle
  frontBrakeApart: boolean; // arcade: the front tyres' braking takes none of their cornering grip (it steers under a hard brake, even locked)
  dragK: number; // aero drag F = dragK * v^2
  downforceK: number; // aero downforce F = downforceK * v^2
  wheelbase: number; // m
  maxSteer: number; // rad, front wheel lock
  latAccelLimit: number; // m/s^2, keyboard steering limit (above grip so you can overdrive)
  steerRise: number; // input ramp (1/s)
  steerFall: number; // input return to centre (1/s)
  throttleRise: number; // pedal travel speed (1/s)
  shiftTime: number; // s the drive is cut for on an upshift (the gearbox's speed: a dual-clutch's a blink)
  // Suspension (per wheel)
  suspensionRest: number; // m
  suspensionTravel: number; // m
  springProgressFrom: number; // share of the travel from which the springs stiffen (1: linear springs)
  springProgressMult: number; // how many times stiffer they are at full travel (and stiffer still past it: a bump stop)
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
  rollInfluence: number; // 0..1 share of the tyres' rolling torque the body gets (1 real; lower leans but does not tip over)
  aeroGrip: number; // extra tyre grip from aero at full effect (no spring load: see aeroGripScale)
  aeroGripFrom: number; // km/h where it starts
  aeroGripTo: number; // km/h where it is all there
  rollRefKmh: number; // km/h up to which rollInfluence is as set (less past it: rollInfluenceAt)
  slipFalloff: number; // m/s of slip over which sliding friction falls from muPeak to muSlide
  lsd: number; // limited-slip diff: N·m moved to the slower rear wheel per rad/s of speed difference
  lsdMax: number; // N·m, the most it moves
  counterSteer: number; // 0..1 hands off, front wheels turn this share toward the direction of travel
  steerSlowdownSpeed: number; // m/s; turn-in rate is halved at this speed (Infinity = never slower)
  escGain: number; // stability control: N·m of yaw correction per rad/s of yaw-rate error (0 = off)
  escMaxTorque: number; // N·m
}

/** The player car's handling (the street racer: src/vehicles/cars/streetRacer.ts). */
export const DEFAULT_CAR: CarParams = STREET_RACER.params;

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  handbrake?: boolean;
  /** Nitro asked for (it burns only on the throttle, while there's some: nitro.ts). */
  nitro?: boolean;
}

/** Kept for callers that only deal with pedals and steering. */
export type HandlingInput = DriveInput;

export type DriveMode = 'D' | 'R';

const STOPPED = 0.5; // m/s
/** Both keys held in D below this speed (m/s): a burnout (driveCommand). */
export const BURNOUT_SPEED = 4;

/**
 * Pedal mapping with an explicit D / R selector. R is engaged only when the
 * car is (nearly) stopped and the back key is pressed; D again only when
 * stopped and the throttle key is pressed. Otherwise the key that opposes the
 * car's motion or the selected direction is a brake (so after a spin, throttle
 * in D first brakes the backwards slide). Both keys in D (nearly) stopped: a burnout - the engine drives and
 * the brakes hold the car (the caller brakes only the front wheels, the driven rear ones spin).
 * @param vForward speed along the car's nose (m/s, negative when moving backwards)
 * @returns engine force (N, + = forward), brake pedal 0..1, the selected mode, and whether it is a burnout
 */
export function driveCommand(
  input: DriveInput,
  vForward: number,
  p: CarParams,
  mode: DriveMode = 'D',
): { engineForce: number; brake: number; mode: DriveMode; burnout?: boolean } {
  if (input.handbrake) return { engineForce: 0, brake: 1, mode };
  let m = mode;
  if (Math.abs(vForward) < STOPPED) {
    if (input.brake > 0 && input.throttle === 0) m = 'R';
    else if (input.throttle > 0 && input.brake === 0) m = 'D';
  }
  if (m === 'D') {
    if (input.brake > 0 && input.throttle > 0 && Math.abs(vForward) < BURNOUT_SPEED) {
      return { engineForce: p.maxDriveForce * input.throttle, brake: input.brake, mode: m, burnout: true };
    }
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
/**
 * How fast the engine's revs can fall on their own (rpm/s): its flywheel's inertia, the torque converter letting it
 * slip from the wheels. Without it, a blip standing still drops straight back to the idle as the spun-up rear
 * tyres bite (the revs read off the wheels); with it they wind down over a second or so.
 */
export const ENGINE_FALL_RATE = 5000;

/** The revs a step on: up at once to `target`, down no faster than ENGINE_FALL_RATE. */
export function revsFalling(prev: number, target: number, dt: number, rate = ENGINE_FALL_RATE): number {
  return target >= prev ? target : Math.max(target, prev - rate * dt);
}

/**
 * The driveline's shunt as the drive bites again (an upshift's, or the throttle back on): the revs, carrying on, dip and
 * bounce back a few times, dying away (SHUNT_RPM deep at full throttle, SHUNT_HZ, SHUNT_DECAY s time constant).
 */
export const SHUNT_RPM = 200;
export const SHUNT_HZ = 7;
export const SHUNT_DECAY = 0.08;
/** The throttle back on past SHUNT_ON after it was let off under SHUNT_OFF bites too (driving, past SHUNT_MIN_SPEED m/s). */
export const SHUNT_OFF = 0.05;
export const SHUNT_ON = 0.2;
export const SHUNT_MIN_SPEED = 2;
/** After this long (s) it's over. */
export const SHUNT_TIME = 0.4;

/** The shunt's offset to the revs (rpm), `t` s after the drive bit again, at `throttle` (0..1). */
export function shuntRevs(t: number, throttle: number): number {
  if (!(t >= 0) || t > SHUNT_TIME) return 0;
  return -SHUNT_RPM * throttle * Math.exp(-t / SHUNT_DECAY) * Math.sin(2 * Math.PI * SHUNT_HZ * t);
}

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
  /** s of an upshift still to go: the drive is cut (CarParams.shiftTime). */
  private cut = 0;
  /** The upshift's length (s) and the revs it began at: through it they fall to the new gear's. */
  private shiftLen = 0;
  private fromRpm = 0;

  /** Mid-upshift: no drive. */
  get shifting(): boolean {
    return this.cut > 0;
  }

  /** Overall ratio (engine revs per wheel rev) of a gear. */
  ratio(gear = this.gear, p: CarParams = DEFAULT_CAR): number {
    const wheelOmegaAtRedline = GEAR_TOP_KMH[gear - 1] / 3.6 / p.wheelRadius;
    return (p.redline * RPM_TO_RAD) / wheelOmegaAtRedline;
  }

  /**
   * Engine rpm for a driven-wheel angular velocity (rad/s). Through an upshift the engine is let go of, as off
   * the throttle: its revs fall away from where the shift began to the new gear's, which they meet as it ends.
   */
  engineRpm(wheelOmega: number, p: CarParams = DEFAULT_CAR): number {
    const rpm = Math.max(p.idleRpm, (Math.abs(wheelOmega) * this.ratio(this.gear, p)) / RPM_TO_RAD);
    if (this.cut <= 0 || this.shiftLen <= 0 || this.fromRpm <= rpm) return rpm;
    const k = 1 - this.cut / this.shiftLen;
    return this.fromRpm + (rpm - this.fromRpm) * k * k * (3 - 2 * k);
  }

  /**
   * Total torque at the driven wheels (N·m) for a throttle position: engine
   * torque, capped by power at the current rpm, times the gear ratio. Zero at
   * the rev limiter.
   */
  wheelTorque(throttle: number, wheelOmega: number, p: CarParams = DEFAULT_CAR): number {
    if (this.cut > 0) return 0; // mid-upshift
    const rpm = this.engineRpm(wheelOmega, p);
    if (rpm >= p.redline) return 0;
    const omegaE = rpm * RPM_TO_RAD;
    const engine = Math.min(p.engineTorque, p.power / omegaE);
    // Torque converter: multiplies torque while the driveline turns slower than stall speed.
    const turbineRpm = (Math.abs(wheelOmega) * this.ratio(this.gear, p)) / RPM_TO_RAD;
    const tc = 1 + (TC_MAX_MULT - 1) * Math.max(0, 1 - turbineRpm / TC_STALL_RPM);
    return engine * tc * this.ratio(this.gear, p) * p.driveEfficiency * throttle;
  }

  /**
   * A step of `dt` s at `roadSpeed` (m/s), the driven wheels at `wheelOmega` (rad/s; default: rolling with the
   * road): shifts on road speed; an upshift cuts the drive for p.shiftTime, the revs falling meanwhile.
   */
  update(roadSpeed: number, dt: number, p: CarParams = DEFAULT_CAR, wheelOmega = roadSpeed / p.wheelRadius): void {
    this.cut = Math.max(0, this.cut - dt);
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    const v = Math.abs(roadSpeed) * 3.6;
    if (this.gear < GEAR_TOP_KMH.length && v > GEAR_TOP_KMH[this.gear - 1] * SHIFT_UP) {
      this.fromRpm = this.engineRpm(wheelOmega, p);
      this.gear++;
      this.cut = this.shiftLen = p.shiftTime;
      this.cooldown = Math.max(SHIFT_TIME, p.shiftTime);
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
    this.cut = 0;
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
  return p.muPeak * (1 + (p.downforceK * speed * speed) / (p.mass * G)) * aeroGripScale(speed, p);
}

/**
 * Tyre grip multiplier from aero at this speed, without pressing the car into
 * its springs (real downforce that size bottoms the suspension): 1 up to
 * `aeroGripFrom` km/h, rising along an S-curve to 1 + `aeroGrip` at
 * `aeroGripTo` and staying there - no kink, and no grip that keeps growing
 * with v² (2.7 g at 280 km/h was twitchy and leaned too far).
 */
export function aeroGripScale(speed: number, p: CarParams): number {
  const u = Math.max(0, Math.min(1, ((Math.abs(speed) * 3.6 - p.aeroGripFrom) / (p.aeroGripTo - p.aeroGripFrom))));
  return 1 + p.aeroGrip * u * u * (3 - 2 * u);
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
 * Steering into the slide (or with no slide), the wheels do exactly what the
 * input says, relative to the car's nose, up to the speed-derived grip-limit
 * range - no automatic correction. With hands off, the wheels swing toward the
 * direction the car is travelling (caster self-alignment) by `counterSteer`.
 * Counter-steering (the key toward where it is travelling), they line up with
 * the direction of travel fully and the input goes on top - so catching a
 * slide always turns them further than letting go (at speed the input's range
 * is smaller than a slide's angle: it used to correct less than hands off).
 * A partly pressed key blends.
 * @param vLat sideways speed of the car's centre, + = to its right
 */
export function steerAngle(input: number, vLong: number, vLat: number, p: CarParams): number {
  if (vLong <= 0) return input * p.maxSteer;
  const driver = input * steerRange(vLong, p);
  const fade = Math.min(1, Math.max(0, (vLong - FOLLOW_FADE_LO) / (FOLLOW_FADE_HI - FOLLOW_FADE_LO)));
  const slide = Math.atan2(vLat, vLong) * fade;
  const handsOff = 1 - Math.min(1, Math.abs(input));
  const counter = input * slide > 0 ? Math.min(1, Math.abs(input)) : 0;
  const a = driver + slide * (p.counterSteer * handsOff + counter);
  return Math.max(-p.maxSteer, Math.min(p.maxSteer, a));
}

/**
 * The rollInfluence to use at this speed: as set up to `rollRefKmh`, then less
 * as aero adds grip, so the most rolling torque the tyres can put on the body
 * stays what it is there - the body leans by how close to the limit the car
 * turns, not by how much grip speed has added.
 */
export function rollInfluenceAt(speed: number, p: CarParams): number {
  const ref = p.rollRefKmh / 3.6;
  const v = Math.abs(speed);
  return v <= ref ? p.rollInfluence : (p.rollInfluence * effectiveMu(ref, p)) / effectiveMu(v, p);
}
