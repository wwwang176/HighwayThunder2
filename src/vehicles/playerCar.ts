import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { laneCenter } from '../road/coords';
import { EntityRef, PLAYER_GROUPS, PhysicsWorld, RIVAL_GROUPS } from '../physics/physicsWorld';
import { CarParams, DriveInput, driveCommand, DriveMode, escTargetYawRate, escTorque, Gearbox, rollInfluenceAt, smoothSteer, aeroGripScale, steerAngle } from './handling';
import { CarSpec, STREET_RACER } from './cars';
import { buildCar, buildWheel, setBrake, VehicleLights } from './models';
import { SmokeLight, smokeLightFromSpot } from '../world/tireSmoke';
import { AIM_DOWN, createHeadlight } from './headlight';
import { emitFlares } from './npcVehicle';
import type { LightFlares } from '../render/lightFlares';
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

export const PLAYER_W = 1.86;
export const PLAYER_H = 1.1;
export const PLAYER_L = 4.4;

const HEADLIGHT_INTENSITY = 900; // candela for both lamps together, brightest part of the beam (decay 1)
const WHEEL_W = 0.3;
const HALF_TRACK = 0.8;
const CONNECTION_Y = 0; // suspension hard points, chassis space
const RIDE_Y = 0.55; // chassis center height at static ride
const G = 9.81;

/** Road-relative yaw from a Y-only quaternion (yaw = -rotation.y). */
export function yawOf(q: { x: number; y: number; z: number; w: number }): number {
  return -2 * Math.atan2(q.y, q.w);
}

export function quatFromYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(-yaw / 2), z: 0, w: Math.cos(-yaw / 2) };
}

const TMP_Q = new THREE.Quaternion();
const TMP_V = new THREE.Vector3();

/** Heading of an arbitrarily rotated body, measured on the road plane. */
function headingYaw(q: { x: number; y: number; z: number; w: number }): number {
  TMP_V.set(0, 0, -1).applyQuaternion(TMP_Q.set(q.x, q.y, q.z, q.w));
  return Math.atan2(TMP_V.x, -TMP_V.z);
}

type WheelState = ChassisWheel;

/**
 * The player's car: a Rapier chassis on four ray-cast wheels with our own
 * spring/damper suspension, anti-roll bars, rear-wheel drive and a tyre model
 * with a friction limit (wheelspin, lock-up, slides, oversteer).
 */
export class PlayerCar {
  readonly body: RAPIER.RigidBody;
  /** The body's collision box (null for ghosts). */
  readonly collider: RAPIER.Collider | null;
  readonly mesh: THREE.Group;
  private readonly lights: VehicleLights;
  private readonly visuals: { steer: THREE.Group; spin: THREE.Group }[] = [];
  readonly chassis: TyreChassis;
  readonly wheels: WheelState[];
  params: CarParams;
  private steer = 0;
  private throttle = 0;
  readonly gearbox = new Gearbox();
  readonly headlights: THREE.SpotLight[] = [];
  rpm = 900;
  driveMode: DriveMode = 'D';
  /** Optional per-position grip multiplier (e.g. grass). */
  surfaceGrip: (x: number) => number = () => 1;

  // Read back from the body after each physics step.
  s = 0;
  d = 0;
  yaw = 0;
  vLong = 0;
  vLat = 0;

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
    this.params = { ...spec.params };
    const p = this.params;
    const ghost = !opts.entity && scene === null;
    const entity = opts.entity ?? { type: 'player' };
    const inertia = {
      x: (p.mass / 12) * (0.8 * 0.8 + PLAYER_L * PLAYER_L),
      y: (p.mass / 12) * (PLAYER_W * PLAYER_W + PLAYER_L * PLAYER_L),
      z: (p.mass / 12) * (PLAYER_W * PLAYER_W + 0.8 * 0.8),
    };
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(laneCenter(1), RIDE_Y, 0).setCanSleep(false);
    if (ghost) {
      // No collider at all: a ghost stands on its wheel rays only, and with dozens
      // of them stacked on the start line, the rays must not have to test each other.
      // Same mass properties as the player's collider gives (COM at body y + comY).
      this.body = physics.world.createRigidBody(
        bodyDesc.setAdditionalMassProperties(p.mass, { x: 0, y: p.comY, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 }),
      );
      this.collider = null;
    } else {
      this.body = physics.world.createRigidBody(bodyDesc.setCcdEnabled(true));
      this.collider = physics.world.createCollider(
        RAPIER.ColliderDesc.roundCuboid(PLAYER_W / 2 - 0.05, 0.3, PLAYER_L / 2 - 0.05, 0.05)
          .setTranslation(0, 0.1, 0)
          // The collider sits 0.1 m up the body: its mass centre is placed to land at body y + comY.
          .setMassProperties(p.mass, { x: 0, y: p.comY - 0.1, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
          .setFriction(0.3)
          .setRestitution(0.05)
          .setCollisionGroups(entity.type === 'rival' ? RIVAL_GROUPS : PLAYER_GROUPS)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        this.body,
      );
      physics.register(this.collider, entity);
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
          { x, z, connY: CONNECTION_Y, r: p.wheelRadius, front: z < 0, springK: p.springK, bump: p.damperBump, rebound: p.damperRebound, mEff: (p.mass / 4) * 0.9, gripScale: 1 },
          p.suspensionRest - 0.09,
        ),
      );
    }
    this.wheels = wheels;
    this.chassis = new TyreChassis(physics, this.body, wheels, this.chassisSetup());

