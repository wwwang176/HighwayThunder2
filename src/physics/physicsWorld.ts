import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { LEFT_RAIL_X, RAIL_D } from '../config';
import { Centerline, STRAIGHT_ROAD } from '../road/centerline';

export type EntityRef = { type: 'player' } | { type: 'rival'; id: number } | { type: 'npc'; id: number } | { type: 'static' };

// Collision group bits (membership << 16 | filter).
export const G_STATIC = 1;
export const G_PLAYER = 2;
export const G_NPC_LIVE = 4;
export const G_WRECK = 8;
export const G_RIVAL = 16;
const ALL = G_STATIC | G_PLAYER | G_NPC_LIVE | G_WRECK | G_RIVAL;

export const groups = (membership: number, filter: number) => (membership << 16) | filter;
export const STATIC_GROUPS = groups(G_STATIC, ALL);
export const PLAYER_GROUPS = groups(G_PLAYER, G_STATIC | G_NPC_LIVE | G_WRECK | G_RIVAL);
/** Rival racers hit everything: the player, traffic, wrecks, the rails and each other. */
export const RIVAL_GROUPS = groups(G_RIVAL, ALL);
/** Live NPCs never touch each other: pile-ups only spread through wrecks. */
export const NPC_LIVE_GROUPS = groups(G_NPC_LIVE, G_STATIC | G_PLAYER | G_WRECK | G_RIVAL);
export const WRECK_GROUPS = groups(G_WRECK, ALL);

/**
 * A curved road's guardrails: a plane of its own for each car near one (RailSlots). Each slot a group bit of its
 * own (bits 5-14: the type bits above stay as they are), its plane in it and filtering only it; the car holding the
 * slot has the bit added to its membership and filter, so it, and nothing else, meets that plane.
 */
const RAIL_SLOTS = 10;
const SLOT_BIT = (i: number) => 1 << (5 + i);
const SLOT_MASK = ((((1 << RAIL_SLOTS) - 1) << 5) * 0x10001) >>> 0; // (the slot bits, in membership and filter)
/** A car this near a rail (m, its nearest point; it gets a plane), and given up beyond this (m). */
const RAIL_NEAR = 2;
const RAIL_LET_GO = 3;

/** A body's own box (its colliders' extent in its own axes): its middle and half sizes. */
interface BodyBox {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
}

interface RailBody {
  /** Where it was at the last step (s: the projection's hint). */
  s: number;
  d: number;
  box: BodyBox;
  /** Its slot (-1: none). */
  slot: number;
  /** The step it was last seen in (gone from the world: dropped). */
  seen: number;
}

/** Two colliders touching: see PhysicsWorld.touches. */
export interface Touch {
  a: EntityRef;
  b: EntityRef;
  /** Its contact points (world), the first `count`. */
  points: THREE.Vector3[];
  count: number;
  /** Unit, world; sign unspecified. */
  normal: THREE.Vector3;
  /** The points' middle. */
  mid: THREE.Vector3;
  va: THREE.Vector3;
  vb: THREE.Vector3;
  /** Which way is up for each body (world; a fixed thing's, 0): a car's roof side. */
  upA: THREE.Vector3;
  upB: THREE.Vector3;
  fresh: boolean;
}

/** A body's velocity at world point `p` (none: a fixed thing's, 0). */
function velocityAt(body: RAPIER.RigidBody | null, p: THREE.Vector3, out: THREE.Vector3): void {
  if (!body || body.isFixed()) {
    out.set(0, 0, 0);
    return;
  }
  const v = body.velocityAtPoint(p);
  out.set(v.x, v.y, v.z);
}

const Q = new THREE.Quaternion();

/** Which way is up for a body (none, or a fixed thing: 0). */
function upOf(body: RAPIER.RigidBody | null, out: THREE.Vector3): void {
  if (!body || body.isFixed()) {
    out.set(0, 0, 0);
    return;
  }
  const r = body.rotation();
  out.set(0, 1, 0).applyQuaternion(Q.set(r.x, r.y, r.z, r.w));
}

const QA = new THREE.Quaternion();
const VA = new THREE.Vector3();

