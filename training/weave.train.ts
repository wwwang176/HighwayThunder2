import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { plan, PLANNER } from '../src/ai/planner';
import { PlannerDriver } from '../src/ai/plannerDriver';
import type { TrafficBox } from '../src/ai/sensors';
import { TrainingSim } from '../src/ai/trainingSim';
import { KMH } from '../src/config';
import { laneAt, laneCenter } from '../src/road/coords';

/**
 * Where the car lifts before changing lanes in a real run: every drop of 15+ km/h followed by a lane
 * change within 2 s, with the traffic around it when the drop began.
 *   SEED=7001 npx vitest run --config training/vitest.config.ts training/weave.train.ts -t events
 */
it('events', async () => {
  if (process.env.PLANNER_JSON) Object.assign(PLANNER, JSON.parse(process.env.PLANNER_JSON));
  await RAPIER.init();
  const lines: string[] = [];
  let lost = 0;
  let count = 0;
  for (const seed of (process.env.SEED ?? '7001').split(',').map(Number)) {
    const sim = new TrainingSim([new PlannerDriver()], seed, { speedCap: 300 / 3.6, trafficSeesCars: true });
    const log: { t: number; s: number; d: number; v: number; cars: string }[] = [];
    let next = 0;
    while (!sim.done) {
      sim.step();
      if (sim.time < next) continue;
      next += 0.25;
      const c = sim.ghosts[0].car;
      const cars = sim.traffic
        .ourBoxes()
        .filter((b) => !b.phantom && b.s > c.s - 30 && b.s < c.s + 150)
        .sort((a, b) => a.s - b.s)
        .map((b) => `L${laneAt((b.dMin + b.dMax) / 2)}@${Math.round(b.s - c.s)}:${Math.round(b.v / KMH)}`)
        .join(' ');
      log.push({ t: sim.time, s: c.s, d: c.d, v: c.speed, cars });
    }
    const r = sim.ghosts[0].result;
    lines.push(`seed ${seed}: ${r.finishTime !== null ? `finish ${r.finishTime.toFixed(1)} s` : r.crashed ? 'crash' : 'timeout'}, contacts ${r.contacts}`);
    for (let i = 1; i < log.length; i++) {
      // A local top speed, then the lowest point before it picks up again.
      if (!(log[i].v >= log[i - 1].v && (log[i + 1]?.v ?? 0) < log[i].v)) continue;
      let j = i;
      while (j + 1 < log.length && log[j + 1].v <= log[j].v + 0.3) j++;
      const drop = (log[i].v - log[j].v) / KMH;
      if (drop < 15) continue;
      const lane0 = laneAt(log[i].d);
      const k = log.findIndex((x, n) => n > j - 4 && n <= j + 8 && laneAt(x.d) !== lane0);
      if (k < 0) continue;
      count++;
      lost += drop;
      lines.push(`  t=${log[i].t.toFixed(1)} ${Math.round(log[i].v / KMH)}->${Math.round(log[j].v / KMH)} km/h, L${lane0}->L${laneAt(log[k].d)} at t=${log[k].t.toFixed(1)} | ${log[i].cars}`);
    }
    sim.dispose();
  }
  lines.push(`${count} lifts before a lane change, ${Math.round(lost)} km/h shed in all`);
  process.stdout.write(lines.join('\n') + '\n');
});

const car = (s: number, lane: number, kmh: number): TrafficBox => ({ s, dMin: laneCenter(lane) - 0.925, dMax: laneCenter(lane) + 0.925, v: kmh * KMH, length: 4.5 });

/** Prints the plan for the user's sketch: a slow car ahead, the next lane's car further on (a slalom through). */
it('weave', () => {
  if (process.env.PLANNER_JSON) Object.assign(PLANNER, JSON.parse(process.env.PLANNER_JSON));
  const egoKmh = Number(process.env.EGO ?? 200);
  const aS = Number(process.env.A_S ?? 80);
  const bS = Number(process.env.B_S ?? 160);
  // Lane 2 blocked far ahead so the only way on is lane 1 -> lane 0 -> back to lane 1.
  const boxes = [car(aS, 1, 100), car(bS, 0, 100), ...[0, 1, 2, 3].map((k) => car(20 + k * 30, 2, 100)), ...[0, 1, 2, 3].map((k) => car(20 + k * 30, 3, 100))];
  // C_S: a car in lane 0 too, behind the slot (the side gap is then between it and B).
  if (process.env.C_S) boxes.push(car(Number(process.env.C_S), 0, 100));
  const p = plan({ s: 0, d: laneCenter(1), v: egoKmh * KMH, speedCap: 300 * KMH }, boxes);
  for (const x of p.points) {
    const a = boxes[0].s + boxes[0].v * x.t - x.s;
    const b = boxes[1].s + boxes[1].v * x.t - x.s;
    process.stdout.write(`t=${x.t.toFixed(1)} s=${x.s.toFixed(0)} d=${x.d.toFixed(2)} v=${(x.v / KMH).toFixed(0)}  A ahead ${a.toFixed(0)}  B ahead ${b.toFixed(0)}\n`);
  }
});

