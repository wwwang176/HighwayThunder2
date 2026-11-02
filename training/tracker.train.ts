import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { writeFileSync } from 'node:fs';
import { KMH, LANE_COUNT, LANE_WIDTH, PHYSICS_DT } from '../src/config';
import { laneCenter } from '../src/road/coords';
import { PlayerCar } from '../src/vehicles/playerCar';
import { STREET_RACER } from '../src/vehicles/cars';
import type { Brain } from '../src/ai/brain';
import { selfStateOf } from '../src/ai/driver';
import { DEFAULT_EVO, nextGeneration } from '../src/ai/evolution';
import { baseSteer, netSteer, quietTracker, trackerFrom } from '../src/ai/netTracker';
import { lateralTurn, Plan, PLANNER } from '../src/ai/planner';
import { planPedals } from '../src/ai/plannerDriver';
import { mulberry32, Rng } from '../src/ai/rng';
import { openGround } from './openGround';

/**
 * Trains a car type's steering network (src/ai/netTracker.ts) by neuroevolution: a population of
 * cars on open ground, each following plans shaped like the planner's (physics-limited sideways
 * moves to random targets - lane centres and gaps between - replanned every 0.25 s from where the
 * car is, as in a race). Every car of a generation gets the same targets; the plain tracker drives
 * them too, for comparison. Score: squared distance off the plan, a little for jerking the wheel,
 * and spinning out is the end.
 *   GENS=60 POP=40 SAVE=1 npx vitest run --config training/vitest.config.ts training/tracker.train.ts
 * (PLANNER_JSON as the benchmark; SAVE=1 writes src/vehicles/cars/streetRacerTracker.ts.)
 */

const SCENARIO_S = 8; // s each
const PER_GEN = Number(process.env.SCENARIOS ?? 4);
const VALIDATION = 8;
const CHATTER = 0.002; // cost per unit of wheel input change per step
const SPIN_SLIP = 0.35; // rad of body slip (cornering.train.ts) or...
const SPIN_YAW = 0.7; // ...heading off the road: spun

interface Scenario {
  v: number;
  /** [time, lateral target] */
  targets: [number, number][];
}

function scenario(rng: Rng): Scenario {
  const v = (60 + rng() * 240) * KMH;
  const targets: [number, number][] = [];
  const lo = laneCenter(0);
  const hi = laneCenter(LANE_COUNT - 1);
  for (let t = 0; t < SCENARIO_S; t += 0.6 + rng() * 1.9) {
    // Lane centres mostly; else anywhere on the eighth-lane grid (a gap between two cars).
    const d = rng() < 0.6 ? laneCenter(Math.floor(rng() * LANE_COUNT)) : lo + Math.round((rng() * (hi - lo)) / (LANE_WIDTH / 8)) * (LANE_WIDTH / 8);
    targets.push([t, d]);
  }
  return { v, targets };
}

const targetAt = (sc: Scenario, t: number) => {
  let d = sc.targets[0][1];
  for (const [at, x] of sc.targets) if (at <= t) d = x;
  return d;
};

/**
 * A plan from (s, d, vD) at speed v toward lateral `target` the way the planner moves: whole cells
 * a step, the change in sideways move each step within what the car's grip allows (`lateralTurn`),
 * as fast as it can while still able to stop on the target.
 */
