import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PHYSICS_DT } from '../config';
import { laneCenter } from '../road/coords';
import { EntityRef, PLAYER_GROUPS, PhysicsWorld, RIVAL_GROUPS } from '../physics/physicsWorld';
import { CarParams, DriveInput, driveCommand, DriveMode, escPowerTrim, escTargetYawRate, escTorque, Gearbox, revsFalling, rollInfluenceAt, shuntRevs, limiterBounce, LIMITER_SHARE, SHUNT_MIN_SPEED, SHUNT_OFF, SHUNT_ON, smoothSteer, aeroGripScale, steerAngle } from './handling';
import { CarSpec, CarStyle, STREET_RACER } from './cars';
import { Nitro, NITRO } from './nitro';
import { buildCar, buildWheel, mergeStillParts, MIRROR_X, setBrake, VehicleLights } from './models';
import { SmokeLight, smokeLightFromSpot } from '../world/tireSmoke';
import { AIM_DOWN, createHeadlight, HEADLIGHT_DECAY, HEADLIGHTS, HIGH_BEAM_DECAY } from './headlight';
import { ExhaustFlames } from '../render/exhaustFlames';
import { Backfire } from './backfire';
import { emitFlares } from './npcVehicle';
import type { LightFlares } from '../render/lightFlares';
import type { BodyInstances } from '../render/bodyInstances';
import { TireParams } from './tireModel';
import { ChassisWheel, makeWheel, TyreChassis } from './tyreChassis';

/** How to build a PlayerCar (the player's, a rival's, or a training ghost). */
export interface PlayerCarOptions {
  /** Car type (default: the street racer). */
  spec?: CarSpec;
  /** Who the collider is: the player (default) or a rival. Without a scene and without this: a ghost. */
  entity?: Extract<EntityRef, { type: 'player' } | { type: 'rival' }>;
  /** Body colour (default: the spec's). */
  color?: number;
  /** Paint job, for a car with a model file (carModels.ts; default: its own). */
  livery?: string;
  /** Real headlights that light the scene (default true; rivals use glowing beams instead). */
  realLights?: boolean;
}

/** The street racer's size (each car's own: CarParams.width, length; PlayerCar.width, length). */
export const PLAYER_W = 1.86;
export const PLAYER_H = 1.1;
export const PLAYER_L = 4.4;

const WHEEL_W = 0.3;
const HALF_TRACK = 0.8;
/** The rear tyres' grip in a burnout, times: the front brakes alone hold the car. */
const BURNOUT_REAR_GRIP = 0.6;
const CONNECTION_Y = 0; // suspension hard points, chassis space
const RIDE_Y = 0.55; // chassis center height at static ride
const G = 9.81;
/** A wheel has no lamps. */
const NO_LIGHTS: VehicleLights = { left: [], right: [], brake: [], third: [] };
const CALIPER_AT = new THREE.Matrix4();
const SHOW_FWD = new THREE.Vector3();
const LOAD_AXIS = new THREE.Vector3();
const LOAD_Q = new THREE.Quaternion();

/**
 * The body's friction on what it touches (the road, the rails, other cars; the lesser of the two: Min), by how far
 * over it is. Upright, 0.02: its underside grounding under a hard brake hardly slows it, and it slides along a rail
 * or another car rather than catching (at 0.1 grounding dragged it; at 0.3 light knocks rolled it). On its side or
 * its roof, 0.4 - metal on asphalt: at 0.02 a car rolled over at 100 km/h slid on ~1.2 km. Between, from 45 degrees
 * over to 90, an S-curve.
 */
export const BODY_FRICTION = { upright: 0.02, rolled: 0.4, fromDeg: 45 };

/** The body's friction with its up pointing `upY` (its roof's way, world y: 1 upright, 0 on its side, -1 on its roof). */
export function bodyFriction(upY: number): number {
  const from = Math.cos(THREE.MathUtils.degToRad(BODY_FRICTION.fromDeg));
  const t = Math.min(1, Math.max(0, (from - upY) / from));
  return BODY_FRICTION.upright + (BODY_FRICTION.rolled - BODY_FRICTION.upright) * t * t * (3 - 2 * t);
}

