import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { VehicleKind } from '../config';
import { NPC_LIVE_GROUPS, PhysicsWorld, WRECK_GROUPS } from '../physics/physicsWorld';
import type { Agent, Obstacle } from '../traffic/trafficAI';
import {
  buildCar,
  buildContainerCab,
  buildContainerTrailer,
  buildTruck,
  CAR_COLORS,
  cloneModel,
  compactModel,
  CONTAINER_COLORS,
  setBrake,
  setIndicators,
  TRUCK_COLORS,
  VehicleLights,
  VehicleModel,
} from './models';
import { quatFromYaw } from './playerCar';

const TMP_Q = new THREE.Quaternion();
const TMP_V = new THREE.Vector3();

// Container geometry (see config: total 16.9 m).
const CAB_L = 6;
const TRAILER_L = 12.5;
const HITCH_FROM_CAB_CENTER = 2.0; // fifth wheel, 1 m in front of the cab's rear
const KINGPIN_FROM_TRAILER_CENTER = TRAILER_L / 2 - 0.6;
const TRAILER_WHEELBASE = 8;
const CONTAINER_H = 4.0;
const HOVER = 0.03;

interface Part {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Group;
  lights: VehicleLights;
  w: number;
  l: number;
  prevPos: THREE.Vector3;
  currPos: THREE.Vector3;
  prevQuat: THREE.Quaternion;
  currQuat: THREE.Quaternion;
}