export function movePlan(s: number, d: number, vD: number, v: number, target: number): Plan {
  const dt = PLANNER.step;
  const cell = LANE_WIDTH / PLANNER.cellsPerLane;
  const turn = Math.min(lateralTurn(v, dt, cell), 6);
  const maxLat = PLANNER.maxLateral;
  let lat = Math.max(-maxLat, Math.min(maxLat, (vD * dt) / cell));
  const first = laneCenter(0) - 2 * cell * PLANNER.cellsPerLane; // any cell boundary works: positions are relative
  let c = Math.round((d - first) / cell);
  const goal = Math.round((target - first) / cell);
  // Cells still covered while slowing from `m` a step to a stop.
  const stopping = (m: number) => {
    let sum = 0;
    for (let x = Math.abs(m) - turn; x > 0; x -= turn) sum += x;
    return sum;
  };
  const points = [{ t: 0, s, d, v }];
  for (let k = 1; k <= Math.round(3 / dt); k++) {
    const rest = goal - c;
    let best = NaN;
    for (let m = Math.ceil(lat - turn - 0.01); m <= Math.floor(lat + turn + 0.01); m++) {
      if (Math.abs(m) > maxLat) continue;
      // Toward the goal as fast as it can without passing it (counting the cells it takes to stop).
      const reach = m + Math.sign(m) * stopping(m);
      const ok = rest >= 0 ? reach <= rest : reach >= rest;
      if (ok && (Number.isNaN(best) || (rest >= 0 ? m > best : m < best))) best = m;
    }
    // Nothing stops in time: brake sideways as hard as it may.
    if (Number.isNaN(best)) best = rest >= 0 ? Math.max(-maxLat, Math.ceil(lat - turn - 0.01)) : Math.min(maxLat, Math.floor(lat + turn + 0.01));
    c += best;
    lat = best;
    points.push({ t: k * dt, s: s + v * k * dt, d: first + c * cell, v });
  }
  return { points };
}

interface Run {
  car: PlayerCar;
  brain: Brain | null; // null: the plain tracker
  plan: Plan | null;
  madeAt: number;
  cost: number;
  out: boolean;
  lastSteer: number;
  errs: number[];
}

/** Every brain (and the plain tracker, last) through the scenarios together; cost per brain, and the runs' errors. */
function evaluate(brains: (Brain | null)[], scenarios: Scenario[], keepErrors = false): { cost: number[]; errs: number[][] } {
  const physics = openGround();
  physics.timestep = PHYSICS_DT;
  const runs: Run[] = brains.map((brain) => ({ car: new PlayerCar(physics, null), brain, plan: null, madeAt: 0, cost: 0, out: false, lastSteer: 0, errs: [] }));
  const cap = 310 * KMH;
  for (const r of runs) r.car.params.maxSpeed = cap;
  for (const sc of scenarios) {
    const lane = Math.floor(LANE_COUNT / 2);
    for (const r of runs) {
      r.car.body.setEnabled(true);
      r.car.resetTo(0, lane, sc.v);
      r.plan = null;
      r.out = false;
      r.lastSteer = 0;
    }
    const steps = Math.round(SCENARIO_S / PHYSICS_DT);
    for (let i = 0; i < steps; i++) {
      const t = i * PHYSICS_DT;
      for (const r of runs) {
        if (r.out) continue;
        const self = selfStateOf(r.car, cap);
        if (!r.plan || t - r.madeAt >= 0.25 - 1e-9) {
          const vD = self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw);
          r.plan = movePlan(self.s, self.d, vD, sc.v, targetAt(sc, t));
          r.madeAt = t;
        }
        const age = t - r.madeAt;
        const steer = r.brain ? netSteer(r.brain, r.plan, age, self, r.car.params) : baseSteer(r.plan, age, self, r.car.params);
        const pedals = planPedals(r.plan, age, self.vLong);
        r.car.prePhysics({ steer, ...pedals }, PHYSICS_DT);
        r.cost += CHATTER * Math.abs(steer - r.lastSteer);
        r.lastSteer = steer;
      }
      physics.step(() => {});
      for (const r of runs) {
        if (r.out) continue;
        r.car.postPhysics();
        const age = t + PHYSICS_DT - r.madeAt;
        const pts = r.plan!.points;
        // Off the plan now (linear between its points).
        const k = Math.min(pts.length - 2, Math.floor(age / PLANNER.step));
        const u = Math.min(1, (age - pts[k].t) / (pts[k + 1].t - pts[k].t));
        const err = r.car.d - (pts[k].d + (pts[k + 1].d - pts[k].d) * u);
        r.cost += err * err * PHYSICS_DT;
        if (keepErrors) r.errs.push(err);
        const slip = Math.abs(Math.atan2(r.car.vLat, Math.max(1, r.car.vLong)));
        if (slip > SPIN_SLIP || Math.abs(r.car.yaw) > SPIN_YAW) {
          r.out = true;
          r.cost += 10 * (SCENARIO_S - t); // spun: the worst of all
          r.car.body.setEnabled(false);
        }
      }
    }
  }
  physics.free();
  return { cost: runs.map((r) => r.cost / scenarios.length), errs: runs.map((r) => r.errs) };
}