/** The mass one wheel carries standing still (kg): half its axle's share (comFwd puts more on the front). */
export function wheelLoad(p: Pick<CarParams, 'mass' | 'comFwd' | 'wheelbase'>, front: boolean): number {
  const frontShare = 0.5 + p.comFwd / p.wheelbase;
  return (p.mass * (front ? frontShare : 1 - frontShare)) / 2;
}

/** Road-relative yaw from a Y-only quaternion (yaw = -rotation.y). */
export function yawOf(q: { x: number; y: number; z: number; w: number }): number {
  return -2 * Math.atan2(q.y, q.w);
}

export function quatFromYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(-yaw / 2), z: 0, w: Math.cos(-yaw / 2) };
}

const TMP_Q = new THREE.Quaternion();
const TMP_V = new THREE.Vector3();
/** s its acceleration is smoothed over (a crash's spike, the springs' shake). */
const ACCEL_SMOOTH = 0.1;

/** Heading of an arbitrarily rotated body, measured on the road plane. */
function headingYaw(q: { x: number; y: number; z: number; w: number }): number {
  TMP_V.set(0, 0, -1).applyQuaternion(TMP_Q.set(q.x, q.y, q.z, q.w));
  return Math.atan2(TMP_V.x, -TMP_V.z);
}

type WheelState = ChassisWheel;

/**
 * The hood camera on each body (its own terms, m: up from its middle, along it - the nose -z): over the back of its
 * hood (36 % of its length back from the nose), 0.3 m above the hood there - measured on the models.
 */
const HOOD_EYE: Record<CarStyle, [y: number, z: number]> = {
  super: [0.6, -0.65], // (0.15 m over its hood: its short sloping hood seen at all)
  muscle: [0.68, -0.51],
  jdm: [0.78, -0.53],
};

/**
 * The player's car: a Rapier chassis on four ray-cast wheels with our own
 * spring/damper suspension, anti-roll bars, rear-wheel drive and a tyre model
 * with a friction limit (wheelspin, lock-up, slides, oversteer).
 */
export class PlayerCar {
  readonly body: RAPIER.RigidBody;
  /** The body's collision shape: a box, or its spec's convex pieces (none for ghosts). */
  readonly colliders: RAPIER.Collider[];
  readonly mesh: THREE.Group;
  /** The hood camera's place on the car (its own terms: HOOD_EYE). */
  readonly hoodEye = new THREE.Vector3();
  private readonly lights: VehicleLights;
  private flames: ExhaustFlames | null = null;
  private held = false;
  private readonly backfire = new Backfire();
  private readonly visuals: ReturnType<typeof buildWheel>[] = [];
  /**
   * For show (the race's intro, game/intro): drawn this far ahead of where it is (m; behind: < 0), its wheels
   * rolled to it; the engine's rpm and throttle as heard and seen at the exhaust, and its brake lights (null: its
   * own).
   */
  showOffset = 0;
  showRev: { rpm: number; throttle: number } | null = null;
  showBrake: boolean | null = null;
  readonly chassis: TyreChassis;
  readonly wheels: WheelState[];
  params: CarParams;
  /** Its body and engine: which car it is (its engine's sound by it). */
  readonly style: CarStyle;
  private steer = 0;
  private throttle = 0;
  readonly gearbox = new Gearbox();
  /** Its nitro (full at the race's start: the game's; a reset on the road keeps it). */
  readonly nitro = new Nitro();
  readonly headlights: THREE.SpotLight[] = [];
  rpm = 900;
  /** The revs without the shunt (rpm is them with it); how long since the drive bit again (s); off the throttle since. */
  private baseRpm = 900;
  private sinceBite = Infinity;
  private offThrottle = false;
  /** s on the rev limiter (-1: off it). */
  private onLimiter = -1;
  driveMode: DriveMode = 'D';
  /** Optional per-position grip multiplier (e.g. grass). */
  surfaceGrip: (x: number) => number = () => 1;

