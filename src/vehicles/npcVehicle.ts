import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { VehicleKind } from '../config';
import { G_PLAYER, G_STATIC, groups, NPC_LIVE_GROUPS, PhysicsWorld, WRECK_GROUPS } from '../physics/physicsWorld';
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
import { npcDriveForces, stanleySteer, wheelLoads } from './npcDriver';
import { WheelInstances } from './wheelInstances';

// Container geometry (see config: total 16.9 m).
const CAB_L = 6;
const TRAILER_L = 12.5;
const CONTAINER_H = 4.0;
const HITCH_FROM_CAB_CENTER = 2.0; // fifth wheel, between the cab's rear axles
const KINGPIN_FROM_TRAILER_CENTER = TRAILER_L / 2 - 0.6;
const FIFTH_WHEEL_Y = -CONTAINER_H / 2 + 1.25;

const SAG = 0.06; // static suspension compression we design for (m)
const WRECK_BRAKE_DECEL = 6;
const WHEEL_RAY_GROUPS = groups(G_PLAYER, G_STATIC); // NPC wheels only stand on the road
const G = 9.81;

const TMP_Q = new THREE.Quaternion();
const TMP_V = new THREE.Vector3();
const TMP_M = new THREE.Matrix4();
const TMP_M2 = new THREE.Matrix4();
const TMP_E = new THREE.Euler(0, 0, 0, 'YXZ');
const TMP_S = new THREE.Vector3();

function headingYaw(q: { x: number; y: number; z: number; w: number }): number {
  TMP_V.set(0, 0, -1).applyQuaternion(TMP_Q.set(q.x, q.y, q.z, q.w));
  return Math.atan2(TMP_V.x, -TMP_V.z);
}

interface PartSpec {
  w: number;
  h: number;
  l: number;
  mass: number;
  clearance: number;
  axles: number[]; // z of each axle (front = most negative)
  steerAxles: number; // first N axles steer
  driven: boolean[]; // per axle
  wheelR: number;
  wheelW: number;
  halfTrack: number;
  rest: number;
  frictionSlip: number;
  extraLoad?: { load: number; z: number };
  kingpinZ?: number; // trailers: front supported by the fifth wheel
}

interface Wheel {
  slot: number;
  x: number;
  z: number;
  connY: number;
  r: number;
  width: number;
  steer: boolean;
  driven: boolean;
}

interface Part {
  spec: PartSpec;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  vehicle: RAPIER.DynamicRayCastVehicleController;
  wheels: Wheel[];
  mesh: THREE.Group;
  lights: VehicleLights;
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

const TRAILER_MASS = 16000;
const TRAILER_AXLES = [TRAILER_L / 2 - 3.0, TRAILER_L / 2 - 2.0, TRAILER_L / 2 - 1.0];
const KINGPIN_LOAD = (() => {
  const zr = TRAILER_AXLES.reduce((a, b) => a + b, 0) / TRAILER_AXLES.length;
  const zf = -KINGPIN_FROM_TRAILER_CENTER;
  return (TRAILER_MASS * G * zr) / (zr - zf);
})();

function partSpecs(kind: VehicleKind, sp: Agent['spec']): PartSpec[] {
  if (kind === 'car') {
    return [
      {
        w: sp.width, h: sp.height, l: sp.length, mass: sp.mass, clearance: 0.3,
        axles: [-sp.length * 0.32, sp.length * 0.32], steerAxles: 1, driven: [false, true],
        wheelR: 0.33, wheelW: 0.26, halfTrack: sp.width / 2 - 0.1, rest: 0.3, frictionSlip: 2.2,
      },
    ];
  }
  if (kind === 'truck') {
    const l = sp.length;
    return [
      {
        w: sp.width, h: sp.height, l, mass: sp.mass, clearance: 0.8,
        axles: [-l / 2 + 1.3, l / 2 - 2.2, l / 2 - 1.2], steerAxles: 1, driven: [false, true, true],
        wheelR: 0.5, wheelW: 0.35, halfTrack: sp.width / 2 - 0.2, rest: 0.35, frictionSlip: 1.6,
      },
    ];
  }
  return [
    {
      w: sp.width, h: CONTAINER_H, l: CAB_L, mass: sp.mass, clearance: 0.9,
      axles: [-CAB_L / 2 + 1.1, CAB_L / 2 - 1.5, CAB_L / 2 - 0.5], steerAxles: 1, driven: [false, true, true],
      wheelR: 0.52, wheelW: 0.35, halfTrack: sp.width / 2 - 0.2, rest: 0.35, frictionSlip: 1.6,
      extraLoad: { load: KINGPIN_LOAD, z: HITCH_FROM_CAB_CENTER },
    },
    {
      w: sp.width, h: CONTAINER_H, l: TRAILER_L, mass: TRAILER_MASS, clearance: 1.1,
      axles: TRAILER_AXLES, steerAxles: 0, driven: [false, false, false],
      wheelR: 0.5, wheelW: 0.35, halfTrack: sp.width / 2 - 0.2, rest: 0.35, frictionSlip: 1.6,
      kingpinZ: -KINGPIN_FROM_TRAILER_CENTER,
    },
  ];
}

/**
 * A traffic vehicle simulated like the player's car: chassis on ray-cast wheels
 * with suspension, steered and driven by an AI "driver" that follows the traffic
 * planner. Container trucks are a tractor plus a trailer on a fifth-wheel joint.
 */
export class NpcVehicle {
  readonly id: number;
  readonly kind: VehicleKind;
  readonly parts: Part[] = [];
  wrecked = false;
  wreckTime = 0;
  private joint: RAPIER.ImpulseJoint | null = null;
  private readonly totalMass: number;

