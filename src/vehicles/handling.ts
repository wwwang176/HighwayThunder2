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
  lsdTurnFree?: number; // 0..1: this share of the rear wheels' rolling round a bend (the outer one faster) the diff lets be, locking their slip (unset: 1, all of it; 0: it locks that too, holding the car straight)
  counterSteer: number; // 0..1 hands off, front wheels turn this share toward the direction of travel
  steerSlowdownSpeed: number; // m/s; turn-in rate is halved at this speed (Infinity = never slower)
  escGain: number; // stability control: N·m of yaw correction per rad/s of yaw-rate error (0 = off)
  escMaxTorque: number; // N·m
  gearTops?: number[]; // its gearbox: each gear's top speed (km/h, at the redline); unset: GEAR_TOP_KMH
  launchSlip?: number; // launch control: the tail following the nose, the drive eased to hold the rear tyres' slip at this (m/s); unset: none
  tractionSlip?: number; // traction control: the drive eased to hold the rear tyres' slip at this (m/s), sliding or not (tractionTrim); unset: none
  drift?: DriftAssist; // drift assist: the more it slides the more the car the driver's - less traction control, the stability control only near a spin (driftShare, driftEsc); unset: none
  rearLongGrip?: number; // drag tyres: the rear tyres' grip straight on (driving, braking) times this, always (on rearGrip); unset: 1
  // The player's tuning (src/vehicles/tuning.ts); unset: as built.
  gearScale?: number; // final drive: every gear's top speed (and the limiter's) times this (> 1 taller)
  latGrip?: number; // camber: the tyres' grip cornering, times this ...
  longGrip?: number; // ... and driving / braking straight, times this
  nitroForce?: number; // the nitro's push (NITRO.force) times this
  nitroBurn?: number; // a tank's seconds of use (NITRO.burn) times this
  rollingRes?: number; // the tyres' rolling resistance times this
  gripSpeed?: number; // tyre pressure: grip change per 100 km/h from gripPivot (pressureGripScale)
  gripPivot?: number; // km/h it turns about (unset: PRESSURE_PIVOT_KMH)
  brakeGrip?: number; // braking, all four tyres' grip straight on times this (the balance's stopping distance kept)
  brakeShift?: number; // the brakes' balance: braking, this share of the front tyres' grip straight on moved to the rear (- forward)
}

/** The player car's handling (the street racer: src/vehicles/cars/streetRacer.ts). */
export const DEFAULT_CAR: CarParams = STREET_RACER.params;

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  /** Held where it stands: all four brakes on, the pedals let be (the grid, the finish's stop). */
  hold?: boolean;
  /** The handbrake lever: the rear wheels locked (their grip sideways gone: the tail slides), the drive cut. */
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
  if (input.hold) return { engineForce: 0, brake: 1, mode };
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
/** A gear's top speed (km/h): the car's gearbox (gearTops, or GEAR_TOP_KMH) on its final drive (gearScale). */
export const gearTopKmh = (gear: number, p: CarParams): number => (p.gearTops ?? GEAR_TOP_KMH)[gear - 1] * (p.gearScale ?? 1);
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
export const SHUNT_RPM = 700;
export const SHUNT_HZ = 5;
export const SHUNT_DECAY = 0.12;
/** The throttle back on past SHUNT_ON after it was let off under SHUNT_OFF bites too (driving, past SHUNT_MIN_SPEED m/s). */
export const SHUNT_OFF = 0.05;
export const SHUNT_ON = 0.2;
export const SHUNT_MIN_SPEED = 2;
/** After this long (s) it's over. */
export const SHUNT_TIME = 0.5;

/** The shunt's offset to the revs (rpm), `t` s after the drive bit again, at `throttle` (0..1). */
export function shuntRevs(t: number, throttle: number): number {
  if (!(t >= 0) || t > SHUNT_TIME) return 0;
  return -SHUNT_RPM * throttle * Math.exp(-t / SHUNT_DECAY) * Math.sin(2 * Math.PI * SHUNT_HZ * t);
}