  // Read back from the body after each physics step.
  s = 0;
  d = 0;
  yaw = 0;
  vLong = 0;
  vLat = 0;
  /** Its acceleration (m/s²) along its nose and across it (+ toward its right, +d), over the last ~ACCEL_SMOOTH s. */
  aLong = 0;
  aLat = 0;
  private lastVx = NaN;
  private lastVz = 0;

  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private currQuat = new THREE.Quaternion();

  /**
   * @param scene where to add the car's model (and, for the player, its real
   * headlights). Null and no `opts.entity`: an AI training "ghost" - same
   * physics, no visuals, and it only touches the road.
   */
  constructor(physics: PhysicsWorld, scene: THREE.Scene | null, opts: PlayerCarOptions = {}) {
    const spec = opts.spec ?? STREET_RACER;
    this.style = spec.style;
    this.params = { ...spec.params };
    const p = this.params;
    const ghost = !opts.entity && scene === null;
    const entity = opts.entity ?? { type: 'player' };
    const inertia = {
      x: (p.mass / 12) * (0.8 * 0.8 + p.length * p.length),
      y: (p.mass / 12) * (p.width * p.width + p.length * p.length),
      z: (p.mass / 12) * (p.width * p.width + 0.8 * 0.8),
    };
    // The mass is the body's own (COM at body y + comY, comFwd toward the nose), not its colliders' (they
    // weigh nothing): the collision shape can follow the car's body without changing how it drives.
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(laneCenter(1), RIDE_Y, 0)
      .setCanSleep(false)
      .setAdditionalMassProperties(p.mass, { x: 0, y: p.comY, z: -p.comFwd }, inertia, { x: 0, y: 0, z: 0, w: 1 });
    if (ghost) {
      // No collider at all: a ghost stands on its wheel rays only, and with dozens
      // of them stacked on the start line, the rays must not have to test each other.
      this.body = physics.world.createRigidBody(bodyDesc);
      this.colliders = [];
    } else {
      this.body = physics.world.createRigidBody(bodyDesc.setCcdEnabled(true));
      const shapes = spec.collider?.map((pts) => RAPIER.ColliderDesc.convexHull(new Float32Array(pts))!) ?? [
        RAPIER.ColliderDesc.roundCuboid(p.width / 2 - 0.05, 0.3, p.length / 2 - 0.05, 0.05).setTranslation(0, 0.1, 0),
      ];
      this.colliders = shapes.map((shape) => {
        const c = physics.world.createCollider(
          shape
            .setDensity(0)
            // The body slides on what it touches (BODY_FRICTION: upright; rolled over, more - set each step by
            // how far over it is, prePhysics). The tyres grip apart.
            .setFriction(BODY_FRICTION.upright)
            .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
            .setRestitution(0.05)
            .setCollisionGroups(entity.type === 'rival' ? RIVAL_GROUPS : PLAYER_GROUPS)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
          this.body,
        );
        physics.register(c, entity);
        return c;
      });
    }

    // Wheels: 0 FL, 1 FR, 2 RL, 3 RR.
    const wheels: WheelState[] = [];
    for (const [x, z] of [
      [-HALF_TRACK, -p.wheelbase / 2],
      [HALF_TRACK, -p.wheelbase / 2],
      [-HALF_TRACK, p.wheelbase / 2],
      [HALF_TRACK, p.wheelbase / 2],
    ]) {
      wheels.push(
        makeWheel(
          // Each spring as stiff as its corner is heavy (springK at a quarter of the weight; set each step,
          // prePhysics): the car sits level.
          { x, z, connY: CONNECTION_Y, r: p.wheelRadius, front: z < 0, springK: p.springK, bump: p.damperBump, rebound: p.damperRebound, mEff: wheelLoad(p, z < 0) * 0.9, gripScale: 1 },
          p.suspensionRest - 0.09,
        ),
      );
    }
    this.wheels = wheels;
    this.chassis = new TyreChassis(physics, this.body, wheels, this.chassisSetup());

    if (scene === null) {
      this.mesh = new THREE.Group();
      this.lights = { left: [], right: [], brake: [], third: [] };
      this.readBack();
      this.snapInterpolation();
      return;
    }
    const realLights = opts.realLights ?? true;
    // Without real lights it shows NPC-style glowing beams instead (rivals: real lights are expensive).
    const model = buildCar(p.width, PLAYER_H, p.length, opts.color ?? spec.color, spec.style, false, !realLights, opts.livery);
    mergeStillParts(model); // (its lamps and pipes a draw a material)
    // Real low-beam headlights, one per lamp: the only car lights that actually
    // light the scene. Each is aimed a few degrees down (beams parallel) and
    // shaped by the low-beam cookie, so the road gets a sharp cut-off instead
    // of a round cone; the two beams overlap ahead and each casts its own shadow.
    for (const side of realLights ? [-1, 1] : []) {
      const x = side * (p.width / 2 - 0.4);
      const hl = createHeadlight(HEADLIGHTS.pair / 2);
      hl.position.set(x, -0.05, -p.length / 2 - 0.15);
      model.root.add(hl, hl.target);
      this.headlights.push(hl);
    }
    this.setHighBeam(false);
    this.mesh = model.root;
    this.hoodEye.set(0, ...HOOD_EYE[spec.style]);
    this.lights = model.lights;
    const tips = (model.root.userData.exhausts ?? []) as THREE.Vector3[];
    if (tips.length) this.flames = new ExhaustFlames(this.mesh, tips);
    for (let i = 0; i < 4; i++) {
      const w = buildWheel(p.wheelRadius, WHEEL_W, spec.style, i % 2 === 0); // even: the left wheels
      this.mesh.add(w.steer);
      this.visuals.push(w);
    }
    scene!.add(this.mesh);
    this.readBack();
    this.snapInterpolation();
  }

