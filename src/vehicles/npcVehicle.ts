import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GRASS_GRIP, MEDIAN_FAR_X, MEDIAN_NEAR_X, VEHICLE_SPECS, VehicleKind, type VehicleSpec } from '../config';
import { G_PLAYER, G_STATIC, groups, NPC_LIVE_GROUPS, PhysicsWorld, WRECK_GROUPS } from '../physics/physicsWorld';
import type { Agent, Obstacle } from '../traffic/trafficAI';
import {
  buildCar,
  buildContainerCab,
  buildContainerTrailer,
  buildTrafficBody,
  buildTruck,
  CAR_COLORS,
  CAR_LIVERIES,
  cloneModel,
  compactModel,
  CONTAINER_COLORS,
  setBrake,
  setIndicators,
  TRUCK_COLORS,
  TRUCK_LIVERIES,
  unitWheelGeometry,
  VehicleLights,
  VehicleModel,
} from './models';
import { npcDriveForces, stanleySteer, wheelLoads } from './npcDriver';
import { boxToFrame, RoadFrame } from '../road/frame';
import type { LightFlares } from '../render/lightFlares';
import type { BodyInstances } from '../render/bodyInstances';
import { BRAKE_ON, FlareSpot } from './models';
import { ChassisWheel, makeWheel, TyreChassis } from './tyreChassis';
import { SEDAN_COLLIDER } from './sedanCollider';
import type { TireParams } from './tireModel';

// Container geometry (see config: total 16.94 m).
const CAB_L = 6.29; // its model's (public/models/cab.glb)
const TRAILER_L = 12.5;
const CONTAINER_H = 4.0;
const HITCH_FROM_CAB_CENTER = 1.89; // fifth wheel (its model's plate), between the cab's rear axles
const KINGPIN_FROM_TRAILER_CENTER = TRAILER_L / 2 - 0.6;
const FIFTH_WHEEL_Y = -CONTAINER_H / 2 + 1.25;
// Trailer-local z where the wheels / side underride guard begin: like real trailers,
// ~3 m behind the kingpin (behind the landing gear), leaving room for the tractor to articulate.
const TRAILER_TAIL_START = -KINGPIN_FROM_TRAILER_CENTER + 3.0;

// The traffic's models (public/models/sedan.glb, truck.glb), measured off the files: where the file's origin
// (midway between its axles) sits along the physics box (centred on the body, nose to tail), its axles
// either side of it, the wheels' x, radius and width (tyres 185/60 R15, 275/80 R22.5).
const SEDAN = { z: -0.078, axle: 1.224, x: 0.74, r: 0.301, width: 0.18 };
// Engine up front: 68 % of the weight on the front tyres - its centre of mass past the roof's front edge, so rolled
// onto its back it tips onto its hood (at 60 % it lay on its roof).
const SEDAN_FRONT_SHARE = 0.68;
const BOX_TRUCK = { z: -0.108, axle: 2.158, x: 1.109, r: 0.506, width: 0.26 };
// The container truck's cab (cab.glb, tyres 295/80 R22.5): its origin midway between its front and last axles,
// its axles from the box's centre (front, then the two at the back, on twin tyres), its cabin's back wall.
// (Twins shown a little narrower than they are, 8 cm apart, the gap between them clear.)
const CAB = { z: 0.271, axles: [-1.76, 1.246, 2.302], x: 1.051, r: 0.522, width: 0.27, twin: { from: 1, x: 0.93, gap: 0.35 }, cabinBack: -0.36 };
// Its trailer (trailer.glb: its origin its middle; twin tyres 295/80 R22.5), its container's top.
const TRAILER = { x: 0.92, r: 0.522, width: 0.27, twin: { from: 0, x: 0.922, gap: 0.35 }, top: 3.92 };

const SAG = 0.06; // static suspension compression we design for (m)