/**
 * On the rev limiter (at LIMITER_SHARE of the redline or more, the throttle past half) the gauge's needle bounces:
 * each fuel cut drops the revs LIMITER_BOUNCE_RPM and they climb straight back, LIMITER_BOUNCE_HZ times a second.
 * The gauge's only (a look, made to be seen: about three of its 250-rpm blocks, each drop held a few frames - a
 * real needle's few hundred rpm wouldn't show on it); the engine's sound stutters by its own limiter recording.
 */
export const LIMITER_SHARE = 0.988;
export const LIMITER_BOUNCE_RPM = 700;
export const LIMITER_BOUNCE_HZ = 6;

/** The gauge's offset (rpm, 0 or below) `t` s into the limiter: a quick drop (BOUNCE_DROP of a cycle), a climb back. */
const BOUNCE_DROP = 0.3;
export function limiterBounce(t: number): number {
  if (!(t >= 0)) return 0;
  const p = (t * LIMITER_BOUNCE_HZ) % 1;
  return -LIMITER_BOUNCE_RPM * (p < BOUNCE_DROP ? p / BOUNCE_DROP : 1 - (p - BOUNCE_DROP) / (1 - BOUNCE_DROP));
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
    const wheelOmegaAtRedline = gearTopKmh(gear, p) / 3.6 / p.wheelRadius;
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
    if (this.gear < (p.gearTops ?? GEAR_TOP_KMH).length && v > gearTopKmh(this.gear, p) * SHIFT_UP) {
      this.fromRpm = this.engineRpm(wheelOmega, p);
      this.gear++;
      this.cut = this.shiftLen = p.shiftTime;
      this.cooldown = Math.max(SHIFT_TIME, p.shiftTime);
    } else if (this.gear > 1 && v < gearTopKmh(this.gear - 1, p) * SHIFT_DOWN) {
      this.gear--;
      this.cooldown = SHIFT_TIME;
    }
  }

  /** Driven wheel surface speed at the rev limiter (m/s). */
  wheelSpeedLimit(p: CarParams = DEFAULT_CAR): number {
    return gearTopKmh(this.gear, p) / 3.6;
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

/** Around this speed (km/h) the tyres' pressure (gripSpeed) neither adds grip nor takes it. */
export const PRESSURE_PIVOT_KMH = 200;

/**
 * The tyres' cornering grip at this speed for their pressure (the player's tuning, gripSpeed): soft ones grip more
 * slow and less fast (the sidewall squirming, the heat), hard ones the other way (driving and braking straight: as
 * they are) - gripSpeed per 100 km/h from
 * PRESSURE_PIVOT_KMH; 1 unset. (Within 0.7..1.3.)
 */
export function pressureGripScale(speed: number, p: CarParams): number {
  const k = p.gripSpeed ?? 0;
  if (k === 0) return 1;
  return Math.max(0.7, Math.min(1.3, 1 + (k * (Math.abs(speed) * 3.6 - (p.gripPivot ?? PRESSURE_PIVOT_KMH))) / 100));
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

/**
 * Stability control trims the power once the car slides: in full up to ESC_TRIM_FROM of body slip (its motion's
 * angle off its nose, rad), down to ESC_TRIM_LEAST of it by ESC_TRIM_FULL and past it - a slide still on the
 * throttle, held or steered by it (at 8.6 deg to none by 20 deg, a drift had no throttle at all).
 */
export const ESC_TRIM_FROM = (20 * Math.PI) / 180;
export const ESC_TRIM_FULL = (45 * Math.PI) / 180;
export const ESC_TRIM_LEAST = 0.4;
export function escPowerTrim(bodySlip: number): number {
  const k = Math.min(1, Math.max(0, (bodySlip - ESC_TRIM_FROM) / (ESC_TRIM_FULL - ESC_TRIM_FROM)));
  return 1 - (1 - ESC_TRIM_LEAST) * k;
}

/**
 * Traction control (CarParams.tractionSlip): its share of the drive let through, moved toward holding the rear tyres'
 * slip (m/s: their tread's speed over the road, forward) at `target` - TRACTION_RATE per second per target's worth of
 * slip off it, never under TRACTION_LEAST. Unlike launch control it holds in a slide too: a tyre spinning loses its
 * sideways grip with it, and the car, on the throttle, slid on along its old line instead of the nose's.
 */
export const TRACTION_RATE = 8;
export const TRACTION_LEAST = 0.15;
export function tractionTrim(trim: number, slip: number, target: number, dt: number): number {
  return Math.min(1, Math.max(TRACTION_LEAST, trim + TRACTION_RATE * dt * ((target - slip) / target)));
}

/**
 * Drift assist (CarParams.drift): the more the car slides the more it drifts (driftShare: no switch - from a slide of
 * `from` to `full`, smoothly; the handbrake only by the slide it starts), and the more it drifts the more the car is the
 * driver's - the traction control lets the rear tyres spin (a drift is the tail on wheelspin; it straightened every
 * slide on the throttle), the stability control lets the slide be till it nears a spin, the rear's grip less, the
 * drive eased as the slide grows big - and the slide pulled to what the steering sets (driftLimit), the car pushed
 * toward its nose (driftCarve). Angles: the body's slide (its motion's angle off its nose), rad.
 */
export interface DriftAssist {
  /** None slower than `minSpeed` (m/s), all of it from `fullSpeed`, in proportion between. */
  minSpeed: number;
  fullSpeed: number;
  /** None up to a slide of `from`, all of it from `full`, smoothly between (a switch at one angle dropped the grip at once). */
  from: number;
  full: number;
  /** The stability control none of it to a slide of `escFrom`, all of it from `escFull` (a spin caught). */
  escFrom: number;
  escFull: number;
  /**
   * The rear tyres' grip (sideways and straight on) times this, the throttle on or off (the player holds it on: the
   * slide is the steering's).
   */
  rearGrip: number;
  /**
   * The slide pulled back to what the steering sets, at any slide (a spring: driftHeld, driftInto, driftLimit; the
   * stability control can't - it holds the turning to what the steering asks, and full lock asks for a spin): none
   * (straight on) with the wheel straight or counter-steered, `limit` on full lock into the turn, between by the
   * steering's square (a little steering a little of it), followed (driftFollow: at once it was too quick) - growing
   * over `steerUp` s (the turn held into a while), coming back over `steerDown` s (let go: slowly straight). Past it the
   * body turned back, `hold` N·m per rad past, `damp` per rad/s of its growing, at most `holdMax`. Under it, nothing.
   */
  limit: number;
  steerUp: number;
  steerDown: number;
  hold: number;
  damp: number;
  holdMax: number;
  /** The drive in full up to a slide of `powerFrom`, down to `least` of it by `powerTo` (full throttle on the keys spun the cars round). */
  powerFrom: number;
  powerTo: number;
  least: number;
  /**
   * The car pushed toward its nose (arcade, driftCarve): square to its motion (its speed as it was), `carve` m/s², and
   * `carveOn` more on full throttle (in proportion: on the throttle it goes faster and took the bend wider) once the
   * slide is `carveFull` (rad), in proportion under it from none - by the slide, not by how much it drifts (it was too
   * little in a small slide) - it goes where the nose points.
   */
  carve: number;
  carveOn: number;
  carveFull: number;
  /**
   * On the throttle sliding, the body turned to slide more (driftSpin: N·m on full throttle, as much as it drifts) -
   * against the spring (driftLimit), which holds it some spin / hold rad past what the steering sets.
   */
  spin: number;
  /** The keyboard racers' drift (PlayerCar.arcadeDrift: any car set up with it): by its turning force, not a ceiling. */
  arcade?: ArcadeDrift;
  /** The AI's drift, this car's own (none: MOUNTAIN_DRIVER.drift's). */
  ai?: AiDrift;
}

/** A car's own AI drift (over MOUNTAIN_DRIVER.drift). */
export interface AiDrift {
  /**
   * Its throttle holding the drift (in an arcade drift the slide is the throttle's - the same throttle slid a stronger
   * car further; MOUNTAIN_DRIVER.drift.gasMid).
   */
  gas: number;
  /** Its handbrake mid-drift: pulled when it will run wide this far on (s; drift.pullLook)... */
  pullLook?: number;
  /** ...for this long (s; drift.hbPulse). */
  hbPulse?: number;
}

/**
 * The player's drift, the keyboard racers' way (Need for Speed's): no ceiling on the slide - the inputs turn the body
 * (N·m, as much as it drifts): steering into the turn and the throttle more of it, counter-steering and off the gas
 * less; the slide's change damped. The rear tyres' drive kept whole (their grip less sideways only): pushing along the
 * nose, the car's path turns after its nose - it circles, it does not spin. Past `safe` (rad) the spring (hold, damp)
 * pulls it back, and the stability control from `escFrom` to `escFull` - a last net, out of the way.
 */
export interface ArcadeDrift {
  /** Into the turn on full lock, and on full throttle (more slide). */
  steer: number;
  gas: number;
  /** Counter-steering on full lock, and off the gas (less slide). */
  counter: number;
  lift: number;
  /**
   * The slide drawn back, N·m per rad of it, from none (its path catching up its nose, the tyres' own straightening -
   * not a ceiling: at any slide, in proportion): the inputs' turn against it settles the slide (without it the car
   * with its rear's grip down turned on round by itself, full lock 75°/s, to the last net).
   */
  align: number;
  /** The slide's change held back, N·m per rad/s, at most `dampMax`. */
  damp: number;
  dampMax: number;
  safe: number;
  escFrom: number;
  escFull: number;
  /**
   * Into the drift, thrown in - the handbrake, or braking with the wheel `enterSteer` over (its weight forward), its
   * slide past the drift's own (DriftAssist from) within `enterArm` s: by that slide (from..full). Not the wheel alone
   * (held round a long bend on grip, 2-4° of slide, it slid out to 20°; a lane change's tap, the wheel all the way over
   * in 0.1 s). Else only by a big slide: from `enterFrom` (at `enterSlow` m/s and under; `enterFromFast` at
   * `enterFast` and over - the faster, the more slide it takes) to `enterFull` rad. In, it stays (from..full) till the
   * slide is back under `from`. How much it drifts rises `enterRate` a second at most (no lurch as it locks in).
   */
  enterSteer: number;
  enterArm: number;
  enterFrom: number;
  enterFromFast: number;
  enterSlow: number;
  enterFast: number;
  enterFull: number;
  enterRate: number;
}

/** The slide (rad) a big slide's drift starts from at this speed (m/s): ArcadeDrift.enterFrom..enterFromFast. */
export function arcadeEnterFrom(speed: number, a: ArcadeDrift): number {
  const k = Math.min(1, Math.max(0, (Math.abs(speed) - a.enterSlow) / (a.enterFast - a.enterSlow)));
  return a.enterFrom + (a.enterFromFast - a.enterFrom) * k;
}

/**
 * How much an arcade drift drifts (0..1) - in it (`latched`) by the drift's slide, else by the bigger one's
 * (ArcadeDrift.enterFrom..enterFull); `share` and `big` the two shares at this slide, `prev` its last, risen
 * `enterRate`·dt at most.
 */
export function arcadeShare(share: number, big: number, latched: boolean, prev: number, dt: number, a: ArcadeDrift): number {
  const want = latched ? share : big;
  return want > prev ? Math.min(want, prev + a.enterRate * dt) : want;
}

/**
 * The player's drift turn (N·m; + turning it right, as escTorque) at this slide (rad, + its motion to its right), its
 * change (rad/s), the steering into the turn (driftInto, -1..1), the throttle (0..1) and how much it drifts (0..1).
 */
export function arcadeTurn(slide: number, rate: number, into: number, throttle: number, share: number, a: ArcadeDrift): number {
  const more = a.steer * Math.max(0, into) + a.gas * throttle; // (toward more slide)
  const less = a.counter * Math.max(0, -into) + a.lift * (1 - throttle);
  const damp = Math.max(-a.dampMax, Math.min(a.dampMax, a.damp * rate));
  // (more slide: turning against its sign - as driftSpin; drawn back by it, in proportion; the damping against its
  // change, either way)
  return (-Math.sign(slide) * (more - less) + a.align * slide + damp) * share + 0;
}

/** At speed: none under minSpeed, all of it from fullSpeed (m/s, either way) - the drift assist's share by speed alone. */
export function driftSpeed(speed: number, d: DriftAssist): number {
  return Math.min(1, Math.max(0, (Math.abs(speed) - d.minSpeed) / (d.fullSpeed - d.minSpeed)));
}

/** How much the car drifts (0..1) at this slide (rad, either way) and speed (m/s): from `from` to `full`, smoothly. */
export function driftShare(slide: number, speed: number, d: DriftAssist): number {
  const x = Math.min(1, Math.max(0, (Math.abs(slide) - d.from) / (d.full - d.from)));
  return x * x * (3 - 2 * x) * driftSpeed(speed, d);
}


/** In a drift, the share of the drive let through at this slide (rad). */
export function driftDrive(slide: number, d: DriftAssist): number {
  const k = Math.min(1, Math.max(0, (slide - d.powerFrom) / (d.powerTo - d.powerFrom)));
  return 1 - (1 - d.least) * k;
}

/**
 * In a drift, the steering into the turn (-1..1: toward the side the nose swung, + into it, - counter-steering), from
 * the slide (rad, + its motion to its right: the nose left of it) and the steering (-1..1, + right).
 */
export function driftInto(slide: number, steer: number): number {
  return -Math.sign(slide) * steer + 0;
}

/**
 * In a drift, the slide the steering asks to be pulled back to (rad) at `into` (driftInto): `limit` on full lock into
 * the turn, none with the wheel straight or counter-steered, between by `into`'s square.
 */
export function driftHeld(into: number, d: DriftAssist): number {
  return into > 0 ? d.limit * into * into : 0;
}

/** In a drift, the slide held (rad) following the steering's `target` (driftHeld): up over steerUp s, down over steerDown. */
export function driftFollow(held: number, target: number, dt: number, d: DriftAssist): number {
  return held + (target - held) * Math.min(1, dt / (target > held ? d.steerUp : d.steerDown));
}

/**
 * In a drift, the yaw torque (N·m; + turning it right, as escTorque) keeping the slide under `held` (rad: driftHeld,
 * followed): `slide` signed (+ its motion to its right), `rate` its change (rad/s). None under it.
 */
export function driftLimit(slide: number, rate: number, d: DriftAssist, held = d.limit): number {
  const over = Math.abs(slide) - held;
  if (over <= 0) return 0;
  const way = Math.sign(slide);
  return way * Math.min(d.holdMax, Math.max(0, d.hold * over + d.damp * rate * way));
}

/** In a drift, the share of the stability control at this slide (rad). */
export function driftEsc(slide: number, d: DriftAssist): number {
  return Math.min(1, Math.max(0, (slide - d.escFrom) / (d.escFull - d.escFrom)));
}

/**
 * The throttle's turn of the body (N·m; + turning it right, as escTorque - the slide more: against driftLimit) at this
 * slide (rad, + its motion to its right), throttle (0..1) and drift (0..1, driftShare).
 */
export function driftSpin(slide: number, throttle: number, share: number, d: DriftAssist): number {
  return -Math.sign(slide) * d.spin * throttle * share + 0;
}

/** The push toward the nose (m/s², square to the motion) at this slide (rad, either way), speed (m/s) and throttle (0..1). */
export function driftCarve(slide: number, speed: number, throttle: number, d: DriftAssist): number {
  return (d.carve + d.carveOn * throttle) * Math.min(1, Math.abs(slide) / d.carveFull) * driftSpeed(speed, d);
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
