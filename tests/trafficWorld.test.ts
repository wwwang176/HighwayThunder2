import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { TrafficWorld } from '../src/sim/trafficWorld';
import { WheelInstances } from '../src/vehicles/wheelInstances';
import { mulberry32 } from '../src/ai/rng';
import { PHYSICS_DT } from '../src/config';

beforeAll(async () => {
  await RAPIER.init();
});

function makeWorld(seed = 1) {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const scene = new THREE.Scene();
  const world = new TrafficWorld(physics, scene, new WheelInstances(scene), mulberry32(seed), { oncoming: false });
  return { physics, world };
}

describe('TrafficWorld.ourBoxes', () => {
  it('shows the lane a car is moving into, not one it only signals for (it waits for the player then)', () => {
    const { world } = makeWorld();
    world.reset({ sLead: 0, sTail: 0, vLead: 0, raceTime: 0 }, () => []);
    const agents = (world as unknown as { sides: { sim: { agents: Map<number, { id: number; lane: number; targetLane: number | null; lcState: string }> } }[] }).sides[0].sim.agents;
    const a = [...agents.values()][0];
    a.targetLane = a.lane === 0 ? 1 : a.lane - 1;
    a.lcState = 'signal';
    expect(world.ourBoxes().some((b) => b.phantom && b.id === a.id)).toBe(false);
    a.lcState = 'move';
    expect(world.ourBoxes().some((b) => b.phantom && b.id === a.id)).toBe(true);
  });
});

describe('TrafficWorld', () => {
  it('fills the road ahead of the focus on reset', () => {
    const { world } = makeWorld();
    world.reset({ sLead: 0, sTail: 0, vLead: 0, raceTime: 0 }, () => []);
    expect(world.npcs.size).toBeGreaterThan(5);
    for (const b of world.ourBoxes()) {
      expect(b.s).toBeGreaterThan(55);
      expect(b.s).toBeLessThan(705);
    }
  });

  it('keeps traffic near the tail even when the lead is far ahead', () => {
    const { physics, world } = makeWorld();
    world.reset({ sLead: 0, sTail: 0, vLead: 0, raceTime: 0 }, () => []);
    const near = [...world.ourBoxes()].filter((b) => b.s < 200).length;
    expect(near).toBeGreaterThan(0);
    const focus = { sLead: 800, sTail: 0, vLead: 60, raceTime: 10 };
    for (let i = 0; i < 120; i++) {
      world.stepAI(PHYSICS_DT, i * PHYSICS_DT, () => []);
      physics.step((a, b) => world.onNpcContact(a, b));
      world.afterPhysics();
      world.maintain(PHYSICS_DT, focus, () => []);
    }
    expect([...world.ourBoxes()].filter((b) => b.s < 260).length).toBeGreaterThan(0);
  });

  it('is repeatable for a seed', () => {
    const a = makeWorld(7);
    const b = makeWorld(7);
    a.world.reset({ sLead: 0, sTail: 0, vLead: 0, raceTime: 0 }, () => []);
    b.world.reset({ sLead: 0, sTail: 0, vLead: 0, raceTime: 0 }, () => []);
    expect(a.world.ourBoxes().map((x) => x.s)).toEqual(b.world.ourBoxes().map((x) => x.s));
  });
});