// Once wrecked, vehicles run on the same tyre/wheel model as the player's car.
const WRECK_TIRE: TireParams = {
  muPeak: 1.1,
  muSlide: 0.8,
  slipAnglePeak: 0.105,
  rollingResistance: 0.015,
  regripSpeed: 0.6,
  slipFalloff: 18,
};
// Heavy-truck tyres: harder compound, much less grip than a car's.
const TRUCK_WRECK_TIRE: TireParams = {
  muPeak: 0.8,
  muSlide: 0.6,
  slipAnglePeak: 0.105,
  rollingResistance: 0.008,
  regripSpeed: 0.6,
  slipFalloff: 18,
};
// Peak "trip" friction when dragged fully sideways (see SideTrip); tunable live in the panel.
export const WRECK_TRIP = { car: 3.5, truck: 2.6 };
const wreckSurfaceGrip = (x: number) => (x < MEDIAN_NEAR_X && x > MEDIAN_FAR_X ? GRASS_GRIP : 1);
const WHEEL_RAY_GROUPS = groups(G_PLAYER, G_STATIC); // NPC wheels only stand on the road
const G = 9.81;

const TMP_Q = new THREE.Quaternion();
const TMP_V = new THREE.Vector3();
const TMP_M = new THREE.Matrix4();
const TMP_M2 = new THREE.Matrix4();
const TMP_E = new THREE.Euler(0, 0, 0, 'YXZ');
const TMP_S = new THREE.Vector3();