  get speed(): number {
    return this.vLong;
  }

  /** Its body's size (m): its collider, the box others see. */
  get width(): number {
    return this.params.width;
  }

  get length(): number {
    return this.params.length;
  }

  /** Yaw rate (rad/s), positive turning toward +d like `yaw`. */
  get yawRate(): number {
    return -this.body.angvel().y;
  }

  /** Roll rate (rad/s about its own nose, + leaning onto its right side) and pitch rate (+ nose up). */
  get rollRate(): number {
    return -this.localSpin().z;
  }

  get pitchRate(): number {
    return this.localSpin().x;
  }

  /** The body's angular velocity in its own axes (x its right, y up, z its tail). */
  private localSpin(): THREE.Vector3 {
    const w = this.body.angvel();
    const q = this.body.rotation();
    return TMP_V.set(w.x, w.y, w.z).applyQuaternion(TMP_Q.set(q.x, q.y, q.z, q.w).invert());
  }

  /** Where the steering is now (-1..1): the input after its rise / return ramp. */
  get wheel(): number {
    return this.steer;
  }

  /** Strongest tyre slide this step (m/s of slip), for sound. */
  get maxSlip(): number {
    return this.chassis.maxSlip;
  }

  private chassisSetup(speed = 0) {
    const p = this.params;
    const tire: TireParams = {
      muPeak: p.muPeak,
      muSlide: p.muSlide,
      slipAnglePeak: p.slipAnglePeak,
      rollingResistance: 0.012,
      regripSpeed: 0.6,
      slipFalloff: p.slipFalloff,
    };
    return {
      rest: p.suspensionRest,
      travel: p.suspensionTravel,
      progressFrom: p.springProgressFrom,
      progressMult: p.springProgressMult,
      inertia: p.wheelInertia,
      antiRoll: [
        [0, 1, p.antiRollFront],
        [2, 3, p.antiRollRear],
      ] as [number, number, number][],
      rollInfluence: rollInfluenceAt(speed, p),
      tire,
      surfaceGrip: (x: number) => this.surfaceGrip(x),
      frontBrakeApart: p.frontBrakeApart,
    };
  }