  constructor(
    private physics: PhysicsWorld,
    private scene: THREE.Scene,
    private wheelPool: WheelInstances,
    agent: Agent,
    rng: () => number,
  ) {
    this.id = agent.id;
    this.kind = agent.kind;
    const sp = agent.spec;
    const specs = partSpecs(agent.kind, sp);
    let models: VehicleModel[];
    if (agent.kind === 'container') {
      const color = pick(CONTAINER_COLORS, rng);
      const cabColor = pick(TRUCK_COLORS, rng);
      models = [
        model(`cab|${cabColor}`, () => buildContainerCab(sp.width, CONTAINER_H, CAB_L, cabColor, false)),
        model(`trailer|${color}`, () => buildContainerTrailer(sp.width, CONTAINER_H, TRAILER_L, color, false)),
      ];
    } else if (agent.kind === 'truck') {
      const color = pick(TRUCK_COLORS, rng);
      models = [model(`truck|${color}`, () => buildTruck(sp.width, sp.height, sp.length, color, false))];
    } else {
      const color = pick(CAR_COLORS, rng);
      models = [model(`car|${color}`, () => buildCar(sp.width, sp.height, sp.length, color, false, false))];
    }
    specs.forEach((s, i) => this.parts.push(this.makePart(s, models[i])));
    this.totalMass = specs.reduce((m, s) => m + s.mass, 0);
    this.place(agent);
    if (this.parts.length === 2) {
      const params = RAPIER.JointData.spherical(
        { x: 0, y: FIFTH_WHEEL_Y, z: HITCH_FROM_CAB_CENTER },
        { x: 0, y: FIFTH_WHEEL_Y, z: -KINGPIN_FROM_TRAILER_CENTER },
      );
      this.joint = this.physics.world.createImpulseJoint(params, this.parts[0].body, this.parts[1].body, true);
      this.joint.setContactsEnabled(false);
    }
  }

