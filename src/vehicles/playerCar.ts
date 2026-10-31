import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { laneCenter } from '../road/coords';
import { PLAYER_GROUPS, PhysicsWorld } from '../physics/physicsWorld';
import { DEFAULT_HANDLING, HandlingInput, HandlingParams, HandlingState, stepHandling } from './handling';
import { buildCar, setBrake, VehicleLights } from './models';

export const PLAYER_W = 1.86;
export const PLAYER_H = 1.1;
export const PLAYER_L = 4.4;
const MASS = 1300;

/** Road-relative yaw from a quaternion that only rotates about Y (yaw = -rotation.y). */
export function yawOf(q: { x: number; y: number; z: number; w: number }): number {
  return -2 * Math.atan2(q.y, q.w);
}

export function quatFromYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(-yaw / 2), z: 0, w: Math.cos(-yaw / 2) };
}

export class PlayerCar {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh: THREE.Group;
  private readonly lights: VehicleLights;
  params: HandlingParams = { ...DEFAULT_HANDLING };
  private steer = 0;
  private yawCmd: number | null = null;
  private yawRateCmd = 0;
  stunTime = 0;

  // Read back from the body after each physics step.
  s = 0;
  d = 0;
  yaw = 0;
  vLong = 0;
  vLat = 0;

  // Interpolation.
  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private currQuat = new THREE.Quaternion();

  constructor(physics: PhysicsWorld, scene: THREE.Scene) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(laneCenter(1), PLAYER_H / 2, 0)
      .enabledRotations(false, true, false)
      .setCcdEnabled(true)
      .setCanSleep(false);
    this.body = physics.world.createRigidBody(desc);
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(PLAYER_W / 2 - 0.05, PLAYER_H / 2 - 0.05, PLAYER_L / 2 - 0.05, 0.05)
        .setMass(MASS)
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(PLAYER_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, { type: 'player' });

    const model = buildCar(PLAYER_W, PLAYER_H, PLAYER_L, 0xd62828, true);
    this.mesh = model.root;
    this.lights = model.lights;
    scene.add(this.mesh);
    this.readBack();
    this.snapInterpolation();
  }

  get speed(): number {
    return this.vLong;
  }

  stun(sec: number): void {
    this.stunTime = Math.max(this.stunTime, sec);
  }

  /** Apply arcade handling for this step (call before world.step). */
  prePhysics(input: HandlingInput, dt: number): void {
    // While in control, heading is owned by the handling model so contact noise
    // cannot make the car wander; during a stun, physics owns it (impacts spin the car).
    if (this.stunTime <= 0 && this.yawCmd !== null) {
      this.body.setRotation(quatFromYaw(this.yawCmd), true);
    }
    this.readBack();
    const st: HandlingState = {
      vLong: this.vLong,
      vLat: this.vLat,
      yaw: this.yaw,
      yawRate: this.stunTime > 0 || this.yawCmd === null ? -this.body.angvel().y : this.yawRateCmd,
      steer: this.steer,
      stun: this.stunTime,
    };
    const r = stepHandling(st, input, this.params, dt);
    this.steer = r.steer;
    this.stunTime = Math.max(0, this.stunTime - dt);
    this.yawCmd = this.yaw + r.yawRate * dt;
    this.yawRateCmd = r.yawRate;

    const fx = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = Math.sin(this.yaw);
    const vy = this.body.linvel().y;
    this.body.setLinvel(
      { x: fx * r.vLong + rx * r.vLat, y: Math.min(vy, 2), z: fz * r.vLong + rz * r.vLat },
      true,
    );
    this.body.setAngvel({ x: 0, y: -r.yawRate, z: 0 }, true);
    setBrake(this.lights, input.brake > 0 && this.vLong > 0.5);

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
    this.yaw = yawOf(this.body.rotation());
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

  /** Place the car in a lane, pointing down the road, at the given speed. */
  resetTo(s: number, lane: number, speed: number): void {
    this.body.setTranslation({ x: laneCenter(lane), y: PLAYER_H / 2 + 0.02, z: -s }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.stunTime = 0;
    this.yawCmd = 0;
    this.yawRateCmd = 0;
    this.readBack();
    this.snapInterpolation();
  }

  /** Interpolated pose for rendering. */
  render(alpha: number): void {
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
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
