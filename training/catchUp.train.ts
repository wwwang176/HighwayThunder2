import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { selfStateOf } from '../src/ai/driver';
import { DRIVER_TUNING, PlannerDriver } from '../src/ai/plannerDriver';
import { mulberry32 } from '../src/ai/rng';
import { KMH, PHYSICS_DT, ROAD_LENGTH } from '../src/config';
import { PLAYER_BOX_ID, RaceView, RIVAL_TUNING, Rivals } from '../src/game/rivals';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { OUR_FRAME, boxToFrame } from '../src/road/frame';
import { TrafficWorld } from '../src/sim/trafficWorld';
import { CARS, STREET_RACER } from '../src/vehicles/cars';
import { PLAYER_L, PLAYER_W, PlayerCar } from '../src/vehicles/playerCar';

/**
 * How fast a rival catches the player up with the rubber band: the player (the supercar, driven by the AI) held at a
 * set speed in traffic, one rival `START` m behind it at the same speed, its nitro tank empty (as after racing a
 * while); the time until it is within `GOAL` m. The rubber band as:
 * - none: no help;
 * - old: engine and grip +60 %, top speed the difficulty's (topShare of its car's), nitro as ever;
 * - new: engine +60 %, grip +10 %, top speed up to its car's own, nitro used most eagerly (the tank never dry), all
 *   of it from 150 m behind (new300: from 300 m); through the traffic from 200 m behind, blind to it from 250 m
 *   (solid: neither) - its knocks into traffic counted, and those in the 10 s after it is solid again.
 * The player's speeds: one under the difficulty's top speed for the rival's car, one between that and its own.
 * Also: the share of the time the rival burns nitro by how far behind it is, how far past its top speed (the
 * limiter: maxSpeed) it went on nitro, its most lean, its resets (put back: that run's time not a catch-up).
 *   CARS=muscle-car SEEDS=7001,7002,7003 npx vitest run --config training/vitest.config.ts training/catchUp.train.ts
 */
const list = (k: string, d: string) => (process.env[k] ?? d).split(',');
const CAR_IDS = list('CARS', 'muscle-car');
const SEEDS = list('SEEDS', '7001,7002,7003').map(Number);
const MODES = list('MODES', 'none,old,new');
const SHARE = Number(process.env.SHARE ?? 0.9);
const START = Number(process.env.START ?? 300);
const GOAL = Number(process.env.GOAL ?? 100);
const DEG = 180 / Math.PI;
const RIGHT = new THREE.Vector3();
const QUAT = new THREE.Quaternion();

const NO_GHOST = { ghostFrom: Infinity, blindFrom: Infinity };
const GHOST = { ghostFrom: 200, blindFrom: 250 };
const KNOBS: Record<string, Pick<typeof RIVAL_TUNING, 'boostFull' | 'engineBoost' | 'gripBoost' | 'topLift' | 'nitroEager' | 'ghostFrom' | 'blindFrom'>> = {
  none: { boostFull: 300, engineBoost: 0, gripBoost: 0, topLift: 0, nitroEager: 0, ...NO_GHOST },
  old: { boostFull: 300, engineBoost: 0.6, gripBoost: 0.6, topLift: 0, nitroEager: 0, ...NO_GHOST },
  new300: { boostFull: 300, engineBoost: 0.6, gripBoost: 0.1, topLift: 1, nitroEager: 1, ...NO_GHOST },
  solid: { boostFull: 150, engineBoost: 0.6, gripBoost: 0.1, topLift: 1, nitroEager: 1, ...NO_GHOST },
  new: { boostFull: 150, engineBoost: 0.6, gripBoost: 0.1, topLift: 1, nitroEager: 1, ...GHOST },
};

function lean(car: PlayerCar): number {
  const q = car.body.rotation();
  RIGHT.set(1, 0, 0).applyQuaternion(QUAT.set(q.x, q.y, q.z, q.w));
  return Math.abs(Math.asin(Math.max(-1, Math.min(1, RIGHT.y)))) * DEG;
}

