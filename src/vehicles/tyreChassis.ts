import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { G_PLAYER, G_STATIC, groups, PhysicsWorld } from '../physics/physicsWorld';
import { solveWheel, TireParams } from './tireModel';

const WHEEL_RAY_GROUPS = groups(G_PLAYER, G_STATIC); // wheels only stand on the road

/** One wheel: fixed geometry/setup plus the state the simulation updates every step. */
export interface ChassisWheel {
  // setup
  x: number; // hard point, chassis space
  z: number;
  connY: number;
  r: number;
  front: boolean;
  springK: number; // N/m
  bump: number; // N·s/m
  rebound: number; // N·s/m
  mEff: number; // mass this wheel carries (kg)
  gripScale: number; // per-wheel grip multiplier (e.g. wider rear tyres)
  // state
  omega: number;
  spin: number; // accumulated visual rotation
  susp: number; // current suspension length
  steer: number;
  inContact: boolean;
  sliding: boolean;
  slip: number;
  load: number;
  fx: number;
  fy: number;
  alpha: number;
  contactX: number;
  contactZ: number;
  dirX: number;
  dirZ: number;
}

export interface ChassisSetup {
  rest: number; // suspension rest length (m)
  travel: number; // max compression from rest (m)
  inertia: number; // wheel + driveline inertia (kg·m²)
  antiRoll: [number, number, number][]; // [left wheel, right wheel, N/m]
  tire: TireParams;
  surfaceGrip: (x: number) => number;
}

export function makeWheel(
  w: Pick<ChassisWheel, 'x' | 'z' | 'connY' | 'r' | 'front' | 'springK' | 'bump' | 'rebound' | 'mEff' | 'gripScale'>,
  susp: number,
): ChassisWheel {
  return {
    ...w,
    omega: 0, spin: 0, susp, steer: 0, inContact: true, sliding: false, slip: 0, load: 0,
    fx: 0, fy: 0, alpha: 0, contactX: 0, contactZ: 0, dirX: 0, dirZ: -1,
  };
}

const TMP_Q = new THREE.Quaternion();
const TMP_V = new THREE.Vector3();
const UP = new THREE.Vector3();
const FWD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const HARD = new THREE.Vector3();
const CONTACT = new THREE.Vector3();

/**
 * Ray-cast wheels with spring/damper suspension, anti-roll bars and the tyre
 * model (grip limit, wheelspin, lock-up, slides) on a Rapier chassis. Shared by
 * the player's car and by traffic vehicles once they are wrecks, so both follow
 * the same rules. Chassis space: nose toward -Z, +X to the right.
 */
export class TyreChassis {
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  constructor(
    private physics: PhysicsWorld,
    readonly body: RAPIER.RigidBody,
    readonly wheels: ChassisWheel[],
    public setup: ChassisSetup,
  ) {}

  /**
   * Apply suspension and tyre forces for one step (call before world.step).
   * @param steer wheel angle per wheel (rad, + = right)
   * @param drive drive torque per wheel (N·m, + = forward)
   * @param brake brake torque per wheel (N·m)
   */
  step(dt: number, steer: ArrayLike<number>, drive: ArrayLike<number>, brake: ArrayLike<number>): void {
    const s = this.setup;
    const t = this.body.translation();
    const r = this.body.rotation();
    TMP_Q.set(r.x, r.y, r.z, r.w);
    UP.set(0, 1, 0).applyQuaternion(TMP_Q);

    // 1) Suspension: ray from each hard point down along the chassis.
    const comp: number[] = [];
    for (const w of this.wheels) {
      HARD.set(w.x, w.connY, w.z).applyQuaternion(TMP_Q).add(TMP_V.set(t.x, t.y, t.z));
      this.ray.origin = { x: HARD.x, y: HARD.y, z: HARD.z };
      this.ray.dir = { x: -UP.x, y: -UP.y, z: -UP.z };
      const hit = this.physics.world.castRay(this.ray, s.rest + w.r, true, undefined, WHEEL_RAY_GROUPS, undefined, this.body);
      const prev = w.susp;
      if (hit && UP.y > 0.2) {
        w.susp = Math.max(s.rest - s.travel, hit.timeOfImpact - w.r);
        w.inContact = true;
      } else {
        w.susp = s.rest;
        w.inContact = false;
      }
      comp.push(w.inContact ? s.rest - w.susp : 0);
      const compVel = (prev - w.susp) / dt;
      const f = w.inContact ? w.springK * (s.rest - w.susp) + (compVel > 0 ? w.bump : w.rebound) * compVel : 0;
      w.load = Math.max(0, f);
    }
    // Anti-roll bars move load from the lightly to the heavily compressed side.
    for (const [a, b, k] of s.antiRoll) {
      const ar = k * (comp[a] - comp[b]);
      if (this.wheels[a].inContact) this.wheels[a].load = Math.max(0, this.wheels[a].load + ar);
      if (this.wheels[b].inContact) this.wheels[b].load = Math.max(0, this.wheels[b].load - ar);
    }

    // 2) Tyres.
    this.wheels.forEach((w, i) => {
      w.steer = steer[i] ?? 0;
      HARD.set(w.x, w.connY, w.z).applyQuaternion(TMP_Q).add(TMP_V.set(t.x, t.y, t.z));
      if (w.load > 0) {
        this.body.applyImpulseAtPoint({ x: UP.x * w.load * dt, y: UP.y * w.load * dt, z: UP.z * w.load * dt }, HARD, true);
      }
      CONTACT.copy(HARD).addScaledVector(UP, -(w.susp + w.r));
      FWD.set(Math.sin(w.steer), 0, -Math.cos(w.steer)).applyQuaternion(TMP_Q);
      FWD.y = 0;
      if (FWD.lengthSq() < 1e-6) FWD.set(0, 0, -1);
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
        driveTorque: drive[i] ?? 0,
        brakeTorque: brake[i] ?? 0,
        R: w.r,
        I: s.inertia,
        dt,
        mEff: w.mEff,
        tire: s.tire,
        muScale: s.surfaceGrip(CONTACT.x) * w.gripScale,
      });
      w.omega = res.omega;
      w.spin -= res.omega * dt;
      w.sliding = res.sliding;
      w.slip = res.slip;
      w.fx = res.Fx;
      w.fy = res.Fy;
      w.alpha = Math.atan2(vy, Math.max(Math.abs(vx), 0.5));
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
  }

  /** Strongest tyre slide this step (m/s of slip). */
  get maxSlip(): number {
    let m = 0;
    for (const w of this.wheels) if (w.inContact && w.sliding) m = Math.max(m, w.slip);
    return m;
  }
}
