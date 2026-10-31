import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { laneCenter } from '../road/coords';
import { G_PLAYER, G_STATIC, groups, PLAYER_GROUPS, PhysicsWorld } from '../physics/physicsWorld';
import { CarParams, DEFAULT_CAR, DriveInput, driveCommand, DriveMode, Gearbox, smoothSteer, steerLimit, steerNeutral } from './handling';
import { buildCar, buildWheel, setBrake, VehicleLights } from './models';
import { solveWheel, TireParams } from './tireModel';

export const PLAYER_W = 1.86;
export const PLAYER_H = 1.1;
export const PLAYER_L = 4.4;

const WHEEL_R = 0.34;
const WHEEL_W = 0.3;
const HALF_TRACK = 0.8;
const CONNECTION_Y = 0; // suspension hard points, chassis space
const RIDE_Y = 0.55; // chassis center height at static ride
const WHEEL_RAY_GROUPS = groups(G_PLAYER, G_STATIC); // wheels only stand on the road
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
const UP = new THREE.Vector3();
const FWD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const HARD = new THREE.Vector3();
const CONTACT = new THREE.Vector3();

/** Heading of an arbitrarily rotated body, measured on the road plane. */
function headingYaw(q: { x: number; y: number; z: number; w: number }): number {
  TMP_V.set(0, 0, -1).applyQuaternion(TMP_Q.set(q.x, q.y, q.z, q.w));
  return Math.atan2(TMP_V.x, -TMP_V.z);
}

interface WheelState {
  x: number;
  z: number;
  front: boolean;
  omega: number;
  spin: number; // accumulated visual rotation
  susp: number; // current suspension length
  steer: number;
  inContact: boolean;
  sliding: boolean;
  slip: number;
  load: number;
  contactX: number;
  contactZ: number;
  dirX: number;
  dirZ: number;
}

/**
 * The player's car: a Rapier chassis on four ray-cast wheels with our own
 * spring/damper suspension, anti-roll bars, rear-wheel drive and a tyre model
 * with a friction limit (wheelspin, lock-up, slides, oversteer).
 */
export class PlayerCar {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh: THREE.Group;
  private readonly lights: VehicleLights;
  private readonly visuals: { steer: THREE.Group; spin: THREE.Group }[] = [];
  readonly wheels: WheelState[] = [];
  params: CarParams = { ...DEFAULT_CAR };
  private steer = 0;
  private throttle = 0;
  readonly gearbox = new Gearbox();
  rpm = 900;
  driveMode: DriveMode = 'D';
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
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

  constructor(private physics: PhysicsWorld, scene: THREE.Scene) {
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

    // Wheels: 0 FL, 1 FR, 2 RL, 3 RR.
    for (const [x, z] of [
      [-HALF_TRACK, -p.wheelbase / 2],
      [HALF_TRACK, -p.wheelbase / 2],
      [-HALF_TRACK, p.wheelbase / 2],
      [HALF_TRACK, p.wheelbase / 2],
    ]) {
      this.wheels.push({
        x, z, front: z < 0, omega: 0, spin: 0, susp: p.suspensionRest - 0.09, steer: 0,
        inContact: true, sliding: false, slip: 0, load: 0, contactX: 0, contactZ: 0, dirX: 0, dirZ: -1,
      });
    }

    const model = buildCar(PLAYER_W, PLAYER_H, PLAYER_L, 0xd62828, true, false);
    this.mesh = model.root;
    this.lights = model.lights;
    for (let i = 0; i < 4; i++) {
      const w = buildWheel(WHEEL_R, WHEEL_W);
      this.mesh.add(w.steer);
      this.visuals.push(w);
    }
    scene.add(this.mesh);
    this.readBack();
    this.snapInterpolation();
  }

  get speed(): number {
    return this.vLong;
  }

  /** Strongest tyre slide this step (m/s of slip), for sound. */
  get maxSlip(): number {
    let m = 0;
    for (const w of this.wheels) if (w.inContact && w.sliding) m = Math.max(m, w.slip);
    return m;
  }