interface Run {
  time: number | null;
  gapEnd: number;
  resetAt: number | null;
  /** By 50 m bands behind (100-150 ... 250-300, 300+): [steps, steps burning]. */
  nitro: [number, number][];
  over: number;
  lean: number;
  vMax: number;
  /** Its contacts with traffic (NPCs, wrecks), and those within 10 s of being made solid again. */
  hits: number;
  hitsAfter: number;
  /** Times it was made solid again. */
  solidAgain: number;
  /** Blind / ghost (seeing) / solid: [m, s] driven; s x cars within 100 m of it. */
  pace: [number, number][];
  near: number[];
}

function run(seed: number, rivalId: string, kmh: number): Run {
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const traffic = new TrafficWorld(physics, mulberry32(seed), { oncoming: false });
  const player = new PlayerCar(physics, null, { spec: STREET_RACER, entity: { type: 'player' } });
  const v = kmh * KMH;
  player.params.maxSpeed = Math.min(player.params.maxSpeed, v);
  const playerAi = new PlannerDriver();
  const rivals = new Rivals(physics, null, () => null, [CARS[rivalId]]);
  const r = rivals.list[0];
  player.resetTo(400, 1, v);
  r.car.resetTo(400 - START, 2, v);
  r.car.nitro.level = 0;
  const playerObstacle = (frame = OUR_FRAME) => {
    const t = player.body.translation();
    const lv = player.body.linvel();
    const f = OUR_FRAME.forwardWorld(player.yaw, player.s);
    return { ...boxToFrame(frame, { x: t.x, z: t.z, fx: f.x, fz: f.z, w: PLAYER_W, l: PLAYER_L, vx: lv.x, vz: lv.z }), id: PLAYER_BOX_ID, isPlayer: true };
  };
  let time = 0;
  const focus = () => ({ sLead: Math.max(player.s, r.car.s), sTail: Math.min(player.s, r.car.s), vLead: player.speed, raceTime: time });
  traffic.reset(focus(), (f) => rivals.occupants(f));
  const out: Run = { time: null, gapEnd: 0, resetAt: null, nitro: Array.from({ length: 5 }, () => [0, 0]), over: 0, lean: 0, vMax: 0, hits: 0, hitsAfter: 0, solidAgain: 0, pace: [[0, 0], [0, 0], [0, 0]], near: [0, 0, 0] };
  let solidAt = -Infinity, wasGhost = false;
  while (player.s < ROAD_LENGTH - 200 && time < 90 && !(out.time !== null && time > out.time + 10)) {
    const boxes = traffic.ourBoxes();
    const view: RaceView = { player, traffic: boxes, speedCap: 300 * KMH, topShare: SHARE, raceTime: time };
    rivals.drive(PHYSICS_DT, view);
    player.prePhysics(playerAi.drive(selfStateOf(player, v), [...boxes, ...rivals.boxes()], player.params), PHYSICS_DT);
    traffic.stepAI(PHYSICS_DT, time, (frame) => [playerObstacle(frame), ...rivals.obstacles(frame)]);
    physics.step((a, b) => {
      if ((a.type === 'rival' && b.type === 'npc') || (a.type === 'npc' && b.type === 'rival')) {
        out.hits++;
        if (time - solidAt < 10) out.hitsAfter++;
      }
      const npc = traffic.onNpcContact(a, b);
      if (npc !== null) traffic.wreck(npc);
    });
    player.postPhysics();
    traffic.afterPhysics();
    time += PHYSICS_DT;
    rivals.after(PHYSICS_DT, view, traffic.ourBoxes());
    traffic.maintain(PHYSICS_DT, focus(), (f) => rivals.occupants(f));
    if (r.resets > 0 && out.resetAt === null) out.resetAt = time;
    if (wasGhost && !r.ghost) {
      solidAt = time;
      out.solidAgain++;
    }
    wasGhost = r.ghost;
    if (out.time === null) {
      const k = r.blind ? 0 : r.ghost ? 1 : 2;
      out.pace[k][0] += r.car.speed * PHYSICS_DT;
      out.pace[k][1] += PHYSICS_DT;
      out.near[k] += traffic.ourBoxes().filter((b) => Math.abs(b.s - r.car.s) < 100).length * PHYSICS_DT;
    }
    const gap = player.s - r.car.s;
    if (out.time !== null) continue; // (on 10 s past it: its knocks after being made solid again)
    if (gap > GOAL) {
      const band = Math.min(4, Math.max(0, Math.floor((gap - 100) / 50)));
      out.nitro[band][0]++;
      if (r.car.nitro.active) out.nitro[band][1]++;
    }
    if (r.car.nitro.active) out.over = Math.max(out.over, (r.car.speed - r.car.params.maxSpeed) / KMH);
    out.vMax = Math.max(out.vMax, r.car.speed / KMH);
    out.lean = Math.max(out.lean, lean(r.car));
    if (gap <= GOAL) out.time = time;
  }
  out.gapEnd = player.s - r.car.s;
  rivals.dispose();
  physics.free();
  return out;
}