const pct = (xs: number[], p: number) => {
  const a = xs.map(Math.abs).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? NaN;
};
const describe = (errs: number[]) =>
  `rms ${Math.sqrt(errs.reduce((s, x) => s + x * x, 0) / errs.length).toFixed(3)} m, p95 ${pct(errs, 0.95).toFixed(2)}, max ${pct(errs, 1).toFixed(2)}`;

it('tracker', async () => {
  await RAPIER.init();
  Object.assign(PLANNER, { step: 0.25, cellsPerLane: 8, maxLateral: 6, latGrip: 1 });
  if (process.env.PLANNER_JSON) Object.assign(PLANNER, JSON.parse(process.env.PLANNER_JSON));
  const gens = Number(process.env.GENS ?? 40);
  const evo = { ...DEFAULT_EVO, population: Number(process.env.POP ?? 40), sigma: Number(process.env.SIGMA ?? 0.1) };
  const rng = mulberry32(Number(process.env.SEED ?? 1));
  const valRng = mulberry32(99);
  const validation = Array.from({ length: VALIDATION }, () => scenario(valRng));
  // From the car's current network if it has one (CONTINUE=1), else quiet ones (the plain tracker).
  const start = process.env.CONTINUE ? trackerFrom(STREET_RACER.ai.tracker) : null;
  let pop: Brain[] = Array.from({ length: evo.population }, (_, i) => (start && i === 0 ? start : quietTracker(rng)));
  const base = evaluate([null], validation, true);
  process.stdout.write(`plain tracker on validation: cost ${base.cost[0].toFixed(4)}, ${describe(base.errs[0])}\n`);
  let best: { brain: Brain; cost: number } | null = null;
  const t0 = performance.now();
  for (let g = 0; g < gens; g++) {
    const scenarios = Array.from({ length: PER_GEN }, () => scenario(rng));
    const { cost } = evaluate([...pop, null], scenarios);
    const plain = cost.pop()!;
    const order = cost.map((c, i) => i).sort((a, b) => cost[a] - cost[b]);
    let line = `gen ${g}: best ${cost[order[0]].toFixed(4)}, median ${cost[order[Math.floor(order.length / 2)]].toFixed(4)}, plain ${plain.toFixed(4)}`;
    if (g % 5 === 4 || g === gens - 1) {
      const v = evaluate([pop[order[0]]], validation, true);
      line += ` | validation ${v.cost[0].toFixed(4)} (${describe(v.errs[0])})`;
      if (!best || v.cost[0] < best.cost) {
        best = { brain: pop[order[0]], cost: v.cost[0] };
        if (process.env.SAVE) save(best.brain, best.cost, base.cost[0]); // stopping it any time keeps the best so far
        line += ' saved';
      }
    }
    process.stdout.write(`${line}  [${((performance.now() - t0) / 1000).toFixed(0)} s]\n`);
    pop = nextGeneration(pop, cost.map((c) => -c), rng, evo);
  }
  if (best) process.stdout.write(`best on validation: ${best.cost.toFixed(4)} (plain ${base.cost[0].toFixed(4)})\n`);
});

function save(b: Brain, cost: number, plain: number): void {
  const w = Array.from(b.weights, (x) => Math.round(x * 1e5) / 1e5);
  writeFileSync(
    new URL('../src/vehicles/cars/streetRacerTracker.ts', import.meta.url),
    `// Trained by training/tracker.train.ts (validation cost ${cost.toFixed(4)}, plain tracker ${plain.toFixed(4)}).\n` +
      `export const STREET_RACER_TRACKER: number[] = ${JSON.stringify(w)};\n`,
  );
}
