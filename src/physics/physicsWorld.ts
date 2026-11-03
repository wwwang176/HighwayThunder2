import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { LEFT_RAIL_X, RAIL_D, ROAD_LENGTH } from '../config';

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

export const ROAD_START_S = -300;
export const ROAD_END_S = ROAD_LENGTH + 800;

export class PhysicsWorld {
  readonly world: RAPIER.World;
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

  private createStatics(): void {
    const half = (ROAD_END_S - ROAD_START_S) / 2;
    const centerZ = -(ROAD_START_S + half);
    const ground = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(80, 0.5, half)
        .setTranslation(0, -0.5, centerZ)
        .setFriction(0.9)
        .setCollisionGroups(STATIC_GROUPS),
    );
    this.register(ground, { type: 'static' });
    // Guardrails only on the outer edges; the median between carriageways is open grass.
    // Thick rails so wrecks (no CCD) cannot tunnel through.
    for (const x of [RAIL_D + 0.6, LEFT_RAIL_X - 0.6]) {
      const rail = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.6, 0.8, half)
          .setTranslation(x, 0.8, centerZ)
          .setFriction(0.1)
          .setRestitution(0.1)
          .setCollisionGroups(STATIC_GROUPS),
      );
      this.register(rail, { type: 'static' });
    }
  }

  register(collider: RAPIER.Collider, ref: EntityRef): void {
    this.owners.set(collider.handle, ref);
  }

  unregister(collider: RAPIER.Collider): void {
    this.owners.delete(collider.handle);
    for (const [key, p] of this.touching) if (p.h1 === collider.handle || p.h2 === collider.handle) this.touching.delete(key);
  }

  /** `normal`: which way the two pushed on each other (unit, on the ground; sign unspecified), null when unknown. */
  step(onContact: (a: EntityRef, b: EntityRef, normal: { x: number; z: number } | null) => void): void {
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