  /** Driver input → wheel torques → tyre forces, plus suspension and aero. Call before world.step. */
  prePhysics(input: DriveInput, dt: number): void {
    const p = this.params;
    this.readBack();

    this.steer = smoothSteer(this.steer, input.steer, p, dt);
    // Steering acts around a neutral that follows the slide (self-aligning), so a
    // sliding car can still be caught with the small high-speed steering range.
    const neutral = steerNeutral(this.vLong, this.vLat, p);
    const steerAngle = Math.max(-p.maxSteer, Math.min(p.maxSteer, neutral + this.steer * steerLimit(this.vLong, p)));
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
    if (cmd.engineForce > 0) cmd.engineForce = this.gearbox.wheelTorque(this.throttle, rearOmega, p) / WHEEL_R;
    const brakeTorqueFront = (input.handbrake ? 1 : cmd.brake) * p.brakeForceMax * p.brakeFrontBias * 0.5 * WHEEL_R;
    const brakeTorqueRear = (input.handbrake ? 1 : cmd.brake) * p.brakeForceMax * (1 - p.brakeFrontBias) * 0.5 * WHEEL_R;
    const driveTorqueRear = cmd.engineForce * 0.5 * WHEEL_R;
    setBrake(this.lights, cmd.brake > 0 && Math.abs(this.vLong) > 0.5);

    const t = this.body.translation();
    const r = this.body.rotation();
    TMP_Q.set(r.x, r.y, r.z, r.w);
    UP.set(0, 1, 0).applyQuaternion(TMP_Q);
    const tire: TireParams = {
      muPeak: p.muPeak,
      muSlide: p.muSlide,
      slipAnglePeak: p.slipAnglePeak,
      rollingResistance: 0.012,
      regripSpeed: 0.6,
      slipFalloff: p.slipFalloff,
    };
    // Limited-slip diff: torque moves from the faster-spinning rear wheel to the slower one,
    // so both rears light up (and hook up) together instead of one-wheel peel.
    const lsd = Math.max(-1500, Math.min(1500, p.lsd * (this.wheels[2].omega - this.wheels[3].omega)));
    const rearTorque = [driveTorqueRear - lsd, driveTorqueRear + lsd];

    // 1) Suspension: ray from each hard point down along the chassis.
    const comp: number[] = [];
    for (const w of this.wheels) {
      HARD.set(w.x, CONNECTION_Y, w.z).applyQuaternion(TMP_Q).add(TMP_V.set(t.x, t.y, t.z));
      this.ray.origin = { x: HARD.x, y: HARD.y, z: HARD.z };
      this.ray.dir = { x: -UP.x, y: -UP.y, z: -UP.z };
      const maxLen = p.suspensionRest + WHEEL_R;
      const hit = this.physics.world.castRay(this.ray, maxLen, true, undefined, WHEEL_RAY_GROUPS, undefined, this.body);
      const prev = w.susp;
      if (hit) {
        w.susp = Math.max(p.suspensionRest - p.suspensionTravel, hit.timeOfImpact - WHEEL_R);
        w.inContact = true;
      } else {
        w.susp = p.suspensionRest;
        w.inContact = false;
      }
      comp.push(w.inContact ? p.suspensionRest - w.susp : 0);
      const compVel = (prev - w.susp) / dt;
      let f = 0;
      if (w.inContact) {
        f = p.springK * (p.suspensionRest - w.susp) + (compVel > 0 ? p.damperBump : p.damperRebound) * compVel;
      }
      w.load = Math.max(0, f);
    }
    // Anti-roll bars move load from the lightly to the heavily compressed side.
    for (const [a, b, k] of [[0, 1, p.antiRollFront], [2, 3, p.antiRollRear]]) {
      const ar = k * (comp[a] - comp[b]);
      if (this.wheels[a].inContact) this.wheels[a].load = Math.max(0, this.wheels[a].load + ar);
      if (this.wheels[b].inContact) this.wheels[b].load = Math.max(0, this.wheels[b].load - ar);
    }

    // 2) Tyres.
    this.wheels.forEach((w, i) => {
      w.steer = w.front ? steerAngle : 0;
      HARD.set(w.x, CONNECTION_Y, w.z).applyQuaternion(TMP_Q).add(TMP_V.set(t.x, t.y, t.z));
      // Suspension force at the hard point.
      if (w.load > 0) {
        this.body.applyImpulseAtPoint({ x: UP.x * w.load * dt, y: UP.y * w.load * dt, z: UP.z * w.load * dt }, HARD, true);
      }
      CONTACT.copy(HARD).addScaledVector(UP, -(w.susp + WHEEL_R));
      // Wheel heading: car forward is -Z; positive steer turns right.
      FWD.set(Math.sin(w.steer), 0, -Math.cos(w.steer)).applyQuaternion(TMP_Q);
      FWD.y = 0;
      FWD.normalize();
      RIGHT.set(-FWD.z, 0, FWD.x);
      const v = this.body.velocityAtPoint(CONTACT);
      const vx = v.x * FWD.x + v.z * FWD.z;
      const vy = v.x * RIGHT.x + v.z * RIGHT.z;
      const res = solveWheel({
        vx,
        vy,
        omega: w.omega,
        Fz: w.inContact ? w.load : 0,
        driveTorque: i >= 2 ? rearTorque[i - 2] : 0,
        brakeTorque: w.front ? brakeTorqueFront : brakeTorqueRear,
        R: WHEEL_R,
        I: p.wheelInertia,
        dt,
        mEff: (p.mass / 4) * 0.9,
        tire,
        muScale: this.surfaceGrip(CONTACT.x) * (w.front ? 1 : p.rearGrip),
      });
      w.omega = res.omega;
      w.spin -= res.omega * dt;
      w.sliding = res.sliding;
      w.slip = res.slip;
      w.contactX = CONTACT.x;
      w.contactZ = CONTACT.z;
      w.dirX = FWD.x;
      w.dirZ = FWD.z;
      if (w.inContact && (res.Fx !== 0 || res.Fy !== 0)) {
        const fx = FWD.x * res.Fx + RIGHT.x * res.Fy;
        const fz = FWD.z * res.Fx + RIGHT.z * res.Fy;
        this.body.applyImpulseAtPoint({ x: fx * dt, y: 0, z: fz * dt }, CONTACT, true);
      }
    });

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
      w.omega = speed / WHEEL_R;
      w.susp = p.suspensionRest - (p.mass * G) / 4 / p.springK;
      w.sliding = false;
    }
    this.readBack();
    this.snapInterpolation();
  }

  /** Interpolated chassis pose and current wheel poses for rendering. */
  render(alpha: number): void {
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    this.wheels.forEach((w, i) => {
      const v = this.visuals[i];
      v.steer.position.set(w.x, CONNECTION_Y - w.susp, w.z);
      v.steer.rotation.y = -w.steer;
      v.spin.rotation.x = w.spin;
    });
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
