import RAPIER from '@dimforge/rapier3d-compat';
import { LEFT_RAIL_X, RAIL_D, ROAD_LENGTH } from '../config';

export type EntityRef = { type: 'player' } | { type: 'npc'; id: number } | { type: 'static' };

// Collision group bits (membership << 16 | filter).
export const G_STATIC = 1;
export const G_PLAYER = 2;
export const G_NPC_LIVE = 4;
export const G_WRECK = 8;
/** AI training cars: they stand on the road and touch nothing else (crashes are judged geometrically). */
export const G_GHOST = 16;
const ALL = G_STATIC | G_PLAYER | G_NPC_LIVE | G_WRECK;

export const groups = (membership: number, filter: number) => (membership << 16) | filter;
export const STATIC_GROUPS = groups(G_STATIC, ALL | G_GHOST);
export const GHOST_GROUPS = groups(G_GHOST, G_STATIC);
export const PLAYER_GROUPS = groups(G_PLAYER, G_STATIC | G_NPC_LIVE | G_WRECK);
/** Live NPCs never touch each other: pile-ups only spread through wrecks. */
export const NPC_LIVE_GROUPS = groups(G_NPC_LIVE, G_STATIC | G_PLAYER | G_WRECK);
export const WRECK_GROUPS = groups(G_WRECK, ALL);

export const ROAD_START_S = -300;
export const ROAD_END_S = ROAD_LENGTH + 800;

export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly owners = new Map<number, EntityRef>();

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
  }

  step(onContact: (a: EntityRef, b: EntityRef) => void): void {
    this.world.step(this.eventQueue);
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.owners.get(h1);
      const b = this.owners.get(h2);
      if (a && b) onContact(a, b);
    });
  }
}
