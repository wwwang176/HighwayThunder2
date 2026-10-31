import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { laneCenter } from '../road/coords';
import { G_PLAYER, G_STATIC, groups, PLAYER_GROUPS, PhysicsWorld } from '../physics/physicsWorld';
import { CarParams, DEFAULT_CAR, DriveInput, driveCommand, smoothSteer, steerLimit } from './handling';
import { buildCar, buildWheel, setBrake, VehicleLights } from './models';

export const PLAYER_W = 1.86;
export const PLAYER_H = 1.1;
export const PLAYER_L = 4.4;

const WHEEL_R = 0.34;
const WHEEL_W = 0.3;
const HALF_TRACK = 0.8;
const CONNECTION_Y = 0; // suspension hard points, chassis space
// Ride height: hard point - nominal suspension length - wheel radius sits on the ground.
const RIDE_Y = 0.575;
const WHEEL_RAY_GROUPS = groups(G_PLAYER, G_STATIC); // wheels only stand on the road

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

/**
 * The player's car: a Rapier chassis on four ray-cast wheels with real
 * suspension, front-wheel steering and rear-wheel drive.
 */
export class PlayerCar {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly vehicle: RAPIER.DynamicRayCastVehicleController;
  readonly mesh: THREE.Group;
  private readonly lights: VehicleLights;
  private readonly wheels: { steer: THREE.Group; spin: THREE.Group }[] = [];
  params: CarParams = { ...DEFAULT_CAR };
  private steer = 0;

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

  constructor(physics: PhysicsWorld, scene: THREE.Scene) {
    const p = this.params;
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(laneCenter(1), RIDE_Y, 0)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    const inertia = {
      x: (p.mass / 12) * (0.8 * 0.8 + PLAYER_L * PLAYER_L),
      y: (p.mass / 12) * (PLAYER_W * PLAYER_W + PLAYER_L * PLAYER_L),
      z: (p.mass / 12) * (PLAYER_W * PLAYER_W + 0.8 * 0.8),
    };
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(PLAYER_W / 2 - 0.05, 0.3, PLAYER_L / 2 - 0.05, 0.05)
        .setTranslation(0, 0.1, 0)
        .setMassProperties(p.mass, { x: 0, y: -0.15, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.3)
        .setRestitution(0.05)
        .setCollisionGroups(PLAYER_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, { type: 'player' });

    // Wheels: 0 FL, 1 FR, 2 RL, 3 RR. The controller's forward axis is chassis +Z,
    // while the car's nose points to -Z, so engine force and steering are negated.
    this.vehicle = physics.world.createVehicleController(this.body);
    this.vehicle.indexUpAxis = 1;
    this.vehicle.setIndexForwardAxis = 2;
    const zFront = -p.wheelbase / 2;
    const zRear = p.wheelbase / 2;
    for (const [x, z] of [
      [-HALF_TRACK, zFront],
      [HALF_TRACK, zFront],
      [-HALF_TRACK, zRear],
      [HALF_TRACK, zRear],
    ]) {
      this.vehicle.addWheel({ x, y: CONNECTION_Y, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, p.suspensionRest, WHEEL_R);
    }
    this.applyTyreParams();

    const model = buildCar(PLAYER_W, PLAYER_H, PLAYER_L, 0xd62828, true, false);
    this.mesh = model.root;
    this.lights = model.lights;
    for (let i = 0; i < 4; i++) {
      const w = buildWheel(WHEEL_R, WHEEL_W);
      this.mesh.add(w.steer);
      this.wheels.push(w);
    }
    scene.add(this.mesh);
    this.readBack();
    this.snapInterpolation();
  }

  get speed(): number {
    return this.vLong;
  }

  /** Push tuning values to the wheels (cheap; done every step so the panel is live). */
  private applyTyreParams(): void {
    const p = this.params;
    for (let i = 0; i < 4; i++) {
      this.vehicle.setWheelSuspensionRestLength(i, p.suspensionRest);
      this.vehicle.setWheelMaxSuspensionTravel(i, p.suspensionTravel);
      this.vehicle.setWheelSuspensionStiffness(i, p.suspensionStiffness);
      this.vehicle.setWheelSuspensionCompression(i, p.suspensionCompression);
      this.vehicle.setWheelSuspensionRelaxation(i, p.suspensionRelaxation);
      this.vehicle.setWheelMaxSuspensionForce(i, p.maxSuspensionForce);
      this.vehicle.setWheelFrictionSlip(i, p.frictionSlip);
      this.vehicle.setWheelSideFrictionStiffness(i, p.sideFrictionStiffness);
    }
  }

  /** Driver input → wheels, plus aero forces. Call before world.step. */
  prePhysics(input: DriveInput, dt: number): void {
    const p = this.params;
    this.readBack();
    this.applyTyreParams();

    this.steer = smoothSteer(this.steer, input.steer, p, dt);
    const angle = this.steer * steerLimit(this.vLong, p);
    // Positive steer = turn right (+d). Controller steering is about +Y with forward +Z.
    this.vehicle.setWheelSteering(0, -angle);
    this.vehicle.setWheelSteering(1, -angle);

    const cmd = driveCommand(input, this.vLong, p, dt);
    for (let i = 0; i < 4; i++) {
      this.vehicle.setWheelEngineForce(i, i >= 2 ? -cmd.engineForce / 2 : 0);
      this.vehicle.setWheelBrake(i, cmd.brakeImpulse);
    }
    setBrake(this.lights, cmd.brakeImpulse > 0 && this.vLong > 0.5);

    // Aerodynamics: drag against motion, downforce growing with speed.
    const v = this.body.linvel();
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0.1) {
      const drag = p.dragK * sp * dt;
      const down = p.downforceK * sp * sp * dt;
      this.body.applyImpulse({ x: -v.x * drag, y: -down, z: -v.z * drag }, true);
    }

    this.vehicle.updateVehicle(dt, undefined, WHEEL_RAY_GROUPS);

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
  resetTo(s: number, lane: number, speed: number): void {
    this.body.setTranslation({ x: laneCenter(lane), y: RIDE_Y + 0.05, z: -s }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.readBack();
    this.snapInterpolation();
  }

  /** Interpolated chassis pose and current wheel poses for rendering. */
  render(alpha: number): void {
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    const zs = [-this.params.wheelbase / 2, -this.params.wheelbase / 2, this.params.wheelbase / 2, this.params.wheelbase / 2];
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const len = this.vehicle.wheelSuspensionLength(i) ?? this.params.suspensionRest;
      w.steer.position.set(i % 2 === 0 ? -HALF_TRACK : HALF_TRACK, CONNECTION_Y - len, zs[i]);
      w.steer.rotation.y = this.vehicle.wheelSteering(i) ?? 0;
      w.spin.rotation.x = this.vehicle.wheelRotation(i) ?? 0;
    }
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
