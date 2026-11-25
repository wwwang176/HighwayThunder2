// The police chase without drawing: the player's car driven by the AI, the rivals, the traffic and the police, as in
// the game's loop (src/game/game.ts fixedStep), to tune src/game/police.ts and POLICE_TUNING by.
//   SEEDS=7001,7002,7003 npx vitest run --config training/vitest.config.ts training/policeChase.train.ts
// Per race: when the player was first busted, how often, the rivals hit by a police car (closing as a bust would), the police cars lost (parked
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
import { BLOCK, bustAllowed, POLICE_TUNING, type Racer } from '../src/game/policeLogic';
import { bustTimeScale } from '../src/game/bustShow';
import { PLAYER_BOX_ID, type RaceView, Rivals } from '../src/game/rivals';
import { computeResetSpot } from '../src/game/reset';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { boxToFrame, OUR_FRAME } from '../src/road/frame';
import { TrafficWorld, TRAFFIC_PLAN_EVERY } from '../src/sim/trafficWorld';
import { wakers } from '../src/traffic/wake';
import { PLAYER_L, PLAYER_W, PlayerCar } from '../src/vehicles/playerCar';

/** OLD=1: the police as before 2026-11-26 (no blocking; its target's line guessed without its heading). */
const OLD = process.env.OLD === '1';
if (OLD) BLOCK.within = 0;
/** WAKE=old / new: the traffic woken as the game does (before / since 2026-11-26); all (the default): every car awake. */
const WAKE_MODE = process.env.WAKE ?? 'all';

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
  const stats = { npcHits: { parked: 0, front: 0, behind: 0, pullover: 0 } as Record<PoliceState, number>, busts: [] as number[], rivalHits: 0, lost: 0, finish: null as number | null, share: { parked: 0, front: 0, behind: 0, pullover: 0 } as Record<PoliceState, number>, ram: 0, block: 0, brakeCheck: 0, npcBlocking: 0, awake: 0, into: { player: 0, rival: 0, police: 0 } };
  let bustLeft = 0;
  let putBackAt = -Infinity;
  const was = police.list.map((p) => p.state);
  const step = () => {
    const boxes = traffic.ourBoxes();
    const view: RaceView = { player, traffic: boxes, speedCap: 300 * KMH, raceTime: time, police: police.boxes() };
    rivals.drive(PHYSICS_DT, view);
    // (the player as a person drives: its line guessed, not its AI's plan; OLD=1: without its heading - as before 2026-11-26)
    const turn = (c: PlayerCar) => (OLD ? {} : { yaw: c.yaw, vLat: c.vLat });
    const racers: Racer[] = [
      { s: player.s, d: player.d, v: Math.max(0, player.speed), isPlayer: true, id: 0, ...turn(player) },
      ...rivals.list.map((r) => ({ s: r.car.s, d: r.car.d, v: Math.max(0, r.car.speed), isPlayer: false, id: 1 + r.index, plan: r.driver instanceof PlannerDriver ? r.driver.plan : null, ...turn(r.car) })),
    ];
    const racerBoxes: TrafficBox[] = [{ ...player.footprint(), id: PLAYER_BOX_ID, v: Math.max(0, player.speed) }, ...rivals.boxes()];
    police.drive(PHYSICS_DT, racers, racerBoxes, boxes);
    const input = bustLeft > 0 ? { throttle: 0, brake: 0, steer: 0 } : playerAi.drive(selfStateOf(player, 300 * KMH), [...boxes, ...rivals.boxes(), ...police.boxes()], player.params);
    player.prePhysics(input, PHYSICS_DT);
    // Waking the traffic (WAKE=old / new: as the game - before / since 2026-11-26; all, the default: every car awake)
    if (WAKE_MODE === 'old') {
      const out = police.list.filter((p) => p.state !== 'parked');
      traffic.rouse([{ s: player.s, reach: 120 }, ...rivals.list.map((r) => ({ s: r.car.s, reach: 60 })), ...out.map((p) => ({ s: p.car.s, reach: 60 }))], [], time);
    } else if (WAKE_MODE === 'new') {
      const w = wakers(player, [...rivals.list.map((r) => r.car), ...police.list.filter((p) => p.state !== 'parked').map((p) => p.car)], 120);
      traffic.rouse(w.rousers, w.movers, time);
    }
    let awake = 0;
    for (const n of traffic.npcs.values()) if (!n.asleep) awake++;
    stats.awake += awake * PHYSICS_DT;
    traffic.stepAI(PHYSICS_DT, time, (frame) => [playerObstacle(frame), ...rivals.obstacles(frame), ...police.obstacles(frame)]);
    const pv0 = player.body.linvel();
    const pv = { x: pv0.x, z: pv0.z };
    const sv = police.list.map((p) => {
      const v = p.car.body.linvel();
      return { x: v.x, z: v.z };
    });
    const rv = rivals.list.map((r) => {
      const v = r.car.body.linvel();
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
        } else if (other.type === 'rival' && closingSpeed(rv[other.id], sv[cop.id], n) * 3.6 >= POLICE_TUNING.bustKmh) stats.rivalHits++; // (a hit, not a scrape)
      }
      const npc = traffic.onNpcContact(a, b);
      if (npc !== null && !traffic.npcs.get(npc)?.wrecked) {
        const by = a.type === 'npc' ? b.type : a.type;
        if (by === 'player' || by === 'rival' || by === 'police') stats.into[by]++;
      }
      if (npc !== null && cop && !traffic.npcs.get(npc)?.wrecked) {
        stats.npcHits[police.list[cop.id].state]++; // (a police car into the traffic, by what it was doing)
        if (police.list[cop.id].blocking) stats.npcBlocking++;
      }
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
      if (p.blocking) stats.block += PHYSICS_DT;
      if (p.braking) stats.brakeCheck += PHYSICS_DT;
      if (p.state === 'parked' && was[i] !== 'parked') stats.lost++;
      was[i] = p.state;
    });
    if (stats.finish === null && player.lead >= ROAD_LENGTH) stats.finish = time;
  };
  return { physics, step, stats, time: () => time, done: () => stats.finish !== null || time > 150, rivalsAt: () => rivals.list.map((r) => r.car.lead) };
}