/** A body's colliders' box in its own axes (their corners, or hull points, through their place on it). */
function bodyBox(b: RAPIER.RigidBody): BodyBox {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < b.numColliders(); i++) {
    const c = b.collider(i);
    const t = c.translationWrtParent() ?? { x: 0, y: 0, z: 0 };
    const r = c.rotationWrtParent() ?? { x: 0, y: 0, z: 0, w: 1 };
    QA.set(r.x, r.y, r.z, r.w);
    const round = c.roundRadius() || 0;
    const pts: number[] = [];
    const he = c.halfExtents();
    if (he) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(sx * he.x, sy * he.y, sz * he.z);
    } else if (c.shapeType() === RAPIER.ShapeType.ConvexPolyhedron || c.shapeType() === RAPIER.ShapeType.RoundConvexPolyhedron) {
      pts.push(...c.vertices());
    } else {
      const rr = c.radius() || 1;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(sx * rr, sy * rr, sz * rr);
    }
    for (let k = 0; k < pts.length; k += 3) {
      VA.set(pts[k], pts[k + 1], pts[k + 2]).applyQuaternion(QA);
      const p = [VA.x + t.x, VA.y + t.y, VA.z + t.z];
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], p[a] - round);
        hi[a] = Math.max(hi[a], p[a] + round);
      }
    }
  }
  if (!(lo[0] <= hi[0])) return { cx: 0, cy: 0, cz: 0, hx: 0, hy: 0, hz: 0 };
  return {
    cx: (lo[0] + hi[0]) / 2,
    cy: (lo[1] + hi[1]) / 2,
    cz: (lo[2] + hi[2]) / 2,
    hx: (hi[0] - lo[0]) / 2,
    hy: (hi[1] - lo[1]) / 2,
    hz: (hi[2] - lo[2]) / 2,
  };
}

/** How far a body's box reaches from its origin along the world's (nx, 0, nz) (unit), however it is turned. */
function reach(b: RAPIER.RigidBody, box: BodyBox, nx: number, nz: number): number {
  const r = b.rotation();
  VA.set(nx, 0, nz).applyQuaternion(QA.set(-r.x, -r.y, -r.z, r.w)); // (into its own axes)
  return VA.x * box.cx + VA.y * box.cy + VA.z * box.cz + Math.abs(VA.x) * box.hx + Math.abs(VA.y) * box.hy + Math.abs(VA.z) * box.hz;
}