    if (scene === null) {
      this.mesh = new THREE.Group();
      this.lights = { left: [], right: [], brake: [] };
      this.readBack();
      this.snapInterpolation();
      return;
    }
    const realLights = opts.realLights ?? true;
    // Without real lights it shows NPC-style glowing beams instead (rivals: real lights are expensive).
    const model = buildCar(PLAYER_W, PLAYER_H, PLAYER_L, opts.color ?? spec.color, spec.style, false, !realLights, opts.livery);
    // Real low-beam headlights, one per lamp: the only car lights that actually
    // light the scene. Each is aimed a few degrees down (beams parallel) and
    // shaped by the low-beam cookie, so the road gets a sharp cut-off instead
    // of a round cone; the two beams overlap ahead and each casts its own shadow.
    for (const side of realLights ? [-1, 1] : []) {
      const x = side * (PLAYER_W / 2 - 0.4);
      const hl = createHeadlight(HEADLIGHT_INTENSITY / 2);
      hl.position.set(x, -0.05, -PLAYER_L / 2 - 0.15);
      hl.target.position.set(x, -0.05 - Math.tan(AIM_DOWN) * 30, -PLAYER_L / 2 - 30);
      model.root.add(hl, hl.target);
      this.headlights.push(hl);
    }
    this.mesh = model.root;
    this.lights = model.lights;
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

  /** Yaw rate (rad/s), positive turning toward +d like `yaw`. */
  get yawRate(): number {
    return -this.body.angvel().y;
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
      inertia: p.wheelInertia,
      antiRoll: [
        [0, 1, p.antiRollFront],
        [2, 3, p.antiRollRear],
      ] as [number, number, number][],
      rollInfluence: rollInfluenceAt(speed, p),
      tire,
      surfaceGrip: (x: number) => this.surfaceGrip(x),
    };
  }

  /** Driver input → wheel torques → tyre forces, plus suspension and aero. Call before world.step. */
  prePhysics(input: DriveInput, dt: number): void {
    const p = this.params;
    this.readBack();

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
    this.gearbox.update(this.vLong, dt);
    // Displayed / audible rpm bounces off the limiter but never far past it.
    this.rpm = Math.min(p.redline * 1.03, this.gearbox.engineRpm(rearOmega, p));
    const cmd = driveCommand({ ...input, throttle: this.throttle }, this.vLong, p, this.driveMode);
    this.driveMode = cmd.mode;
    // Forward drive comes from the engine through the current gear (reverse keeps
    // the simple pedal force). The rev limiter bounds wheelspin.
    if (cmd.engineForce > 0) cmd.engineForce = this.gearbox.wheelTorque(this.throttle, rearOmega, p) / p.wheelRadius;
    // Stability control also trims power once the car is sliding sideways.
    if (p.escGain > 0 && cmd.engineForce > 0 && bodySlip > 0.15) {
      cmd.engineForce *= Math.max(0, 1 - (bodySlip - 0.15) / 0.2);
    }
    const brakeTorqueFront = (input.handbrake ? 1 : cmd.brake) * p.brakeForceMax * p.brakeFrontBias * 0.5 * p.wheelRadius;
    const brakeTorqueRear = (input.handbrake ? 1 : cmd.brake) * p.brakeForceMax * (1 - p.brakeFrontBias) * 0.5 * p.wheelRadius;
    const driveTorqueRear = cmd.engineForce * 0.5 * p.wheelRadius;
    setBrake(this.lights, cmd.brake > 0 && Math.abs(this.vLong) > 0.5);

    // Limited-slip diff: torque moves from the faster-spinning rear wheel to the slower one,
    // so both rears light up (and hook up) together instead of one-wheel peel.
    const lsd = Math.max(-1500, Math.min(1500, p.lsd * (this.wheels[2].omega - this.wheels[3].omega)));
    this.chassis.setup = this.chassisSetup(this.vLong);
    const grip = aeroGripScale(Math.hypot(this.vLong, this.vLat), p);
    for (const w of this.wheels) {
      w.springK = p.springK;
      w.bump = p.damperBump;
      w.rebound = p.damperRebound;
      w.gripScale = (w.front ? 1 : p.rearGrip) * grip;
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
    if (this.collider) physics.unregister(this.collider);
    physics.world.removeRigidBody(this.body); // its collider goes with it
    this.mesh.removeFromParent();
  }

  resetTo(s: number, lane: number, speed: number): void {
    const p = this.params;
    this.body.setTranslation({ x: laneCenter(lane), y: RIDE_Y + 0.02, z: -s }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.throttle = 0;
    this.gearbox.reset();
    this.driveMode = 'D';
    for (const w of this.wheels) {
      w.omega = speed / p.wheelRadius;
      w.susp = p.suspensionRest - (p.mass * G) / 4 / p.springK;
      w.sliding = false;
    }
    this.readBack();
    this.snapInterpolation();
  }

  /** Interpolated chassis pose and current wheel poses for rendering. */
  render(alpha: number, flares?: LightFlares): void {
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    if (flares) {
      this.mesh.updateMatrix();
      emitFlares(this.mesh, this.lights, flares);
    }
    this.wheels.forEach((w, i) => {
      const v = this.visuals[i];
      v.steer.position.set(w.x, CONNECTION_Y - w.susp, w.z);
      v.steer.rotation.y = -w.steer;
      v.spin.rotation.x = w.spin;
    });
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
    const halfD = (PLAYER_W / 2) * c + (PLAYER_L / 2) * sn;
    const halfS = (PLAYER_L / 2) * c + (PLAYER_W / 2) * sn;
    return { s: this.s, dMin: this.d - halfD, dMax: this.d + halfD, length: halfS * 2 };
  }
}
