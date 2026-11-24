// The police chase without drawing: the player's car driven by the AI, the rivals, the traffic and the police, as in
// the game's loop (src/game/game.ts fixedStep), to tune src/game/police.ts and POLICE_TUNING by.
//   SEEDS=7001,7002,7003 npx vitest run --config training/vitest.config.ts training/policeChase.train.ts
// Per race: when the player was first busted, how often, the rivals hit by a police car, the police cars lost (parked
// again), each state's share of their time, the player's time to the line.
import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { selfStateOf } from '../src/ai/driver';
import { PlannerDriver } from '../src/ai/plannerDriver';
import { mulberry32 } from '../src/ai/rng';
import type { TrafficBox } from '../src/ai/sensors';
import { KMH, PHYSICS_DT, RESET_SPEED, ROAD_LENGTH } from '../src/config';
import { closingSpeed } from '../src/game/contact';
import { Police, type PoliceState } from '../src/game/police';
import { bustAllowed, type Racer } from '../src/game/policeLogic';
import { bustTimeScale } from '../src/game/bustShow';
import { PLAYER_BOX_ID, type RaceView, Rivals } from '../src/game/rivals';
import { computeResetSpot } from '../src/game/reset';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { boxToFrame, OUR_FRAME } from '../src/road/frame';
import { TrafficWorld, TRAFFIC_PLAN_EVERY } from '../src/sim/trafficWorld';
import { PLAYER_L, PLAYER_W, PlayerCar } from '../src/vehicles/playerCar';

/** The race's time a bust's slow motion takes (its 3 s of real time, slowed: bustTimeScale). */
const BUST_RACE_TIME = Array.from({ length: 300 }, (_, i) => bustTimeScale((i + 0.5) / 100) / 100).reduce((a, b) => a + b, 0);

function race(seed: number) {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const traffic = new TrafficWorld(physics, mulberry32(seed), { oncoming: false, planEvery: TRAFFIC_PLAN_EVERY });
  const player = new PlayerCar(physics, null, { entity: { type: 'player' } });
  player.params.maxSpeed = 300 * KMH;
  player.resetTo(-3, 1, 0);
  const playerAi = new PlannerDriver();
  const rivals = new Rivals(physics, null, () => null);
  const police = new Police(physics, null, () => null);
  const playerObstacle = (frame = OUR_FRAME) => {
    const t = player.body.translation();
    const v = player.body.linvel();
    const f = OUR_FRAME.forwardWorld(player.yaw, player.s);
    return { ...boxToFrame(frame, { x: t.x, z: t.z, fx: f.x, fz: f.z, w: PLAYER_W, l: PLAYER_L, vx: v.x, vz: v.z }), id: PLAYER_BOX_ID, isPlayer: true };
  };
  let time = 0;
  const focus = () => {
    const all = [player.s, ...rivals.list.map((r) => r.car.s)];
    return { sLead: Math.max(...all), sTail: Math.min(...all), vLead: player.speed, raceTime: time };
  };
  const occupants = (f: typeof OUR_FRAME) => [...rivals.occupants(f), ...police.occupants(f)];
  traffic.reset(focus(), occupants);
  const stats = { busts: [] as number[], rivalHits: 0, lost: 0, finish: null as number | null, share: { parked: 0, front: 0, behind: 0, pullover: 0 } as Record<PoliceState, number>, ram: 0 };
  let bustLeft = 0;
  let putBackAt = -Infinity;
  const was = police.list.map((p) => p.state);
  const step = () => {
    const boxes = traffic.ourBoxes();
    const view: RaceView = { player, traffic: boxes, speedCap: 300 * KMH, raceTime: time, police: police.boxes() };
    rivals.drive(PHYSICS_DT, view);
    const racers: Racer[] = [{ s: player.s, d: player.d, v: Math.max(0, player.speed), isPlayer: true }, ...rivals.list.map((r) => ({ s: r.car.s, d: r.car.d, v: Math.max(0, r.car.speed), isPlayer: false }))];
    const racerBoxes: TrafficBox[] = [{ ...player.footprint(), id: PLAYER_BOX_ID, v: Math.max(0, player.speed) }, ...rivals.boxes()];
    police.drive(PHYSICS_DT, racers, racerBoxes, boxes);
    const input = bustLeft > 0 ? { throttle: 0, brake: 0, steer: 0 } : playerAi.drive(selfStateOf(player, 300 * KMH), [...boxes, ...rivals.boxes(), ...police.boxes()], player.params);
    player.prePhysics(input, PHYSICS_DT);
    traffic.stepAI(PHYSICS_DT, time, (frame) => [playerObstacle(frame), ...rivals.obstacles(frame), ...police.obstacles(frame)]);
    const pv0 = player.body.linvel();
    const pv = { x: pv0.x, z: pv0.z };
    const sv = police.list.map((p) => {
      const v = p.car.body.linvel();
      return { x: v.x, z: v.z };
    });
    physics.step((a, b, n) => {
      const cop = a.type === 'police' ? a : b.type === 'police' ? b : null;
      if (cop) {
        const other = a === cop ? b : a;
        if (other.type === 'player' && bustLeft <= 0 && bustAllowed('racing', closingSpeed(pv, sv[cop.id], n) * 3.6, time - putBackAt)) {
          stats.busts.push(+time.toFixed(1));
          bustLeft = BUST_RACE_TIME;
          police.pullOver(cop.id);
        } else if (other.type === 'rival') stats.rivalHits++;
      }
      const npc = traffic.onNpcContact(a, b);
      if (npc !== null) traffic.wreck(npc);
    });
    player.postPhysics();
    police.after();
    traffic.afterPhysics();
    time += PHYSICS_DT;
    rivals.after(PHYSICS_DT, view, traffic.ourBoxes());
    traffic.maintain(PHYSICS_DT, focus(), occupants);
    if (bustLeft > 0) {
      bustLeft -= PHYSICS_DT;
      if (bustLeft <= 0) {
        const spot = computeResetSpot(player.s, player.d, [...rivals.boxes(), ...police.blockers()], RESET_SPEED);
        player.resetTo(spot.s, spot.lane, RESET_SPEED);
        playerAi.reset();
        putBackAt = time;
      }
    }
    police.list.forEach((p, i) => {
      stats.share[p.state] += PHYSICS_DT;
      if (p.ramming) stats.ram += PHYSICS_DT;
      if (p.state === 'parked' && was[i] !== 'parked') stats.lost++;
      was[i] = p.state;
    });
    if (stats.finish === null && player.lead >= ROAD_LENGTH) stats.finish = time;
  };
  return { physics, step, stats, time: () => time, done: () => stats.finish !== null || time > 150 };
}

it('police chase', () => {
  return RAPIER.init().then(() => {
    for (const seed of (process.env.SEEDS ?? '7001').split(',').map(Number)) {
      const r = race(seed);
      while (!r.done()) r.step();
      const s = r.stats;
      const all = Object.values(s.share).reduce((a, b) => a + b, 0);
      const share = Object.entries(s.share).map(([k, v]) => `${k} ${((100 * v) / all).toFixed(0)}%`).join(', ');
      console.log(
        `seed ${seed}: busted ${s.busts.length}x (at ${s.busts.join(', ') || '-'} s), rivals hit ${s.rivalHits}, lost ${s.lost}, ` +
          `ramming ${s.ram.toFixed(1)} s, ${share}, finish ${s.finish?.toFixed(1) ?? '-'} s`,
      );
      r.physics.free();
    }
  });
}, 3_600_000);
