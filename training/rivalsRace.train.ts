import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { selfStateOf } from '../src/ai/driver';
import { PlannerDriver } from '../src/ai/plannerDriver';
import { mulberry32 } from '../src/ai/rng';
import { KMH, PHYSICS_DT } from '../src/config';
import { PLAYER_BOX_ID, RaceView, RIVAL_TUNING, Rivals } from '../src/game/rivals';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { OUR_FRAME, boxToFrame } from '../src/road/frame';
import { TrafficWorld } from '../src/sim/trafficWorld';
import { PLAYER_L, PLAYER_W, PlayerCar } from '../src/vehicles/playerCar';
import { WheelInstances } from '../src/vehicles/wheelInstances';

beforeAll(async () => {
  await RAPIER.init();
});

/** The game's loop without drawing: the player (driven by the AI too), 5 rivals, traffic that sees them all. */
function race(seed: number) {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const scene = new THREE.Scene();
  const traffic = new TrafficWorld(physics, scene, new WheelInstances(scene), mulberry32(seed), { oncoming: false });
  const player = new PlayerCar(physics, null, { entity: { type: 'player' } });
  player.params.maxSpeed = 300 * KMH;
  player.resetTo(-3, 1, 0);
  const playerAi = new PlannerDriver();
  const rivals = new Rivals(physics, null, () => null);
  const playerObstacle = (frame = OUR_FRAME) => {
    const t = player.body.translation();
    const v = player.body.linvel();
    const f = OUR_FRAME.forwardWorld(player.yaw);
    return { ...boxToFrame(frame, { x: t.x, z: t.z, fx: f.x, fz: f.z, w: PLAYER_W, l: PLAYER_L, vx: v.x, vz: v.z }), id: PLAYER_BOX_ID, isPlayer: true };
  };
  const focus = () => {
    const all = [player.s, ...rivals.list.map((r) => r.car.s)];
    return { sLead: Math.max(...all), sTail: Math.min(...all), vLead: player.speed, raceTime: time };
  };
  let time = 0;
  traffic.reset(focus(), (f) => rivals.occupants(f));
  let contacts = 0;
  const step = () => {
    const boxes = traffic.ourBoxes();
    const view: RaceView = { player, traffic: boxes, speedCap: 300 * KMH, raceTime: time };
    rivals.drive(PHYSICS_DT, view);
    player.prePhysics(playerAi.drive(selfStateOf(player, 300 * KMH), [...boxes, ...rivals.boxes()], player.params), PHYSICS_DT);
    traffic.stepAI(PHYSICS_DT, time, (frame) => [playerObstacle(frame), ...rivals.obstacles(frame)]);
    physics.step((a, b) => {
      if (a.type !== 'static' && b.type !== 'static') contacts++;
      const npc = traffic.onNpcContact(a, b);
      if (npc !== null) traffic.wreck(npc);
    });
    player.postPhysics();
    traffic.afterPhysics();
    time += PHYSICS_DT;
    rivals.after(PHYSICS_DT, view, traffic.ourBoxes());
    traffic.maintain(PHYSICS_DT, focus(), (f) => rivals.occupants(f));
  };
  return { physics, player, rivals, step, contacts: () => contacts, time: () => time };
}

describe('rivals racing (headless)', () => {
  it('all five get going and race along with the player', () => {
    const r = race(7001);
    for (let i = 0; i < 15 / PHYSICS_DT; i++) r.step();
    expect(r.rivals.list).toHaveLength(RIVAL_TUNING.count);
    for (const rv of r.rivals.list) {
      expect(rv.car.s).toBeGreaterThan(300);
      expect(rv.resets).toBeLessThanOrEqual(2);
    }
    expect(r.player.s).toBeGreaterThan(300);
    r.physics.free();
  }, 60_000); // six cars planning: ~13 s

  it('one left far behind is put back into the race on the player\'s tail', () => {
    const r = race(7002);
    for (let i = 0; i < 2 / PHYSICS_DT; i++) r.step();
    r.player.resetTo(2000, 1, 150 * KMH); // the player is suddenly 2 km ahead
    for (let i = 0; i < 0.5 / PHYSICS_DT; i++) r.step();
    for (const rv of r.rivals.list) {
      expect(rv.resets).toBeGreaterThanOrEqual(1);
      expect(r.player.s - rv.car.s).toBeLessThan(RIVAL_TUNING.teleportBehind);
    }
    r.physics.free();
  }, 60_000);
});