/** Every traffic wheel: one vertex-coloured unit wheel (scaled to each), drawn instanced (render/bodyInstances). */
const NPC_WHEEL = 'npc-wheel';
let wheelModel: THREE.Mesh | null = null;
function npcWheel(): THREE.Mesh {
  if (!wheelModel) {
    wheelModel = new THREE.Mesh(unitWheelGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    wheelModel.castShadow = true;
  }
  return wheelModel;
}
const NO_LAMPS: VehicleLights = { left: [], right: [], brake: [], third: [] };

/** World-space forward (nose) direction of a body on the ground plane. */
function forwardOf(q: { x: number; y: number; z: number; w: number }): { x: number; z: number } {
  TMP_V.set(0, 0, -1).applyQuaternion(TMP_Q.set(q.x, q.y, q.z, q.w));
  const n = Math.hypot(TMP_V.x, TMP_V.z) || 1;
  return { x: TMP_V.x / n, z: TMP_V.z / n };
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
  /** Twin tyres (each wheelW wide) on the axles from `from` on: their middle's x, the gap between theirs. */
  twin?: { from: number; x: number; gap: number };
  rest: number;
  frictionSlip: number;
  extraLoad?: { load: number; z: number };
  kingpinZ?: number; // trailers: front supported by the fifth wheel
  comZ?: number; // centre of mass along the body (local z, front negative); default its box's middle
  /** Explicit collision boxes (heights above ground, local z); the first one carries the mass. */
  boxes?: { y0: number; y1: number; z0: number; z1: number }[];
  /** Instead of boxes, convex pieces (points x, y, z in the body's space, its middle; the model's shape); the first carries the mass. */
  hull?: number[][];
}

interface Wheel {
  shownX: number;
  /** Twin tyres: shown either side of `shownX`, `gap` apart (0: one tyre). */
  gap: number;
  staticLoad: number; // N, design load (sets spring rates)
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
  colliders: RAPIER.Collider[]; // body box (+ lower box over wheels/chassis on tall vehicles)
  vehicle: RAPIER.DynamicRayCastVehicleController | null; // live: Rapier's controller
  chassis: TyreChassis | null; // wrecked: the full tyre model
  wheels: Wheel[];
  nDriven: number;
  /** Where it is drawn (its matrix; never in the scene: drawn instanced, render/bodyInstances), its lamps' state. */
  mesh: THREE.Group;
  lights: VehicleLights;
  /** Its model: the template every vehicle of it is drawn from, and its key. */
  model: TrafficModelRef;
  prevPos: THREE.Vector3;
  currPos: THREE.Vector3;
  prevQuat: THREE.Quaternion;
  currQuat: THREE.Quaternion;
  /** Its wheels' turn as it fell asleep (NpcVehicle.sleep): drawn rolling on from there. */
  sleepSpin: number[];
}

export interface TrafficModelRef {
  key: string;
  template: THREE.Object3D;
}

const templates = new Map<string, VehicleModel>();
/** A vehicle of model `key`: its own lamps (their state) and pose holder, and the model it is drawn from. */
function model(key: string, build: () => VehicleModel): VehicleModel & { ref: TrafficModelRef } {
  let t = templates.get(key);
  if (!t) {
    t = compactModel(build());
    templates.set(key, t);
  }
  return { ...cloneModel(t), ref: { key, template: t.root } };
}

const FLARE_V = new THREE.Vector3();
const AHEAD = new THREE.Vector3();
const BEHIND = new THREE.Vector3();

/** Head/tail light glows for one vehicle body, aimed as its lamps (the indicators glow by the bloom alone: models.ts). */
export function emitFlares(mesh: THREE.Object3D, lights: VehicleLights, flares: LightFlares): void {
  const spots = mesh.userData.flares as FlareSpot[] | undefined;
  if (spots) {
    const braking = lights.brake.length > 0 && lights.brake[0].material === BRAKE_ON;
    AHEAD.set(0, 0, -1).transformDirection(mesh.matrix); // (the nose is -z)
    BEHIND.copy(AHEAD).negate();
    for (const f of spots) {
      FLARE_V.set(f.x, f.y, f.z).applyMatrix4(mesh.matrix);
      if (f.kind === 'head') flares.add(FLARE_V.x, FLARE_V.y, FLARE_V.z, 1.0, 0.95, 0.85, 0.55, AHEAD);
      else if (braking) flares.add(FLARE_V.x, FLARE_V.y, FLARE_V.z, 1.0, 0.07, 0.05, 0.5, BEHIND);
      else flares.add(FLARE_V.x, FLARE_V.y, FLARE_V.z, 0.55, 0.02, 0.02, 0.32, BEHIND);
    }
  }
}

/** A vehicle's models, one per part: paint job `i` (a container: its cab's; `color`, its trailer's). */
function vehicleModels(kind: VehicleKind, sp: VehicleSpec, i: number, color = 0): ReturnType<typeof model>[] {
  if (kind === 'container') {
    return [
      model(`cab|${i}`, () =>
        buildTrafficBody('cab', CONTAINER_H, CAB_L, CAB.z, TRUCK_LIVERIES[i]) ??
        buildContainerCab(sp.width, CONTAINER_H, CAB_L, TRUCK_COLORS[i], false),
      ),
      model(`trailer|${color}`, () =>
        buildTrafficBody('trailer', CONTAINER_H, TRAILER_L, 0, undefined, color) ??
        buildContainerTrailer(sp.width, CONTAINER_H, TRAILER_L, color, false),
      ),
    ];
  }
  if (kind === 'truck') {
    return [
      model(`truck|${i}`, () =>
        buildTrafficBody('truck', sp.height, sp.length, BOX_TRUCK.z, TRUCK_LIVERIES[i]) ??
        buildTruck(sp.width, sp.height, sp.length, TRUCK_COLORS[i], false),
      ),
    ];
  }
  return [
    model(`car|${i}`, () =>
      buildTrafficBody('sedan', sp.height, sp.length, SEDAN.z, CAR_LIVERIES[i]) ??
      buildCar(sp.width, sp.height, sp.length, CAR_COLORS[i], false, false),
    ),
  ];
}

/**
 * Every traffic model there is (each paint job's every part), and the traffic's wheel: to draw them all once
 * before the race (their shaders compiled, their textures sent), not as each first comes along.
 */
export function allTrafficModels(): TrafficModelRef[] {
  const all = new Map<string, TrafficModelRef>();
  const put = (ms: ReturnType<typeof model>[]) => ms.forEach((m) => all.set(m.ref.key, m.ref));
  CAR_COLORS.forEach((_, i) => put(vehicleModels('car', VEHICLE_SPECS.car, i)));
  TRUCK_COLORS.forEach((_, i) => put(vehicleModels('truck', VEHICLE_SPECS.truck, i)));
  TRUCK_COLORS.forEach((_, i) => CONTAINER_COLORS.forEach((c) => put(vehicleModels('container', VEHICLE_SPECS.container, i, c))));
  all.set(NPC_WHEEL, { key: NPC_WHEEL, template: npcWheel() });
  return [...all.values()];
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[pickIndex(arr.length, rng)];
}

function pickIndex(n: number, rng: () => number): number {
  return Math.floor(rng() * n) % n;
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
    const m = SEDAN;
    return [
      {
        w: sp.width, h: sp.height, l: sp.length, mass: sp.mass, clearance: 0.3,
        axles: [m.z - m.axle, m.z + m.axle], steerAxles: 1, driven: [false, true],
        wheelR: m.r, wheelW: m.width, halfTrack: m.x, rest: 0.3, frictionSlip: 2.2,
        comZ: m.z - (SEDAN_FRONT_SHARE - 0.5) * 2 * m.axle,
        hull: SEDAN_COLLIDER,
      },
    ];
  }
  if (kind === 'truck') {
    // Body from its box's floor (0.51 m) up; the lower box (0.3 m up) keeps cars from going under it.
    const m = BOX_TRUCK;
    return [
      {
        w: sp.width, h: sp.height, l: sp.length, mass: sp.mass, clearance: 0.5,
        axles: [m.z - m.axle, m.z + m.axle], steerAxles: 1, driven: [false, true],
        wheelR: m.r, wheelW: m.width, halfTrack: m.x, rest: 0.35, frictionSlip: 1.6,
      },
    ];
  }
  return [
    {
      w: sp.width, h: CONTAINER_H, l: CAB_L, mass: sp.mass, clearance: 0.9,
      axles: CAB.axles, steerAxles: 1, driven: [false, true, true],
      wheelR: CAB.r, wheelW: CAB.width, halfTrack: CAB.x, twin: CAB.twin, rest: 0.35, frictionSlip: 1.6,
      extraLoad: { load: KINGPIN_LOAD, z: HITCH_FROM_CAB_CENTER },
      // Full-height cabin up front (its model's, 3.7 m tall); behind it only a low chassis under the fifth
      // wheel, so the trailer can sit over it without touching - and hit the cabin when it jackknifes.
      boxes: [
        { y0: 0.9, y1: 3.7, z0: -CAB_L / 2, z1: CAB.cabinBack },
        { y0: 0.3, y1: 1.2, z0: -CAB_L / 2, z1: CAB_L / 2 },
      ],
    },
    {
      w: sp.width, h: CONTAINER_H, l: TRAILER_L, mass: TRAILER_MASS, clearance: 1.1,
      axles: TRAILER_AXLES, steerAxles: 0, driven: [false, false, false],
      wheelR: TRAILER.r, wheelW: TRAILER.width, halfTrack: TRAILER.x, twin: TRAILER.twin, rest: 0.35, frictionSlip: 1.6,
      kingpinZ: -KINGPIN_FROM_TRAILER_CENTER,
      // Box body above the fifth wheel; wheels / underride guard only behind the tractor.
      boxes: [
        { y0: 1.3, y1: TRAILER.top, z0: -TRAILER_L / 2, z1: TRAILER_L / 2 },
        { y0: 0.3, y1: 1.1, z0: TRAILER_TAIL_START, z1: TRAILER_L / 2 },
      ],
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
    readonly frame: RoadFrame,
    agent: Agent,
    rng: () => number,
  ) {
    this.id = agent.id;
    this.kind = agent.kind;
    const sp = agent.spec;
    const specs = partSpecs(agent.kind, sp);
    let models: ReturnType<typeof model>[];
    if (agent.kind === 'container') {
      const color = pick(CONTAINER_COLORS, rng);
      models = vehicleModels('container', sp, pickIndex(TRUCK_COLORS.length, rng), color);
    } else models = vehicleModels(agent.kind, sp, pickIndex((agent.kind === 'truck' ? TRUCK_COLORS : CAR_COLORS).length, rng));
    specs.forEach((s, i) => this.parts.push(this.makePart(s, models[i])));
    this.totalMass = specs.reduce((m, s) => m + s.mass, 0);
    this.place(agent);
    if (this.parts.length === 2) {
      const params = RAPIER.JointData.spherical(
        { x: 0, y: FIFTH_WHEEL_Y, z: HITCH_FROM_CAB_CENTER },
        { x: 0, y: FIFTH_WHEEL_Y, z: -KINGPIN_FROM_TRAILER_CENTER },
      );
      this.joint = this.physics.world.createImpulseJoint(params, this.parts[0].body, this.parts[1].body, true);
      // Tractor and trailer collide with each other (their boxes don't overlap when lined up),
      // so a jackknifing trailer slams into the cab instead of swinging through it.
      this.joint.setContactsEnabled(true);
    }
  }

  private makePart(s: PartSpec, m: ReturnType<typeof model>): Part {
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false));
    const ch = s.h - s.clearance;
    const inertia = {
      x: (s.mass / 12) * (ch * ch + s.l * s.l),
      y: (s.mass / 12) * (s.w * s.w + s.l * s.l),
      z: (s.mass / 12) * (s.w * s.w + ch * ch),
    };
    // Collision boxes (heights above ground, local z). Default: the body box, plus on
    // tall vehicles a lower box over wheels and chassis (like underride guards) so a
    // car cannot drive under them; it stays clear of the road surface.
    const boxes = s.boxes ?? [
      { y0: s.clearance, y1: s.h, z0: -s.l / 2, z1: s.l / 2 },
      ...(s.clearance > 0.45 ? [{ y0: 0.3, y1: s.clearance, z0: -s.l / 2, z1: s.l / 2 }] : []),
    ];
    const comY = -s.h / 2 + s.h * 0.35; // body-local centre of mass height
    const collide = (desc: RAPIER.ColliderDesc) => desc.setFriction(0.6).setRestitution(0.1)
      .setCollisionGroups(NPC_LIVE_GROUPS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    // Convex pieces (in the body's own frame: their centre of mass given as it is), the first carrying the mass.
    const hulls = s.hull?.map((pts, i) => {
      const desc = collide(RAPIER.ColliderDesc.convexHull(new Float32Array(pts))!);
      return i === 0 ? desc.setMassProperties(s.mass, { x: 0, y: comY, z: s.comZ ?? 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 }) : desc.setDensity(0);
    });
    const colliders: RAPIER.Collider[] = hulls ? hulls.map((desc) => {
      const c = this.physics.world.createCollider(desc, body);
      this.physics.register(c, { type: 'npc', id: this.id });
      return c;
    }) : boxes.map((b, i) => {
      const cy = -s.h / 2 + (b.y0 + b.y1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const halfW = i === 0 ? s.w / 2 : s.w / 2 - 0.05;
      let desc = RAPIER.ColliderDesc.cuboid(halfW, (b.y1 - b.y0) / 2, (b.z1 - b.z0) / 2)
        .setTranslation(0, cy, cz)
        .setFriction(0.6)
        .setRestitution(0.1)
        .setCollisionGroups(NPC_LIVE_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      // The first box carries all the mass; Rapier wants its centre of mass in the
      // collider's own frame, so convert from body space.
      desc = i === 0
        ? desc.setMassProperties(s.mass, { x: 0, y: comY - cy, z: (s.comZ ?? 0) - cz }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        : desc.setDensity(0);
      const c = this.physics.world.createCollider(desc, body);
      this.physics.register(c, { type: 'npc', id: this.id });
      return c;
    });

    const vehicle = this.physics.world.createVehicleController(body);
    vehicle.indexUpAxis = 1;
    vehicle.setIndexForwardAxis = 2;
    const loads = wheelLoads(s.mass, s.axles, s.extraLoad, s.kingpinZ, s.comZ);
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
        const twin = s.twin && ai >= s.twin.from ? s.twin : null;
        wheels.push({
          shownX: side * (twin ? twin.x : s.halfTrack),
          gap: twin ? twin.gap : 0,
          staticLoad: loads[ai],
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

    return {
      spec: s,
      body,
      colliders,
      vehicle,
      chassis: null,
      wheels,
      nDriven: wheels.filter((w) => w.driven).length,
      mesh: m.root,
      lights: m.lights,
      model: m.ref,
      prevPos: new THREE.Vector3(),
      currPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      currQuat: new THREE.Quaternion(),
      sleepSpin: [],
    };
  }

  /** Initial pose and speed from the agent (container: trailer lined up behind the cab). */
  private place(agent: Agent): void {
    const front = agent.s + agent.length / 2;
    const cabS = front - this.parts[0].spec.l / 2;
    const ss = [cabS];
    if (this.parts.length === 2) ss.push(cabS - HITCH_FROM_CAB_CENTER - KINGPIN_FROM_TRAILER_CENTER);
    const ry = this.frame.rotationY(0);
    const fwd = this.frame.forwardWorld(0);
    this.parts.forEach((p, i) => {
      const w = this.frame.toWorld(ss[i], agent.d);
      p.body.setTranslation({ x: w.x, y: p.spec.h / 2, z: w.z }, true);
      p.body.setRotation({ x: 0, y: Math.sin(ry / 2), z: 0, w: Math.cos(ry / 2) }, true);
      p.body.setLinvel({ x: fwd.x * agent.v, y: 0, z: fwd.z * agent.v }, true);
    });
    this.capture(true);
  }

  /** Physics → agent: the planner reasons about where the vehicle really is. */
  syncAgent(agent: Agent): void {
    const cab = this.parts[0];
    const t = cab.body.translation();
    const v = cab.body.linvel();
    const f = forwardOf(cab.body.rotation());
    const c = this.frame.fromWorld(t.x, t.z);
    agent.yaw = this.frame.yawFromWorldForward(f.x, f.z);
    agent.d = c.d;
    agent.s = c.s + cab.spec.l / 2 - agent.length / 2;
    agent.v = Math.max(0, v.x * f.x + v.z * f.z);
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
      const vc = p.vehicle!;
      p.wheels.forEach((w, i) => {
        vc.setWheelSteering(i, w.steer ? -steer : 0);
        vc.setWheelEngineForce(i, w.driven ? -f.engineForce / p.nDriven : 0);
        vc.setWheelBrake(i, (decel * p.spec.mass * dt) / p.wheels.length);
      });
      vc.updateVehicle(dt, undefined, WHEEL_RAY_GROUPS);
    }
    this.lamps(agent, time);
  }

  /**
   * Far from every racer (nobody near to touch it, nor to see it closely): its bodies kinematic, moved where its
   * planner moves it (`follow`, the agent moving itself: Agent.free) - no wheels' rays, no forces, no solving; its
   * colliders off (nothing there to touch: kept out of the broad phase).
   */
  asleep = false;
  /** Asleep: how far it has gone since it fell asleep (m) - its wheels drawn rolling on by it, from where they stood. */
  private rolled = 0;

  /** To sleep (see `asleep`): its planner moving it from here. */
  sleep(agent: Agent): void {
    if (this.asleep || this.wrecked) return;
    this.asleep = true;
    agent.free = true;
    this.rolled = 0;
    for (const p of this.parts) {
      p.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      for (const c of p.colliders) c.setEnabled(false);
      p.sleepSpin = p.wheels.map((_, i) => p.vehicle?.wheelRotation(i) ?? 0);
    }
  }

  /** Awake again (a racer near, or it hit): its bodies dynamic, driving on at its planner's speed. */
  wake(agent: Agent | undefined): void {
    if (!this.asleep) return;
    this.asleep = false;
    if (agent) agent.free = false;
    const v = agent?.v ?? 0;
    const f = this.frame.forwardWorld(agent?.yaw ?? 0);
    for (const p of this.parts) {
      p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      for (const c of p.colliders) c.setEnabled(true);
      p.body.setLinvel({ x: f.x * v, y: 0, z: f.z * v }, true);
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /**
   * Asleep: its bodies where its planner has it after this step (call before world.step) - on its springs' rest
   * height, level, along its heading; a trailer straight behind its cab's hitch (as it hangs on waking).
   */
  follow(agent: Agent, dt: number, time: number): void {
    this.rolled += agent.v * dt;
    const cab = this.parts[0];
    const ry = this.frame.rotationY(agent.yaw);
    const q = { x: 0, y: Math.sin(ry / 2), z: 0, w: Math.cos(ry / 2) };
    const c = this.frame.toWorld(agent.s + agent.length / 2 - cab.spec.l / 2, agent.d);
    cab.body.setNextKinematicTranslation({ x: c.x, y: cab.spec.h / 2, z: c.z });
    cab.body.setNextKinematicRotation(q);
    if (this.parts.length === 2) {
      const f = this.frame.forwardWorld(agent.yaw);
      const back = HITCH_FROM_CAB_CENTER + KINGPIN_FROM_TRAILER_CENTER;
      const trailer = this.parts[1];
      trailer.body.setNextKinematicTranslation({ x: c.x - f.x * back, y: trailer.spec.h / 2, z: c.z - f.z * back });
      trailer.body.setNextKinematicRotation(q);
    }
    this.lamps(agent, time);
  }

  /** Its indicators (changing lanes) and brake lights (braking) from its planner. */
  private lamps(agent: Agent, time: number): void {
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
    this.wake(undefined); // (asleep: TrafficWorld.wreck has woken it at its speed first)
    this.wrecked = true;
    this.wreckTime = 0;
    for (const p of this.parts) {
      for (const c of p.colliders) c.setCollisionGroups(WRECK_GROUPS);
      setBrake(p.lights, true);
      this.switchToTyreModel(p);
    }
  }

  /** Replace Rapier's simple vehicle controller with the full tyre/wheel model. */
  private switchToTyreModel(p: Part): void {
    if (!p.vehicle) return;
    const vc = p.vehicle;
    const v = p.body.linvel();
    const q = p.body.rotation();
    TMP_V.set(0, 0, -1).applyQuaternion(TMP_Q.set(q.x, q.y, q.z, q.w));
    const forward = v.x * TMP_V.x + v.z * TMP_V.z;
    const wheels: ChassisWheel[] = p.wheels.map((w, i) => {
      const mCorner = w.staticLoad / G;
      const k = w.staticLoad / SAG;
      const cw = makeWheel(
        {
          x: w.x,
          z: w.z,
          connY: w.connY,
          r: w.r,
          front: w.steer,
          springK: k,
          bump: 2 * 0.45 * Math.sqrt(k * mCorner),
          rebound: 2 * 0.65 * Math.sqrt(k * mCorner),
          mEff: mCorner * 0.9,
          gripScale: 1,
        },
        vc.wheelSuspensionLength(i) ?? p.spec.rest - SAG,
      );
      cw.omega = forward / w.r;
      cw.spin = vc.wheelRotation(i) ?? 0;
      return cw;
    });
    this.physics.world.removeVehicleController(vc);
    p.vehicle = null;
    p.chassis = new TyreChassis(this.physics, p.body, wheels, {
      rest: p.spec.rest,
      travel: 0.2,
      inertia: p.spec.mass > 3000 ? 4 : 1,
      antiRoll: [],
      tire: this.kind === 'car' ? WRECK_TIRE : TRUCK_WRECK_TIRE,
      surfaceGrip: wreckSurfaceGrip,
      // Sideways-sliding wrecks trip and roll (car tipping threshold ~2.0, trucks ~0.8).
      sideTrip: { from: Math.PI / 6, to: Math.PI / 2, mu: this.kind === 'car' ? WRECK_TRIP.car : WRECK_TRIP.truck },
    });
  }

  /** Wheels of wrecked parts (for skid marks / smoke). */
  wreckWheels(): { part: number; wheels: ChassisWheel[]; body: RAPIER.RigidBody }[] {
    return this.parts.filter((p) => p.chassis).map((p, i) => ({ part: i, wheels: p.chassis!.wheels, body: p.body }));
  }

  /** Wrecks keep their (braked) wheels and flash hazard lights. */
  updateWreck(dt: number, time: number): void {
    this.wreckTime += dt;
    for (const p of this.parts) {
      if (!p.chassis) continue;
      const n = p.wheels.length;
      // The driver stands on the brakes: enough torque to lock every wheel.
      const mu = p.chassis.setup.tire.muPeak;
      const brake = p.wheels.map((w) => 1.5 * mu * w.staticLoad * w.r);
      p.chassis.step(dt, new Array(n).fill(0), new Array(n).fill(0), brake);
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

  /** Interpolated body pose; light flares. */
  render(alpha: number, flares: LightFlares): void {
    for (const p of this.parts) {
      p.mesh.position.lerpVectors(p.prevPos, p.currPos, alpha);
      p.mesh.quaternion.slerpQuaternions(p.prevQuat, p.currQuat, alpha);
      p.mesh.updateMatrix();
      emitFlares(p.mesh, p.lights, flares);
    }
  }

  /**
   * Its bodies, and the wheels of those drawn (placed from the live suspension state; drawn as their body is - in
   * its bounds), into this frame's instanced drawing (after render: where they are).
   */
  addBodies(bodies: BodyInstances): void {
    const wheel = npcWheel();
    for (const p of this.parts) {
      const shown = bodies.add(p.model.key, p.model.template, p.mesh.matrix, p.lights);
      if (!shown) continue;
      for (let i = 0; i < p.wheels.length; i++) {
        const w = p.wheels[i];
        const cw = p.chassis?.wheels[i];
        const len = cw ? cw.susp : p.vehicle!.wheelSuspensionLength(i) ?? p.spec.rest;
        // (asleep: its controller still, the wheels rolled on by the way it has gone - Rapier's turn falls going forward)
        const spin = cw ? cw.spin : this.asleep ? (p.sleepSpin[i] ?? 0) - this.rolled / w.r : p.vehicle!.wheelRotation(i) ?? 0;
        const steer = cw ? -cw.steer : this.asleep ? 0 : p.vehicle!.wheelSteering(i) ?? 0;
        TMP_E.set(spin, steer, 0, 'YXZ');
        TMP_Q.setFromEuler(TMP_E);
        TMP_S.set(w.width, w.r, w.r);
        // (twin wheels: one each side of its place)
        const twins = w.gap > 0 ? 2 : 1;
        for (let k = 0; k < twins; k++) {
          const dx = twins === 2 ? (k === 0 ? -w.gap / 2 : w.gap / 2) : 0;
          TMP_M2.compose(TMP_V.set(w.shownX + dx, w.connY - len, w.z), TMP_Q, TMP_S);
          bodies.add(NPC_WHEEL, wheel, TMP_M.multiplyMatrices(p.mesh.matrix, TMP_M2), NO_LAMPS, shown);
        }
      }
    }
  }

  /** Position along OUR road (world s = -z) of the first part, for culling. */
  get s(): number {
    return -this.parts[0].body.translation().z;
  }

  /** World x of the first part. */
  get x(): number {
    return this.parts[0].body.translation().x;
  }

  /** Boxes an AI driving in `frame` must avoid (one per part). */
  obstacles(frame: RoadFrame): Obstacle[] {
    return this.parts.map((p, i) => {
      const t = p.body.translation();
      const f = forwardOf(p.body.rotation());
      const v = p.body.linvel();
      const b = boxToFrame(frame, { x: t.x, z: t.z, fx: f.x, fz: f.z, w: p.spec.w, l: p.spec.l, vx: v.x, vz: v.z });
      return { id: -(this.id * 10 + i), ...b };
    });
  }

  dispose(): void {
    if (this.joint) this.physics.world.removeImpulseJoint(this.joint, true);
    for (const p of this.parts) {
      if (p.vehicle) this.physics.world.removeVehicleController(p.vehicle);
      for (const c of p.colliders) this.physics.unregister(c);
      this.physics.world.removeRigidBody(p.body);
    }
  }
}