const templates = new Map<string, VehicleModel>();
function model(key: string, build: () => VehicleModel): VehicleModel {
  let t = templates.get(key);
  if (!t) {
    t = compactModel(build());
    templates.set(key, t);
  }
  return cloneModel(t);
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export class NpcVehicle {
  readonly id: number;
  readonly kind: VehicleKind;
  readonly parts: Part[] = [];
  wrecked = false;
  wreckTime = 0;
  private trailerYaw = 0;
  private joint: RAPIER.ImpulseJoint | null = null;

  constructor(private physics: PhysicsWorld, private scene: THREE.Scene, agent: Agent, rng: () => number) {
    this.id = agent.id;
    this.kind = agent.kind;
    const sp = agent.spec;
    if (agent.kind === 'container') {
      const color = pick(CONTAINER_COLORS, rng);
      const cabColor = pick(TRUCK_COLORS, rng);
      const cab = model(`cab|${cabColor}`, () => buildContainerCab(sp.width, CONTAINER_H, CAB_L, cabColor));
      const trailer = model(`trailer|${color}`, () => buildContainerTrailer(sp.width, CONTAINER_H, TRAILER_L, color));
      this.parts.push(this.makePart(cab, sp.width, CONTAINER_H, CAB_L, sp.mass));
      this.parts.push(this.makePart(trailer, sp.width, CONTAINER_H, TRAILER_L, sp.trailerMass!));
    } else if (agent.kind === 'truck') {
      const color = pick(TRUCK_COLORS, rng);
      const m = model(`truck|${color}`, () => buildTruck(sp.width, sp.height, sp.length, color));
      this.parts.push(this.makePart(m, sp.width, sp.height, sp.length, sp.mass));
    } else {
      const color = pick(CAR_COLORS, rng);
      const m = model(`car|${color}`, () => buildCar(sp.width, sp.height, sp.length, color));
      this.parts.push(this.makePart(m, sp.width, sp.height, sp.length, sp.mass));
    }
    this.placeFromAgent(agent, true);
  }

  private makePart(model: VehicleModel, w: number, h: number, l: number, mass: number): Part {
    const body = this.physics.world.createRigidBody(
      // Live NPCs hover just above the road with no gravity: the AI owns their height,
      // and skipping ground contacts halves the physics cost. Wrecks get gravity back.
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, h / 2 + HOVER, 0).setGravityScale(0).setCanSleep(false),
    );
    // Low center of mass so hits spin vehicles rather than flip them every time.
    const inertia = {
      x: (mass / 12) * (h * h + l * l),
      y: (mass / 12) * (w * w + l * l),
      z: (mass / 12) * (w * w + h * h),
    };
    const collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, l / 2)
        .setMassProperties(mass, { x: 0, y: -h * 0.25, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0.1)
        .setCollisionGroups(NPC_LIVE_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.physics.register(collider, { type: 'npc', id: this.id });
    this.scene.add(model.root);
    return {
      body,
      collider,
      mesh: model.root,
      lights: model.lights,
      w,
      l,
      prevPos: new THREE.Vector3(),
      currPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      currQuat: new THREE.Quaternion(),
    };
  }

  /** World poses (x, z, yaw) for each part as dictated by the agent. */
  private targetPoses(agent: Agent, dt: number): { x: number; z: number; yaw: number }[] {
    if (this.kind !== 'container') {
      return [{ x: agent.d, z: -agent.s, yaw: agent.yaw }];
    }
    const cabS = agent.s + agent.length / 2 - CAB_L / 2;
    const cabYaw = agent.yaw;
    const fx = Math.sin(cabYaw);
    const fz = -Math.cos(cabYaw);
    const cab = { x: agent.d, z: -cabS, yaw: cabYaw };
    if (dt > 0) {
      this.trailerYaw += ((agent.v / TRAILER_WHEELBASE) * Math.sin(cabYaw - this.trailerYaw)) * dt;
    } else {
      this.trailerYaw = cabYaw;
    }
    const hx = cab.x - fx * HITCH_FROM_CAB_CENTER;
    const hz = cab.z - fz * HITCH_FROM_CAB_CENTER;
    const tx = Math.sin(this.trailerYaw);
    const tz = -Math.cos(this.trailerYaw);
    return [cab, { x: hx - tx * KINGPIN_FROM_TRAILER_CENTER, z: hz - tz * KINGPIN_FROM_TRAILER_CENTER, yaw: this.trailerYaw }];
  }

  private placeFromAgent(agent: Agent, snap: boolean): void {
    const poses = this.targetPoses(agent, 0);
    poses.forEach((p, i) => {
      const part = this.parts[i];
      const y = part.body.translation().y;
      part.body.setTranslation({ x: p.x, y, z: p.z }, true);
      part.body.setRotation(quatFromYaw(p.yaw), true);
      part.body.setLinvel({ x: Math.sin(p.yaw) * agent.v, y: 0, z: -Math.cos(p.yaw) * agent.v }, true);
      if (snap) this.capture(true);
    });
  }

  /** Drive the bodies so they land exactly on the agent's pose after this step. */
  syncFromAgent(agent: Agent, dt: number, time: number): void {
    const poses = this.targetPoses(agent, dt);
    poses.forEach((p, i) => {
      const b = this.parts[i].body;
      const t = b.translation();
      b.setLinvel({ x: (p.x - t.x) / dt, y: 0, z: (p.z - t.z) / dt }, true);
      b.setRotation(quatFromYaw(p.yaw), true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
    const ind = agent.lcState !== 'none' && agent.targetLane !== null && agent.targetLane !== agent.lane
      ? (agent.targetLane < agent.lane ? -1 : 1)
      : 0;
    const blink = time % 0.6 < 0.33;
    for (const part of this.parts) {
      setIndicators(part.lights, ind < 0 && blink, ind > 0 && blink);
      setBrake(part.lights, agent.accel < -1.0);
    }
  }

  /** Become a wreck: physics takes over, friction and damping bring it to a stop. */
  wreck(): void {
    if (this.wrecked) return;
    this.wrecked = true;
    this.wreckTime = 0;
    for (const p of this.parts) {
      p.collider.setCollisionGroups(WRECK_GROUPS);
      p.collider.setFriction(0.9);
      p.collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average);
      p.body.setGravityScale(1, true);
      p.body.setLinearDamping(0.5);
      p.body.setAngularDamping(1.2);
      setBrake(p.lights, true);
    }
    if (this.parts.length === 2) {
      const params = RAPIER.JointData.spherical({ x: 0, y: 0, z: HITCH_FROM_CAB_CENTER }, { x: 0, y: 0, z: -KINGPIN_FROM_TRAILER_CENTER });
      this.joint = this.physics.world.createImpulseJoint(params, this.parts[0].body, this.parts[1].body, true);
      this.joint.setContactsEnabled(false);
    }
  }

  /** Hazard lights while wrecked. */
  updateWreck(dt: number, time: number): void {
    this.wreckTime += dt;
    const blink = time % 0.8 < 0.4;
    for (const p of this.parts) setIndicators(p.lights, blink, blink);
  }

  savePrev(): void {
    for (const p of this.parts) {
      p.prevPos.copy(p.currPos);
      p.prevQuat.copy(p.currQuat);
    }
  }

  capture(snap = false): void {
    for (const p of this.parts) {
      const t = p.body.translation();
      const q = p.body.rotation();
      p.currPos.set(t.x, t.y, t.z);
      p.currQuat.set(q.x, q.y, q.z, q.w);
      if (snap) {
        p.prevPos.copy(p.currPos);
        p.prevQuat.copy(p.currQuat);
      }
    }
  }

  render(alpha: number): void {
    for (const p of this.parts) {
      p.mesh.position.lerpVectors(p.prevPos, p.currPos, alpha);
      p.mesh.quaternion.slerpQuaternions(p.prevQuat, p.currQuat, alpha);
    }
  }

  /** Front-most road position (s) of the vehicle. */
  get s(): number {
    return -this.parts[0].body.translation().z;
  }

  /** Road-space boxes the AI must avoid (one per part). */
  obstacles(): Obstacle[] {
    return this.parts.map((p, i) => {
      const t = p.body.translation();
      const q = p.body.rotation();
      TMP_Q.set(q.x, q.y, q.z, q.w);
      TMP_V.set(0, 0, -1).applyQuaternion(TMP_Q);
      const yaw = Math.atan2(TMP_V.x, -TMP_V.z);
      const c = Math.abs(Math.cos(yaw));
      const sn = Math.abs(Math.sin(yaw));
      const halfD = (p.w / 2) * c + (p.l / 2) * sn;
      const halfS = (p.l / 2) * c + (p.w / 2) * sn;
      const v = p.body.linvel();
      return { id: -(this.id * 10 + i), s: -t.z, dMin: t.x - halfD, dMax: t.x + halfD, v: Math.max(0, -v.z), length: halfS * 2 };
    });
  }

  /** Lateral gap between this vehicle's sides and a box at [dMin, dMax]. */
  lateralGap(dMin: number, dMax: number): number {
    let best = Infinity;
    for (const o of this.obstacles()) {
      const gap = Math.max(o.dMin - dMax, dMin - o.dMax);
      best = Math.min(best, gap);
    }
    return best;
  }

  dispose(): void {
    if (this.joint) this.physics.world.removeImpulseJoint(this.joint, true);
    for (const p of this.parts) {
      this.physics.unregister(p.collider);
      this.physics.world.removeRigidBody(p.body);
      this.scene.remove(p.mesh);
    }
  }
}