  /** The body's friction as it is lying now (bodyFriction: upright, or over on its side or roof). */
  private rollFriction(): void {
    const q = this.body.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z); // (its up's world y)
    const f = bodyFriction(upY);
    // (set only as it changes - but always onto its ends, not left a little off them)
    const end = f === BODY_FRICTION.upright || f === BODY_FRICTION.rolled;
    if (f === this.bodyFrictionNow || (!end && Math.abs(f - this.bodyFrictionNow) < 0.002)) return;
    this.bodyFrictionNow = f;
    for (const c of this.colliders) c.setFriction(f);
  }
  private bodyFrictionNow = BODY_FRICTION.upright;

  /** Driver input → wheel torques → tyre forces, plus suspension and aero. Call before world.step. */
  prePhysics(input: DriveInput, dt: number): void {
    const p = this.params;
    this.readBack();
    this.rollFriction();

    this.steer = smoothSteer(this.steer, input.steer, p, dt, this.vLong);
    // Driver input: relative to the nose, range from speed. Hands off: wheels trail the slide.
    const steerAngleCmd = steerAngle(this.steer, this.vLong, this.vLat, p);
    // Stability control: nudge the rotation toward what the steering asks for.
    const yawRate = -this.body.angvel().y;
    const esc = escTorque(yawRate, escTargetYawRate(steerAngleCmd, this.vLong, p), this.vLong, p);
    if (esc !== 0) this.body.applyTorqueImpulse({ x: 0, y: -esc * dt, z: 0 }, true);
    const bodySlip = Math.abs(Math.atan2(this.vLat, Math.max(Math.abs(this.vLong), 1)));
    const targetThrottle = input.throttle;
    this.throttle += Math.sign(targetThrottle - this.throttle) * Math.min(Math.abs(targetThrottle - this.throttle), p.throttleRise * dt);

    // Engine power is limited by how fast the driven wheels turn (wheelspin eats power).
    const rearOmega = (this.wheels[2].omega + this.wheels[3].omega) / 2;
    const gear = this.gearbox.gear, wasShifting = this.gearbox.shifting;
    this.gearbox.update(this.vLong, dt, p, rearOmega);
    // Displayed / audible rpm bounces off the limiter but never far past it; it winds down, not drops, as the
    // wheels slow (revsFalling) - but for a shift, whose own fall (the gearbox's) is the gearbox's speed.
    const revs = Math.min(p.redline * 1.03, this.gearbox.engineRpm(rearOmega, p));
    const shifting = this.gearbox.shifting || this.gearbox.gear !== gear;
    this.baseRpm = shifting ? revs : revsFalling(this.baseRpm, revs, dt);
    // The drive biting again - an upshift's, or the throttle back on (driving) after it was let off: the
    // driveline's slack taken up, the revs shudder a moment (shuntRevs) as they carry on.
    if (this.throttle < SHUNT_OFF) this.offThrottle = true;
    const tipIn = this.offThrottle && this.throttle > SHUNT_ON && Math.abs(this.vLong) > SHUNT_MIN_SPEED;
    if (tipIn || (wasShifting && !this.gearbox.shifting)) {
      this.sinceBite = 0;
      this.offThrottle = false;
    } else this.sinceBite += dt;
    this.rpm = this.baseRpm + shuntRevs(this.sinceBite, input.throttle);
    // On the rev limiter: how long (the gauge's needle bounces by it, gaugeRpm).
    this.onLimiter = this.rpm >= p.redline * LIMITER_SHARE && this.throttle > 0.5 ? Math.max(0, this.onLimiter) + dt : -1;
    // Nitro: a harder push, a little past the limiter (on the throttle only).
    const boost = this.nitro.update(dt, !!input.nitro && input.throttle > 0);
    const limit = boost ? { ...p, maxSpeed: p.maxSpeed * NITRO.topSpeed } : p;
    const cmd = driveCommand({ ...input, throttle: this.throttle }, this.vLong, limit, this.driveMode);
    this.driveMode = cmd.mode;
    // Forward drive comes from the engine through the current gear (reverse keeps
    // the simple pedal force). The rev limiter bounds wheelspin.
    if (cmd.engineForce > 0) cmd.engineForce = this.gearbox.wheelTorque(this.throttle, rearOmega, p) / p.wheelRadius;
    if (boost && this.driveMode === 'D') cmd.engineForce *= NITRO.force;
    // Stability control also trims power once the car is sliding sideways (never all of it: escPowerTrim).
    if (p.escGain > 0 && cmd.engineForce > 0) cmd.engineForce *= escPowerTrim(bodySlip);
    const brakeTorqueFront = (input.handbrake ? 1 : cmd.brake) * p.brakeForceMax * p.brakeFrontBias * 0.5 * p.wheelRadius;
    // A burnout (both keys, stopped): the front brakes hold it, the driven rear wheels spin free of theirs.
    const brakeTorqueRear = cmd.burnout ? 0 : (input.handbrake ? 1 : cmd.brake) * p.brakeForceMax * (1 - p.brakeFrontBias) * 0.5 * p.wheelRadius;
    const driveTorqueRear = cmd.engineForce * 0.5 * p.wheelRadius;
    setBrake(this.lights, this.showBrake ?? (cmd.brake > 0 && (Math.abs(this.vLong) > 0.5 || !!cmd.burnout)));

    // Limited-slip diff: torque moves from the faster-spinning rear wheel to the slower one,
    // so both rears light up (and hook up) together instead of one-wheel peel.
    const lsd = Math.max(-p.lsdMax, Math.min(p.lsdMax, p.lsd * (this.wheels[2].omega - this.wheels[3].omega)));
    this.chassis.setup = this.chassisSetup(this.vLong);
    const grip = aeroGripScale(Math.hypot(this.vLong, this.vLat), p);
    for (const w of this.wheels) {
      w.springK = (p.springK * wheelLoad(p, w.front)) / (p.mass / 4); // as stiff as its corner is heavy
      w.bump = p.damperBump;
      w.rebound = p.damperRebound;
      // In a burnout the spinning rear tyres push less (arcade): the front brakes hold every car, even a tail-heavy one.
      w.gripScale = (w.front ? 1 : p.rearGrip * (cmd.burnout ? BURNOUT_REAR_GRIP : 1)) * grip;
    }
    this.chassis.step(
      dt,
      [steerAngleCmd, steerAngleCmd, 0, 0],
      [0, 0, driveTorqueRear - lsd, driveTorqueRear + lsd],
      [brakeTorqueFront, brakeTorqueFront, brakeTorqueRear, brakeTorqueRear],
    );

    // 3) Aerodynamics: drag against motion, downforce growing with speed.
    const lv = this.body.linvel();
    const sp = Math.hypot(lv.x, lv.z);
    if (sp > 0.1) {
      const drag = p.dragK * sp * dt;
      const down = p.downforceK * sp * sp * dt;
      this.body.applyImpulse({ x: -lv.x * drag, y: -down, z: -lv.z * drag }, true);
    }

    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  /** Call after world.step. */
  postPhysics(): void {
    this.readBack();
    const v = this.body.linvel();
    if (!Number.isNaN(this.lastVx)) {
      const ax = (v.x - this.lastVx) / PHYSICS_DT;
      const az = (v.z - this.lastVz) / PHYSICS_DT;
      const k = PHYSICS_DT / (ACCEL_SMOOTH + PHYSICS_DT);
      this.aLong += k * (ax * Math.sin(this.yaw) - az * Math.cos(this.yaw) - this.aLong);
      this.aLat += k * (ax * Math.cos(this.yaw) + az * Math.sin(this.yaw) - this.aLat);
    }
    this.lastVx = v.x;
    this.lastVz = v.z;
    const t = this.body.translation();
    const q = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(q.x, q.y, q.z, q.w);
  }

  private readBack(): void {
    const t = this.body.translation();
    const v = this.body.linvel();
    this.yaw = headingYaw(this.body.rotation());
    this.s = -t.z;
    this.d = t.x;
    const fx = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    this.vLong = v.x * fx + v.z * fz;
    this.vLat = v.x * Math.cos(this.yaw) + v.z * Math.sin(this.yaw);
  }

  private snapInterpolation(): void {
    this.lastVx = NaN; // (moved: no acceleration from the jump)
    this.aLong = 0;
    this.aLat = 0;
    const t = this.body.translation();
    const q = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.prevPos.copy(this.currPos);
    this.currQuat.set(q.x, q.y, q.z, q.w);
    this.prevQuat.copy(this.currQuat);
  }

  /** Place the car in a lane, upright, pointing down the road, at the given speed. */
  /** Take the car out of the world for good (another car type takes its place): body, collider, model and lights. */
  dispose(physics: PhysicsWorld): void {
    for (const c of this.colliders) physics.unregister(c);
    physics.world.removeRigidBody(this.body); // its colliders go with it
    this.flames?.dispose();
    this.mesh.removeFromParent();
  }

  /**
   * Its exhaust's flames this frame (`dt` s; 0 paused): a backfire lifting off at high revs, blue on nitro. Whether
   * a flame lit (its pop's cue; not on nitro, its flame not shown).
   */
  exhaust(dt: number): boolean {
    const pops = this.backfire.update(dt, this.shownThrottle, this.shownRpm / this.params.redline);
    this.flames?.update(dt, pops, this.nitro.active);
    return this.backfire.lit && !this.nitro.active;
  }

  /**
   * A braking load for show (call before each physics step): what braking at `decel` m/s² does to the body -
   * the grip at the road behind its centre of mass pitching it nose down (mass x decel x the centre's height) - as
   * a torque on its own springs, while it stands held (the intro's cars, drawn arriving: they dive and come back
   * on their own suspension, as tuned).
   */
  brakeLoad(decel: number, dt: number): void {
    if (decel <= 0) return;
    const q = this.body.rotation();
    LOAD_AXIS.set(1, 0, 0).applyQuaternion(LOAD_Q.set(q.x, q.y, q.z, q.w)); // its right: nose down is about it, negative
    const height = this.body.translation().y + this.params.comY;
    const impulse = -this.params.mass * decel * height * dt;
    this.body.applyTorqueImpulse({ x: LOAD_AXIS.x * impulse, y: LOAD_AXIS.y * impulse, z: LOAD_AXIS.z * impulse }, true);
  }

  /** The engine as heard and seen at the exhaust: its own, or a blip put on for show (`showRev`). */
  get shownRpm(): number {
    return this.showRev?.rpm ?? this.rpm;
  }

  /** The rpm on the gauge: the engine's, its needle bouncing on the rev limiter (limiterBounce). */
  get gaugeRpm(): number {
    return this.rpm + (this.onLimiter >= 0 ? limiterBounce(this.onLimiter) : 0);
  }

  get shownThrottle(): number {
    return this.showRev?.throttle ?? this.throttle;
  }

  /**
   * Held to its spot (the start grid) or let go: it can't move along the ground nor turn, but rises, squats and
   * rocks on its springs and spins its wheels as it pleases (a burnout on the line goes nowhere).
   */
  holdInPlace(on: boolean): void {
    if (on === this.held) return;
    this.held = on;
    this.body.setEnabledTranslations(!on, true, !on, true);
    this.body.setEnabledRotations(true, !on, true, true);
    if (on) {
      const v = this.body.linvel();
      const w = this.body.angvel();
      this.body.setLinvel({ x: 0, y: v.y, z: 0 }, true);
      this.body.setAngvel({ x: w.x, y: 0, z: w.z }, true);
    }
  }

  resetTo(s: number, lane: number, speed: number): void {
    const p = this.params;
    this.body.setTranslation({ x: laneCenter(lane), y: RIDE_Y + 0.02, z: -s }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.throttle = 0;
    this.backfire.reset();
    this.gearbox.reset();
    this.driveMode = 'D';
    for (const w of this.wheels) {
      w.omega = speed / p.wheelRadius;
      w.susp = p.suspensionRest - (p.mass * G) / 4 / p.springK; // the same at every corner (springs as stiff as it is heavy)
      w.sliding = false;
    }
    this.readBack();
    this.snapInterpolation();
  }

  /** Interpolated chassis pose and current wheel poses for rendering (`showOffset` ahead, its wheels rolled to it). */
  render(alpha: number, flares?: LightFlares): void {
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    // Along its heading on the ground, level (its pitch left out: a dive's few degrees over the arrival's tens of
    // metres lifted the whole car, wheels and all, off the road).
    if (this.showOffset !== 0) {
      SHOW_FWD.set(0, 0, -1).applyQuaternion(this.mesh.quaternion).setY(0).normalize();
      this.mesh.position.addScaledVector(SHOW_FWD, this.showOffset);
    }
    const roll = this.showOffset / this.params.wheelRadius;
    if (flares) {
      this.mesh.updateMatrix();
      emitFlares(this.mesh, this.lights, flares);
    }
    this.wheels.forEach((w, i) => {
      const v = this.visuals[i];
      v.steer.position.set(w.x, CONNECTION_Y - w.susp, w.z);
      v.steer.rotation.y = -w.steer;
      v.spin.rotation.x = w.spin + roll;
    });
  }

  /** Its file wheels and their calipers into this frame's instanced drawing (after render: where they are). */
  addWheels(bodies: BodyInstances): void {
    if (!this.visuals.some((v) => v.file)) return;
    this.mesh.updateMatrixWorld(true);
    for (const v of this.visuals) {
      if (!v.file) continue;
      bodies.add(v.file.key, v.file.wheel, v.file.wheel.matrixWorld, NO_LIGHTS);
      const c = v.file.caliper;
      if (c) bodies.add(c.key, c.template, c.mirrored ? CALIPER_AT.multiplyMatrices(c.place.matrixWorld, MIRROR_X) : c.place.matrixWorld, NO_LIGHTS);
    }
  }

  /** The high beam on (X held: the game sets it each frame): its lamps plain spots aimed level, brighter (HEADLIGHTS.high: the game sets their brightness). */
  highBeam = false;

  /** The low beam (aimed a little down, its cut-off) or the high beam (level, no cut-off). */
  setHighBeam(on: boolean): void {
    this.highBeam = on;
    const p = this.params;
    for (const hl of this.headlights) {
      const x = hl.position.x;
      hl.decay = on ? HIGH_BEAM_DECAY : HEADLIGHT_DECAY;
      hl.target.position.set(x, -0.05 - (on ? 0 : Math.tan(AIM_DOWN) * 30), -p.length / 2 - 30);
    }
  }

  /** The headlights as seen by tyre smoke (call after render). Tail and brake lamps don't light it. */
  smokeLights(): SmokeLight[] {
    this.mesh.updateMatrixWorld();
    return this.headlights.map(smokeLightFromSpot);
  }

  /** Road-space AABB for AI / reset checks. */
  footprint(): { s: number; dMin: number; dMax: number; length: number } {
    const c = Math.abs(Math.cos(this.yaw));
    const sn = Math.abs(Math.sin(this.yaw));
    const { width: w, length: l } = this.params;
    const halfD = (w / 2) * c + (l / 2) * sn;
    const halfS = (l / 2) * c + (w / 2) * sn;
    return { s: this.s, dMin: this.d - halfD, dMax: this.d + halfD, length: halfS * 2 };
  }
}