/** A body's colliders with the rail-slot bit `bit` (0: none) in their membership and filter, their other groups as they are. */
function setSlotBits(b: RAPIER.RigidBody, bit: number): void {
  const add = (bit * 0x10001) >>> 0;
  for (let i = 0; i < b.numColliders(); i++) {
    const c = b.collider(i);
    const g = c.collisionGroups() >>> 0;
    const want = ((g & ~SLOT_MASK) | add) >>> 0;
    if (want !== g) c.setCollisionGroups(want);
  }
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  /** The straight road's guardrails' colliders (training runs without them: training/openGround, removeRails). */
  readonly rails: RAPIER.Collider[] = [];
  /** The road the rails follow (straight: the two fixed planes in `rails`; curved: a plane per car near one). */
  private road: Centerline = STRAIGHT_ROAD;
  private railsOff = false;
  /** A curved road's rail planes, one per slot, and the body holding each (its handle; -1 free). */
  private readonly slotRails: RAPIER.Collider[] = [];
  private readonly slotBody: number[] = [];
  private readonly railBodies = new Map<number, RailBody>();
  private railStep = 0;
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly owners = new Map<number, EntityRef>();
  /** Pairs of (registered) colliders touching, by their handles. */
  private readonly touching = new Map<string, { h1: number; h2: number; fresh: boolean }>();
  private readonly touch: Touch = {
    a: { type: 'static' },
    b: { type: 'static' },
    points: Array.from({ length: 8 }, () => new THREE.Vector3()),
    count: 0,
    normal: new THREE.Vector3(),
    mid: new THREE.Vector3(),
    va: new THREE.Vector3(),
    vb: new THREE.Vector3(),
    upA: new THREE.Vector3(),
    upB: new THREE.Vector3(),
    fresh: false,
  };

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
    this.createStatics();
  }

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  /** A fresh world once RAPIER.init() has completed (e.g. one per training generation). */
  static createSync(): PhysicsWorld {
    return new PhysicsWorld();
  }

  /** Release the WASM-side world. The object must not be used afterwards. */
  free(): void {
    this.eventQueue.free();
    this.world.free();
    this.owners.clear();
  }

  set timestep(dt: number) {
    this.world.timestep = dt;
  }

  /**
   * The ground and the guardrails as half-spaces: planes with everything beyond them solid. Not boxes: a car's
   * body sliding along a box the road's length now and then got a contact normal along the road (the box's end,
   * as it were), and was stopped and thrown off the rail in one step. Against a plane the push is always its
   * normal; nothing tunnels through one (all behind it is solid), and nothing gets over the rails (they have no
   * top) or off the ground's edge (it has none).
   */
  private createStatics(): void {
    const ground = this.world.createCollider(
      new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setFriction(0.9).setCollisionGroups(STATIC_GROUPS),
    );
    this.register(ground, { type: 'static' });
    this.createStraightRails();
  }

  /** The straight road's guardrails: only on the outer edges (their inner faces, facing the road); the median between carriageways is open grass. */
  private createStraightRails(): void {
    for (const [x, nx] of [[RAIL_D, -1], [LEFT_RAIL_X, 1]]) {
      const rail = this.world.createCollider(
        new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: nx, y: 0, z: 0 }))
          .setTranslation(x, 0, 0)
          .setFriction(0.1)
          .setRestitution(0.1)
          .setCollisionGroups(STATIC_GROUPS),
      );
      this.register(rail, { type: 'static' });
      this.rails.push(rail);
    }
  }

  /** No guardrails at all (training on open ground: training/openGround). */
  removeRails(): void {
    this.railsOff = true;
    this.dropStraightRails();
    this.freeSlots();
  }

  private dropStraightRails(): void {
    for (const c of this.rails) {
      this.unregister(c);
      this.world.removeCollider(c, false);
    }
    this.rails.length = 0;
  }

  /**
   * The road the guardrails follow. Straight: the two fixed planes along it, as ever. Curved: no plane can be a
   * whole curved rail (a plane touching the inner rail of a bend at one spot cuts across the road a few hundred
   * metres on), nor a run of boxes (a car sliding along them meets each box's end, and is stopped and thrown off);
   * so each car near a rail gets a plane of its own, touching the rail where the car is (RailSlots: within a car's
   * length a bend of R 1000 strays from it by a few millimetres), the planes as the straight road's otherwise.
   */
  setRoad(road: Centerline): void {
    this.road = road;
    if (this.railsOff) return;
    if (road.straight) {
      this.freeSlots();
      if (!this.rails.length) this.createStraightRails();
      return;
    }
    this.dropStraightRails();
    this.freeSlots(); // (a new road: every car's place on it, and its slot, found afresh)
    while (this.slotRails.length < RAIL_SLOTS) {
      const i = this.slotRails.length;
      const bit = SLOT_BIT(i);
      const c = this.world.createCollider(
        new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 1, y: 0, z: 0 }))
          .setTranslation(0, 0, 1e5) // (far off till held)
          .setFriction(0.1)
          .setRestitution(0.1)
          .setCollisionGroups(groups(bit, bit)),
      );
      this.register(c, { type: 'static' });
      this.slotRails.push(c);
      this.slotBody.push(-1);
    }
  }

  /** Every slot let go (its body's bits off, its plane away). */
  private freeSlots(): void {
    for (let i = 0; i < this.slotBody.length; i++) this.release(i);
    this.railBodies.clear();
  }

  private release(slot: number): void {
    const h = this.slotBody[slot];
    if (h < 0) return;
    this.slotBody[slot] = -1;
    const b = this.world.getRigidBody(h);
    if (b) setSlotBits(b, 0);
    const info = this.railBodies.get(h);
    if (info) info.slot = -1;
    this.slotRails[slot].setTranslation({ x: 0, y: 0, z: 1e5 });
  }

  /**
   * Before each step on a curved road: which cars are near a rail (their nearest point within RAIL_NEAR m), each
   * of them (the nearest first, while slots last) given a slot - kept while it stays within RAIL_LET_GO m - and
   * its plane put against the rail where it is, facing the road.
   */
  private updateRails(): void {
    if (this.road.straight || this.railsOff) return;
    const road = this.road;
    const step = ++this.railStep;
    const wanting: { h: number; gap: number }[] = [];
    this.world.forEachRigidBody((b) => {
      if (!b.isDynamic()) return;
      let info = this.railBodies.get(b.handle);
      if (!info) {
        info = { s: NaN, d: 0, box: bodyBox(b), slot: -1, seen: step };
        this.railBodies.set(b.handle, info);
      }
      info.seen = step;
      const t = b.translation();
      const p = road.project(t.x, t.z, Number.isNaN(info.s) ? undefined : info.s);
      info.s = p.s;
      info.d = p.d;
      const th = road.heading(p.s);
      const nx = Math.cos(th);
      const nz = Math.sin(th);
      const right = RAIL_D - p.d - reach(b, info.box, nx, nz);
      const left = p.d - LEFT_RAIL_X - reach(b, info.box, -nx, -nz);
      const gap = Math.min(right, left);
      if (gap < (info.slot >= 0 ? RAIL_LET_GO : RAIL_NEAR)) wanting.push({ h: b.handle, gap });
      else if (info.slot >= 0) this.release(info.slot);
    });
    // Gone from the world: forgotten, their slots freed.
    for (const [h, info] of this.railBodies) {
      if (info.seen === step) continue;
      if (info.slot >= 0) {
        this.slotBody[info.slot] = -1;
        this.slotRails[info.slot].setTranslation({ x: 0, y: 0, z: 1e5 });
      }
      this.railBodies.delete(h);
    }
    wanting.sort((a, b) => a.gap - b.gap);
    for (const { h } of wanting) {
      const info = this.railBodies.get(h)!;
      if (info.slot < 0) {
        const free = this.slotBody.indexOf(-1);
        if (free < 0) continue; // (all held by nearer ones)
        info.slot = free;
        this.slotBody[free] = h;
      }
      const b = this.world.getRigidBody(h)!;
      setSlotBits(b, SLOT_BIT(info.slot)); // (again each step: a car turned wreck has its groups set anew)
      // Its plane: on the nearer rail where the car is, facing the road (local +x turned to the normal).
      const d = info.d;
      const rightSide = RAIL_D - d < d - LEFT_RAIL_X;
      const th = road.heading(info.s);
      const at = road.toWorld(info.s, rightSide ? RAIL_D : LEFT_RAIL_X);
      const phi = rightSide ? Math.PI - th : -th; // (+x turned by phi about y: (cos phi, 0, -sin phi))
      const c = this.slotRails[info.slot];
      c.setTranslation({ x: at.x, y: 0, z: at.z });
      c.setRotation({ x: 0, y: Math.sin(phi / 2), z: 0, w: Math.cos(phi / 2) });
    }
  }

  register(collider: RAPIER.Collider, ref: EntityRef): void {
    this.owners.set(collider.handle, ref);
  }

  unregister(collider: RAPIER.Collider): void {
    this.owners.delete(collider.handle);
    // (its body's rail bookkeeping gone too: another body may take its handle, with another box)
    const body = collider.parent();
    const info = body ? this.railBodies.get(body.handle) : undefined;
    if (body && info) {
      if (info.slot >= 0) this.release(info.slot);
      this.railBodies.delete(body.handle);
    }
    for (const [key, p] of this.touching) if (p.h1 === collider.handle || p.h2 === collider.handle) this.touching.delete(key);
  }

  /** `normal`: which way the two pushed on each other (unit, on the ground; sign unspecified), null when unknown. */
  step(onContact: (a: EntityRef, b: EntityRef, normal: { x: number; z: number } | null) => void): void {
    this.updateRails();
    this.world.step(this.eventQueue);
    for (const p of this.touching.values()) p.fresh = false;
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      const key = h1 < h2 ? `${h1},${h2}` : `${h2},${h1}`;
      if (!started) {
        this.touching.delete(key);
        return;
      }
      const a = this.owners.get(h1);
      const b = this.owners.get(h2);
      if (!a || !b) return;
      this.touching.set(key, { h1, h2, fresh: true });
      onContact(a, b, this.contactNormal(h1, h2));
    });
  }

  /**
   * Every pair touching after the last step: where (its contact points, world), how each surface moves there
   * (`va`, `vb`: of the first and the second), and whether they met in that step (`fresh`). `t` is reused.
   */
  touches(f: (t: Touch) => void): void {
    const t = this.touch;
    for (const [key, p] of this.touching) {
      const c1 = this.world.getCollider(p.h1);
      const c2 = this.world.getCollider(p.h2);
      const a = this.owners.get(p.h1);
      const b = this.owners.get(p.h2);
      if (!c1 || !c2 || !a || !b) {
        this.touching.delete(key); // removed (a despawned car's)
        continue;
      }
      t.count = 0;
      this.world.contactPair(c1, c2, (m) => {
        for (let i = 0; i < m.numSolverContacts() && t.count < t.points.length; i++) {
          const q = m.solverContactPoint(i);
          if (q) t.points[t.count++].set(q.x, q.y, q.z);
        }
        if (t.count) m.normal(t.normal);
      });
      if (!t.count) continue;
      // The surfaces' velocities at the middle of the contact.
      const mid = t.mid.set(0, 0, 0);
      for (let i = 0; i < t.count; i++) mid.add(t.points[i]);
      mid.multiplyScalar(1 / t.count);
      velocityAt(c1.parent(), mid, t.va);
      velocityAt(c2.parent(), mid, t.vb);
      upOf(c1.parent(), t.upA);
      upOf(c2.parent(), t.upB);
      t.a = a;
      t.b = b;
      t.fresh = p.fresh;
      f(t);
    }
  }

  private contactNormal(h1: number, h2: number): { x: number; z: number } | null {
    const c1 = this.world.getCollider(h1);
    const c2 = this.world.getCollider(h2);
    if (!c1 || !c2) return null;
    let out: { x: number; z: number } | null = null;
    this.world.contactPair(c1, c2, (m) => {
      if (out || m.numContacts() === 0) return;
      const n = m.normal();
      const len = Math.hypot(n.x, n.z);
      if (len > 1e-3) out = { x: n.x / len, z: n.z / len };
    });
    return out;
  }
}