it('police chase', () => {
  return RAPIER.init().then(() => {
    for (const seed of (process.env.SEEDS ?? '7001').split(',').map(Number)) {
      const r = race(seed);
      const t0 = performance.now();
      while (!r.done()) r.step();
      const wall = (performance.now() - t0) / 1000;
      const s = r.stats;
      const all = Object.values(s.share).reduce((a, b) => a + b, 0);
      const share = Object.entries(s.share).map(([k, v]) => `${k} ${((100 * v) / all).toFixed(0)}%`).join(', ');
      // (written out, not console.log: the runner keeps a passing test's console to itself)
      process.stdout.write(
        `seed ${seed}: busted ${s.busts.length}x (at ${s.busts.join(', ') || '-'} s), rivals hit ${s.rivalHits}, lost ${s.lost}, ` +
          `ramming ${s.ram.toFixed(1)} s, blocking ${s.block.toFixed(1)} s, brake checks ${s.brakeCheck.toFixed(1)} s,${share}, finish ${s.finish?.toFixed(1) ?? '-'} s; ` +
          `into traffic ${Object.entries(s.npcHits).map(([k, v]) => `${k} ${v}`).join(', ')} (blocking ${s.npcBlocking}); ` +
          `[wake ${WAKE_MODE}] traffic hit by the player ${s.into.player}, rivals ${s.into.rival}, police ${s.into.police}; ` +
          `awake ${(s.awake / r.time()).toFixed(1)} on average; rivals at ${r.rivalsAt().map((x) => x.toFixed(0)).join('/')} m; ${wall.toFixed(0)} s to run\n`,
      );
      r.physics.free();
    }
  });
}, 3_600_000);