/** The last seconds before a run ends badly: the car and what was near it, every 0.1 s. SEED=7005 ... -t lastSeconds */
it('lastSeconds', async () => {
  if (process.env.PLANNER_JSON) Object.assign(PLANNER, JSON.parse(process.env.PLANNER_JSON));
  await RAPIER.init();
  const driver = new PlannerDriver();
  const sim = new TrainingSim([driver], Number(process.env.SEED ?? 7005), { speedCap: 300 / 3.6, trafficSeesCars: true });
  const log: string[] = [];
  let next = 0;
  let overrides = 0;
  while (!sim.done) {
    sim.step();
    if (sim.time < next) continue;
    next += 0.1;
    const c = sim.ghosts[0].car;
    const near = sim.traffic
      .ourBoxes()
      .filter((b) => !b.phantom && Math.abs(b.s - c.s) < 40)
      .map((b) => `[${(b.s - c.s).toFixed(1)} d${b.dMin.toFixed(2)}..${b.dMax.toFixed(2)} ${Math.round(b.v / KMH)}${b.id !== undefined && sim.traffic.ourBoxes().some((x) => x.phantom && x.id === b.id) ? ' merging' : ''}]`)
      .join(' ');
    const p = driver.plan?.points.slice(0, 4).map((x) => `${x.d.toFixed(2)}/${Math.round(x.v / KMH)}`).join(' ');
    log.push(`t=${sim.time.toFixed(1)} d=${c.d.toFixed(2)} yaw=${c.yaw.toFixed(3)} v=${Math.round(c.speed / KMH)} EB=${driver.overrides - overrides} plan ${p} | ${near}`);
    overrides = driver.overrides;
  }
  const r = sim.ghosts[0].result;
  process.stdout.write(`${r.crashed ? 'CRASH' : 'ok'} at ${Math.round(r.distance)} m\n${log.slice(-40).join('\n')}\n`);
  sim.dispose();
});

/**
 * The gap the user means: car A ahead in our lane, car B in the next lane on the left just behind it
 * (GAP m from A's tail to B's nose), both at 100 km/h, the right-hand lanes walled off. Does the plan
 * cut through between them (nose first), or sit behind A?
 *   GAP=4.4 EGO=140 npx vitest run --config training/vitest.config.ts training/weave.train.ts -t slot
 */
it('slot', () => {
  if (process.env.PLANNER_JSON) Object.assign(PLANNER, JSON.parse(process.env.PLANNER_JSON));
  const gap = Number(process.env.GAP ?? 4.4);
  const aS = Number(process.env.A_S ?? 40);
  const a = car(aS, 1, 100);
  const b = car(aS - 4.5 - gap, 0, 100);
  const wall = [2, 3].flatMap((lane) => [0, 1, 2, 3, 4, 5].map((k) => car(aS - 20 + k * 12, lane, 100)));
  const boxes = [a, b, ...wall];
  const p = plan({ s: 0, d: laneCenter(1), v: Number(process.env.EGO ?? 140) * KMH, speedCap: 300 * KMH }, boxes);
  const through = p.points.some((x) => x.d < laneCenter(0) + 0.5 && x.s > b.s + b.v * x.t);
  const out = p.points.slice(0, 9).map((x) => `${x.t.toFixed(1)}s d=${x.d.toFixed(2)} v=${(x.v / KMH).toFixed(0)} A${(a.s + a.v * x.t - x.s).toFixed(0)} B${(b.s + b.v * x.t - x.s).toFixed(0)}`);
  process.stdout.write(`gap ${gap} m: ${through ? 'THROUGH' : 'stays behind'}, end speed ${(p.points[p.points.length - 1].v / KMH).toFixed(0)} km/h\n  ${out.join('\n  ')}\n`);
});