it('catch-up', async () => {
  await RAPIER.init();
  DRIVER_TUNING.coursePlanner = true; // (the game's)
  const lines: string[] = [];
  for (const id of CAR_IDS) {
    const top = CARS[id].params.maxSpeed / KMH;
    const speeds = (process.env.SPEEDS ? list('SPEEDS', '').map(Number) : [SHARE * top - 15, (SHARE * top + top) / 2]).map(Math.round);
    lines.push(`\n== ${id} (top ${top.toFixed(0)}, the difficulty's ${(SHARE * top).toFixed(0)} km/h) - catching up ${START} -> ${GOAL} m`);
    for (const kmh of speeds) {
      for (const mode of MODES) {
        Object.assign(RIVAL_TUNING, KNOBS[mode]);
        const runs = SEEDS.map((s) => run(s, id, kmh));
        const each = runs.map((x) => (x.time !== null ? `${x.time.toFixed(1)} s` : `no (${x.gapEnd.toFixed(0)} m)`) + (x.resetAt !== null ? ` [reset ${x.resetAt.toFixed(1)} s]` : '')).join(', ');
        const duty = [0, 1, 2, 3, 4]
          .map((b) => {
            const [n, on] = runs.reduce((a, x) => [a[0] + x.nitro[b][0], a[1] + x.nitro[b][1]], [0, 0]);
            return n ? `${Math.round((100 * on) / n)}%` : '-';
          })
          .join(' / ');
        lines.push(
          `player ${kmh} km/h | ${mode.padEnd(4)} | ${each} | nitro by gap 100-150/150-200/200-250/250-300/300+: ${duty}` +
            ` | top ${Math.max(...runs.map((x) => x.vMax)).toFixed(0)} km/h, past its limiter on nitro ${Math.max(...runs.map((x) => x.over)).toFixed(1)} km/h | lean max ${Math.max(...runs.map((x) => x.lean)).toFixed(1)} deg` +
            ` | blind / ghost / solid: ${[0, 1, 2]
              .map((k) => {
                const [m, s] = runs.reduce((a, x) => [a[0] + x.pace[k][0], a[1] + x.pace[k][1]], [0, 0]);
                const n = runs.reduce((a, x) => a + x.near[k], 0);
                return s ? `${(m / s / KMH).toFixed(0)} km/h ${s.toFixed(0)} s (${(n / s).toFixed(1)} cars in 100 m)` : '-';
              })
              .join(' / ')}` +
            ` | knocks into traffic ${runs.map((x) => x.hits).join('/')}, within 10 s of solid again ${runs.map((x) => x.hitsAfter).join('/')} (solid again ${runs.map((x) => x.solidAgain).join('/')}x)`,
        );
        process.stdout.write(lines[lines.length - 1] + '\n');
      }
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
}, 24 * 3600_000);
