import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { trackerFrom } from '../src/ai/netTracker';
import RAPIER from '@dimforge/rapier3d-compat';
import { selfStateOf } from '../src/ai/driver';
import { DRIVER_TUNING, PlannerDriver } from '../src/ai/plannerDriver';
import { planAt } from '../src/ai/planner';
import { mulberry32 } from '../src/ai/rng';
import { KMH, PHYSICS_DT } from '../src/config';
import { PLAYER_BOX_ID, RaceView, Rivals } from '../src/game/rivals';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { OUR_FRAME, boxToFrame } from '../src/road/frame';
import { laneCenter } from '../src/road/coords';
import { TrafficWorld } from '../src/sim/trafficWorld';
import { PLAYER_L, PLAYER_W, PlayerCar } from '../src/vehicles/playerCar';

/**
 * The race start as in the game (rivalsRace.train.ts's loop): COUNTDOWN s held on the grid revving, then racing;
 * every 0.5 s each car's sideways position off its grid lane's centre, heading, and where its plan has it 1 / 2 s on.
 *   EVAL_SEEDS=7001,7002 npx vitest run --config training/vitest.config.ts training/startRivals.train.ts
 */
it('start: who pulls which way', async () => {
  await RAPIER.init();
  if (process.env.NET_TRACKER) DRIVER_TUNING.netTracker = process.env.NET_TRACKER !== '0'; // 0: the plain tracker
  const out: string[] = [];
  for (const seed of (process.env.EVAL_SEEDS ?? '7001,7002,7003').split(',').map(Number)) {
    const physics = PhysicsWorld.createSync();
    physics.timestep = PHYSICS_DT;
    const traffic = new TrafficWorld(physics, mulberry32(seed), { oncoming: false });
    const player = new PlayerCar(physics, null, { entity: { type: 'player' } });
    player.params.maxSpeed = 300 * KMH;
    player.resetTo(-3, 1, 0);
    const playerAi = new PlannerDriver();
    const rivals = new Rivals(physics, null, () => null);
    // TRACKER_JSON=<archive.json>: every car steered by that network instead (training/out/tracker).
    if (process.env.TRACKER_JSON) {
      const net = () => trackerFrom(JSON.parse(readFileSync(process.env.TRACKER_JSON!, 'utf8')).weights);
      for (const r of rivals.list) r.driver.tracker = net();
      playerAi.tracker = net();
    }
    const playerObstacle = (frame = OUR_FRAME) => {
      const t = player.body.translation();
      const v = player.body.linvel();
      const f = OUR_FRAME.forwardWorld(player.yaw);
      return { ...boxToFrame(frame, { x: t.x, z: t.z, fx: f.x, fz: f.z, w: PLAYER_W, l: PLAYER_L, vx: v.x, vz: v.z }), id: PLAYER_BOX_ID, isPlayer: true };
    };
    let time = 0;
    const steers: string[] = [];
    const focus = () => {
      const all = [player.s, ...rivals.list.map((r) => r.car.s)];
      return { sLead: Math.max(...all), sTail: Math.min(...all), vLead: player.speed, raceTime: time };
    };
    traffic.reset(focus(), (f) => rivals.occupants(f));
    const lanes = rivals.list.map((r) => Math.round(r.car.d / 3.75 + 1.5));
    const step = (racing: boolean) => {
      const boxes = traffic.ourBoxes();
      const view: RaceView = { player, traffic: boxes, speedCap: 300 * KMH, raceTime: time };
      if (racing) rivals.drive(PHYSICS_DT, view);
      else rivals.hold(PHYSICS_DT, true);
      if (racing && time < 2.5 && Math.round(time / PHYSICS_DT) % 12 === 0) steers.push(`${time.toFixed(1)}:${rivals.list[0].car.wheel.toFixed(2)}`);
      player.holdInPlace(!racing);
      player.prePhysics(racing ? playerAi.drive(selfStateOf(player, 300 * KMH), [...boxes, ...rivals.boxes()], player.params) : { throttle: 1, brake: 1, steer: 0 }, PHYSICS_DT);
      if (racing) traffic.stepAI(PHYSICS_DT, time, (frame) => [playerObstacle(frame), ...rivals.obstacles(frame)]);
      physics.step(() => {});
      player.postPhysics();
      traffic.afterPhysics();
      if (racing) time += PHYSICS_DT;
      rivals.after(PHYSICS_DT, view, traffic.ourBoxes());
      traffic.maintain(PHYSICS_DT, focus(), (f) => rivals.occupants(f));
    };
    for (let i = 0; i < Number(process.env.COUNTDOWN ?? 3) / PHYSICS_DT; i++) step(false);
    out.push(`seed ${seed} (grid lanes ${lanes.join(' ')}; - is left)`);
    const row = (name: string, car: PlayerCar, lane: number, drv: PlannerDriver) => {
      const p = drv.plan;
      const ahead = (s: number) => (p ? (planAt(p, drv.planAge + s).d - laneCenter(lane)).toFixed(2) : '-');
      return `${name} ${(car.d - laneCenter(lane)).toFixed(2)}/${(car.yaw * 57.3).toFixed(1)}° plan ${ahead(1)},${ahead(2)}`;
    };
    for (let k = 0; k <= 12; k++) {
      if (k > 0) for (let i = 0; i < 0.5 / PHYSICS_DT; i++) step(true);
      out.push(`  ${time.toFixed(1)} s ${(rivals.list[0].car.speed * 3.6).toFixed(0)} km/h | ` + rivals.list.map((r, i) => row(`R${i}`, r.car, lanes[i], r.driver)).join(' | ') + ' | ' + row('P', player, 1, playerAi));
    }
    out.push(`  R0 steering (time:steer, + right) ${steers.join(' ')}`);
    physics.free();
  }
  process.stdout.write(out.join('\n') + '\n');
}, 600_000);
