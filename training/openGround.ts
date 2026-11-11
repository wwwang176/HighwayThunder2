import { PhysicsWorld } from '../src/physics/physicsWorld';

/**
 * A physics world with the road's ground but no guardrails: turning hard for a second or more
 * at speed carries the car 10+ m sideways, into the rail - and over it (that is a crash, not
 * the car rolling over in a turn). Call after RAPIER.init().
 */
export function openGround(): PhysicsWorld {
  const physics = PhysicsWorld.createSync();
  physics.removeRails();
  return physics;
}