  private makePart(s: PartSpec, m: VehicleModel): Part {
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false));
    const ch = s.h - s.clearance;
    const inertia = {
      x: (s.mass / 12) * (ch * ch + s.l * s.l),
      y: (s.mass / 12) * (s.w * s.w + s.l * s.l),
      z: (s.mass / 12) * (s.w * s.w + ch * ch),
    };
    const collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(s.w / 2, ch / 2, s.l / 2)
        .setTranslation(0, s.clearance / 2, 0)
        .setMassProperties(s.mass, { x: 0, y: -s.h / 2 + s.h * 0.35, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.6)
        .setRestitution(0.1)
        .setCollisionGroups(NPC_LIVE_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.physics.register(collider, { type: 'npc', id: this.id });

    const vehicle = this.physics.world.createVehicleController(body);
    vehicle.indexUpAxis = 1;
    vehicle.setIndexForwardAxis = 2;
    const loads = wheelLoads(s.mass, s.axles, s.extraLoad, s.kingpinZ);
    const wheels: Wheel[] = [];
    s.axles.forEach((z, ai) => {
      const stiffness = loads[ai] / (SAG * s.mass);
      const connY = -s.h / 2 + s.wheelR + (s.rest - SAG);
      for (const side of [-1, 1]) {
        const idx = wheels.length;
        vehicle.addWheel({ x: side * s.halfTrack, y: connY, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, s.rest, s.wheelR);
        vehicle.setWheelSuspensionStiffness(idx, stiffness);
        vehicle.setWheelSuspensionCompression(idx, 0.5 * Math.sqrt(stiffness));
        vehicle.setWheelSuspensionRelaxation(idx, 0.6 * Math.sqrt(stiffness));
        vehicle.setWheelMaxSuspensionTravel(idx, 0.2);
        vehicle.setWheelMaxSuspensionForce(idx, loads[ai] * 4);
        vehicle.setWheelFrictionSlip(idx, s.frictionSlip);
        vehicle.setWheelSideFrictionStiffness(idx, 1);
        wheels.push({
          slot: this.wheelPool.alloc(),
          x: side * s.halfTrack,
          z,
          connY,
          r: s.wheelR,
          width: s.wheelW,
          steer: ai < s.steerAxles,
          driven: s.driven[ai],
        });
      }
    });

    this.scene.add(m.root);
    return {
      spec: s,
      body,
      collider,
      vehicle,
      wheels,
      mesh: m.root,
      lights: m.lights,
      prevPos: new THREE.Vector3(),
      currPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      currQuat: new THREE.Quaternion(),
    };
  }

  /** Initial pose and speed from the agent (container: trailer lined up behind the cab). */
  private place(agent: Agent): void {
    const front = agent.s + agent.length / 2;
    const cabS = front - this.parts[0].spec.l / 2;
    const ss = [cabS];
    if (this.parts.length === 2) ss.push(cabS - HITCH_FROM_CAB_CENTER - KINGPIN_FROM_TRAILER_CENTER);
    this.parts.forEach((p, i) => {
      p.body.setTranslation({ x: agent.d, y: p.spec.h / 2, z: -ss[i] }, true);
      p.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      p.body.setLinvel({ x: 0, y: 0, z: -agent.v }, true);
    });
    this.capture(true);
  }

  /** Physics → agent: the planner reasons about where the vehicle really is. */
  syncAgent(agent: Agent): void {
    const cab = this.parts[0];
    const t = cab.body.translation();
    const v = cab.body.linvel();
    const yaw = headingYaw(cab.body.rotation());
    agent.yaw = yaw;
    agent.d = t.x;
    agent.s = -t.z + cab.spec.l / 2 - agent.length / 2;
    agent.v = Math.max(0, v.x * Math.sin(yaw) - v.z * Math.cos(yaw));
  }

  /** Agent → pedals and steering (call before world.step). */
  drive(agent: Agent, dt: number, time: number): void {
    const cab = this.parts[0];
    const steer = stanleySteer(
      { d: agent.d, yaw: agent.yaw, v: agent.v, yawRate: -cab.body.angvel().y },
      agent.dPlan,
      agent.dPlanRate,
      cab.spec.axles[cab.spec.axles.length - 1] - cab.spec.axles[0],
    );
    const f = npcDriveForces(agent.accel, agent.v, this.totalMass, dt);
    // Brakes on every axle in proportion to each part's mass.
    const decel = f.brakeImpulse > 0 ? (f.brakeImpulse * 4) / (this.totalMass * dt) : 0;
    for (const p of this.parts) {
      const nDriven = p.wheels.filter((w) => w.driven).length;
      p.wheels.forEach((w, i) => {
        p.vehicle.setWheelSteering(i, w.steer ? -steer : 0);
        p.vehicle.setWheelEngineForce(i, w.driven ? -f.engineForce / nDriven : 0);
        p.vehicle.setWheelBrake(i, (decel * p.spec.mass * dt) / p.wheels.length);
      });
      p.vehicle.updateVehicle(dt, undefined, WHEEL_RAY_GROUPS);
    }

    const ind =
      agent.lcState !== 'none' && agent.targetLane !== null && agent.targetLane !== agent.lane
        ? agent.targetLane < agent.lane
          ? -1
          : 1
        : 0;
    const blink = time % 0.6 < 0.33;
    for (const part of this.parts) {
      setIndicators(part.lights, ind < 0 && blink, ind > 0 && blink);
      setBrake(part.lights, agent.accel < -1.0);
    }
  }

  /** Become a wreck: no more AI; the driver stands on the brakes. */
  wreck(): void {
    if (this.wrecked) return;
    this.wrecked = true;
    this.wreckTime = 0;
    for (const p of this.parts) {
      p.collider.setCollisionGroups(WRECK_GROUPS);
      p.body.setLinearDamping(0.2);
      p.body.setAngularDamping(0.5);
      setBrake(p.lights, true);
    }
  }

  /** Wrecks keep their (braked) wheels and flash hazard lights. */
  updateWreck(dt: number, time: number): void {
    this.wreckTime += dt;
    for (const p of this.parts) {
      p.wheels.forEach((_, i) => {
        p.vehicle.setWheelSteering(i, 0);
        p.vehicle.setWheelEngineForce(i, 0);
        p.vehicle.setWheelBrake(i, (WRECK_BRAKE_DECEL * p.spec.mass * dt) / p.wheels.length);
      });
      p.vehicle.updateVehicle(dt, undefined, WHEEL_RAY_GROUPS);
    }
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

  /** Interpolated body pose; wheels placed from the live suspension state. */
  render(alpha: number): void {
    for (const p of this.parts) {
      p.mesh.position.lerpVectors(p.prevPos, p.currPos, alpha);
      p.mesh.quaternion.slerpQuaternions(p.prevQuat, p.currQuat, alpha);
      p.mesh.updateMatrix();
      p.wheels.forEach((w, i) => {
        const len = p.vehicle.wheelSuspensionLength(i) ?? p.spec.rest;
        TMP_E.set(p.vehicle.wheelRotation(i) ?? 0, p.vehicle.wheelSteering(i) ?? 0, 0, 'YXZ');
        TMP_M2.compose(TMP_V.set(w.x, w.connY - len, w.z), TMP_Q.setFromEuler(TMP_E), TMP_S.set(w.width, w.r, w.r));
        TMP_M.multiplyMatrices(p.mesh.matrix, TMP_M2);
        this.wheelPool.set(w.slot, TMP_M);
      });
    }
  }

  /** Road position (s) of the first part's center. */
  get s(): number {
    return -this.parts[0].body.translation().z;
  }

  /** Road-space boxes the AI must avoid (one per part). */
  obstacles(): Obstacle[] {
    return this.parts.map((p, i) => {
      const t = p.body.translation();
      const yaw = headingYaw(p.body.rotation());
      const c = Math.abs(Math.cos(yaw));
      const sn = Math.abs(Math.sin(yaw));
      const halfD = (p.spec.w / 2) * c + (p.spec.l / 2) * sn;
      const halfS = (p.spec.l / 2) * c + (p.spec.w / 2) * sn;
      const v = p.body.linvel();
      return { id: -(this.id * 10 + i), s: -t.z, dMin: t.x - halfD, dMax: t.x + halfD, v: Math.max(0, -v.z), length: halfS * 2 };
    });
  }

  dispose(): void {
    if (this.joint) this.physics.world.removeImpulseJoint(this.joint, true);
    for (const p of this.parts) {
      for (const w of p.wheels) this.wheelPool.release(w.slot);
      this.physics.world.removeVehicleController(p.vehicle);
      this.physics.unregister(p.collider);
      this.physics.world.removeRigidBody(p.body);
      this.scene.remove(p.mesh);
    }
  }
}
