// A police car guarding the road ahead (front) as the player comes up behind it in its lane and pulls out to pass it -
// no traffic: how soon it moves over (its reaction), and whether the player gets by or runs into it.
//   npx vitest run --config training/vitest.config.ts training/policeBlock.train.ts
// Per case (the player's speed over the police car's, how far behind it they pull out, to which side): the police car's
// reaction (s from the player's pull-out till it has moved 0.3 m their way; - none), and the outcome (passed / hit).
import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { selfStateOf, speedPedals } from '../src/ai/driver';
import type { TrafficBox } from '../src/ai/sensors';
import { KMH, PHYSICS_DT } from '../src/config';
import { Police } from '../src/game/police';
import { BLOCK, ramInput, type Racer } from '../src/game/policeLogic';
import { PLAYER_BOX_ID } from '../src/game/rivals';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { laneCenter } from '../src/road/coords';
import { PlayerCar } from '../src/vehicles/playerCar';

// (LOOK=s: BLOCK.look tried)
if (process.env.LOOK) BLOCK.look = Number(process.env.LOOK);
if (process.env.WITHIN) BLOCK.within = Number(process.env.WITHIN);

const PLAYER_V = 200 * KMH;
const START = 3000;
const LANE = 1;

function run(closingKmh0: number, gap: number, side: -1 | 1) {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const player = new PlayerCar(physics, null, { entity: { type: 'player' } });
  player.params.maxSpeed = 300 * KMH;
  const police = new Police(physics, null, () => null);
  police.triggered = true;
  const cop = police.list[0];
  const copV = PLAYER_V - closingKmh0 * KMH;
  // (settled in its lane first: 1.5 s before the player pulls out)
  const lead = gap + closingKmh0 * KMH * 1.5 + (player.length + cop.car.length) / 2;
  cop.car.resetAt(START + lead, laneCenter(LANE), copV);
  cop.car.holdInPlace(false);
  cop.state = 'front';
  cop.driver.shoulder = true;
  player.resetAt(START, laneCenter(LANE), PLAYER_V);
  let time = 0;
  let pulledAt: number | null = null;
  let copDAt = 0;
  let reaction: number | null = null;
  let halfLane: number | null = null;
  let outcome = '-';
  let across = 0;
  let closingKmh = 0;
  let braked = false;
  const toD = laneCenter(LANE + side);
  let wantD = laneCenter(LANE);
  for (let i = 0; i < 12 / PHYSICS_DT && outcome === '-'; i++) {
    const behind = cop.car.s - player.s - (player.length + cop.car.length) / 2;
    if (pulledAt === null && behind <= gap) {
      pulledAt = time;
      copDAt = cop.car.d;
      wantD = toD;
    }
    const racers: Racer[] = [{ s: player.s, d: player.d, v: Math.max(0, player.speed), isPlayer: true, id: 0, yaw: player.yaw, vLat: player.vLat }];
    const racerBoxes: TrafficBox[] = [{ ...player.footprint(), id: PLAYER_BOX_ID, v: Math.max(0, player.speed) }];
    police.drive(PHYSICS_DT, racers, racerBoxes, []);
    // The player: holding its speed, a quick lane change (aimed 20 m on) once it pulls out.
    const self = selfStateOf(player, PLAYER_V);
    const steer = ramInput(self, { s: player.s + 20, d: wantD }, player.params).steer;
    player.prePhysics({ steer, ...speedPedals(PLAYER_V, player.vLong) }, PHYSICS_DT);
    physics.step((a, b) => {
      if (outcome === '-' && ((a.type === 'police' && b.type === 'player') || (a.type === 'player' && b.type === 'police'))) {
        outcome = 'hit';
        across = player.d - cop.car.d;
        closingKmh = (player.speed - cop.car.speed) * 3.6;
      }
    });
    player.postPhysics();
    police.after();
    if (cop.braking) braked = true;
    time += PHYSICS_DT;
    if (pulledAt !== null && reaction === null && (cop.car.d - copDAt) * side >= 0.3) reaction = time - pulledAt;
    if (pulledAt !== null && halfLane === null && (cop.car.d - copDAt) * side >= 1.875) halfLane = time - pulledAt;
    if (outcome === '-' && player.s - player.length / 2 > cop.car.s + cop.car.length / 2) outcome = 'passed';
  }
  physics.free();
  return { reaction, halfLane, outcome, across, closing: closingKmh, braked, reach: gap / (closingKmh0 * KMH) };
}

it('police block', () => {
  return RAPIER.init().then(() => {
    const f = (x: number | null) => (x === null ? '  -  ' : x.toFixed(2));
    for (const closing of [20, 60, 100]) {
      for (const gap of [10, 20, 35, 50]) {
        for (const side of [-1, 1] as const) {
          const r = run(closing, gap, side);
          process.stdout.write(
            `closing ${String(closing).padStart(3)} km/h, out ${String(gap).padStart(2)} m behind (${r.reach.toFixed(1)} s), ${side < 0 ? 'left ' : 'right'}: ` +
              `moves 0.3 m ${f(r.reaction)} s, half a lane ${f(r.halfLane)} s, ${r.outcome}${r.outcome === 'hit' ? ` (${r.across.toFixed(1)} m across, closing ${r.closing.toFixed(0)} km/h${r.closing >= 45 ? ' BUST' : ''})` : ''}${r.braked ? ', brake-checked' : ''}\n`,
          );
        }
      }
    }
  });
}, 600_000);
