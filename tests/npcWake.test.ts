import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_DT, type VehicleKind } from '../src/config';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { OUR_FRAME } from '../src/road/frame';
import { TrafficSim } from '../src/traffic/trafficAI';
import { NpcVehicle } from '../src/vehicles/npcVehicle';

beforeAll(async () => {
  await RAPIER.init();
});

function rngFrom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const finite = (v: { x: number; y: number; z: number }) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

describe('NpcVehicle waking', () => {
  // (Rapier gives a body turned dynamic its mass at the next step: driven before it, standing, its wheels' impulses
  // came out NaN - spread through the traffic's planner down its lane, to a rival's emergency brake, and the game stopped)
  for (const kind of ['car', 'truck', 'container'] as VehicleKind[]) {
    it(`a ${kind} woken standing still is driven the same step with finite velocities`, () => {
      const physics = PhysicsWorld.createSync();
      physics.timestep = PHYSICS_DT;
      const sim = new TrafficSim();
      const rng = rngFrom(3);
      const a = sim.addAgent(kind, 50, 2, rng);
      a.v = 0;
      a.accel = -9;
      const npc = new NpcVehicle(physics, OUR_FRAME, a, rng);
      for (let i = 0; i < 60; i++) {
        npc.drive(a, PHYSICS_DT, i * PHYSICS_DT);
        physics.step(() => {});
        npc.syncAgent(a);
      }
      a.v = 0;
      npc.sleep(a);
      for (let i = 0; i < 10; i++) {
        npc.follow(a, PHYSICS_DT, 1);
        physics.step(() => {});
      }
      npc.wake(a);
      npc.drive(a, PHYSICS_DT, 2);
      for (const p of npc.parts) {
        expect(finite(p.body.linvel())).toBe(true);
        expect(finite(p.body.angvel())).toBe(true);
      }
      physics.free();
    });
  }
});
