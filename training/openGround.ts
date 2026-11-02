import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../src/physics/physicsWorld';

/**
 * A physics world with the road's ground but no guardrails: turning hard for a second or more
 * at speed carries the car 10+ m sideways, into the rail - and over it (that is a crash, not
 * the car rolling over in a turn). Call after RAPIER.init().
 */
export function openGround(): PhysicsWorld {
  const physics = PhysicsWorld.createSync();
  const rails: RAPIER.Collider[] = [];
  physics.world.forEachCollider((c) => {
    if (!c.parent() && c.halfExtents().x < 50) rails.push(c); // the ground is 160 m wide
  });
  for (const c of rails) physics.world.removeCollider(c, false);
  return physics;
}
