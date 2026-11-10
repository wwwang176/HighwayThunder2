import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { Plan, plan, planAt, PlanEgo, PLANNER, PreviousPlan } from '../src/ai/planner';
import { PlannerDriver, PlanSource } from '../src/ai/plannerDriver';
import { TrainingSim } from '../src/ai/trainingSim';
import { trackerFrom } from '../src/ai/netTracker';
import { CARS } from '../src/vehicles/cars';
import { KMH } from '../src/config';
import type { TrafficBox } from '../src/ai/sensors';

/**
 * What PLANNER.passCost does to the planner's passes: races (as planner.train.ts, passCost off), and at each plan that
 * goes past a car it is closing on with less than TIGHT m beside it, that moment planned again with passCost 0 / 1 /
 * 3 (same traffic, same last plan): the least room each leaves, and its path. OUT=file.json for a picture.
 *   EVAL_SEEDS=7001 npx vitest run --config training/vitest.config.ts training/passArc.train.ts
 */
const spec = CARS[process.env.CAR ?? 'street-racer'];
const TIGHT = Number(process.env.TIGHT ?? 0.45);
const COSTS = [0, 1, 3];

/** The least room (m, body to body) the plan leaves beside each box over its first 3 s, while level with it. */
function rooms(p: Plan, boxes: TrafficBox[], hw: number, hl: number): number[] {
  return boxes.map((b) => {
    let least = Infinity;
    for (let k = 0; k <= 30; k++) {
      const q = planAt(p, k * 0.1);
      if (Math.abs(b.s + b.v * q.t - q.s) > b.length / 2 + hl) continue;
      least = Math.min(least, q.d > (b.dMin + b.dMax) / 2 ? q.d - hw - b.dMax : b.dMin - (q.d + hw));
    }
    return least;
  });
}

it('pass arc', async () => {
  await RAPIER.init();
  const hw = spec.params.width / 2;
  const hl = spec.params.length / 2;
  const scenes: { seed: number; t: number; ego: PlanEgo; boxes: TrafficBox[]; previous: PreviousPlan | null; tight: number }[] = [];
  for (const seed of (process.env.EVAL_SEEDS ?? '7001').split(',').map(Number)) {
    let clock = 0;
    let lastAt = -10;
    let answer: { stamp: number; plan: Plan } | null = null;
    const source: PlanSource = {
      busy: false,
      request(stamp, ego, traffic, previous) {
        PLANNER.passCost = 0;
        const p = plan(ego, traffic, previous);
        answer = { stamp, plan: p };
        if (clock - lastAt < 3 || scenes.length >= Number(process.env.MAX ?? 8)) return;
        const ahead = traffic.filter((b) => !b.phantom && b.s - b.length / 2 > ego.s + hl && ego.v - b.v > 5 && b.s - ego.s < 80);
        const r = rooms(p, ahead, hw, hl);
        const i = r.findIndex((x) => x >= 0 && x < TIGHT);
        if (i < 0) return;
        lastAt = clock;
        const near = traffic.filter((b) => b.s > ego.s - 30 && b.s < ego.s + 150);
        scenes.push({ seed, t: clock, ego: { ...ego }, boxes: near.map((b) => ({ ...b })), previous, tight: near.indexOf(ahead[i]) });
      },
      take() {
        const a = answer;
        answer = null;
        return a;
      },
    };
    const driver = new PlannerDriver(source);
    driver.accel = spec.ai.accel;
    driver.latAccel = spec.ai.latAccel;
    driver.tracker = trackerFrom(spec.ai.tracker);
    driver.recovery = trackerFrom(spec.ai.recovery);
    const drive = driver.drive.bind(driver);
    driver.drive = (self, traffic, p) => {
      clock += 1 / 120;
      return drive(self, traffic, p);
    };
    const sim = new TrainingSim([driver], seed, { spec, speedCap: 300 * KMH, trafficSeesCars: true, resetOnCrash: 60 * KMH });
    while (!sim.done && scenes.length < Number(process.env.MAX ?? 8)) sim.step();
    sim.dispose();
  }
  const out: string[] = [];
  // ROLL=8: from each moment, driven on that many s as the plans have it (replanned every 0.25 s, followed exactly;
  // the traffic keeping its speed and lane, as the planner assumes) - a run of passes, not just the one plan.
  const roll = Number(process.env.ROLL ?? 0);
  const rolled = (sc: (typeof scenes)[number], cost: number) => {
    PLANNER.passCost = cost;
    let ego = { ...sc.ego };
    let previous: PreviousPlan | null = sc.previous;
    const pts: { t: number; s: number; d: number }[] = [];
    for (let k = 0; k * 0.25 < roll; k++) {
      const t = k * 0.25;
      const boxes = sc.boxes.map((b) => ({ ...b, s: b.s + b.v * t }));
      const p = plan(ego, boxes, previous);
      for (let j = 0; j < 5; j++) {
        const q = planAt(p, j * 0.05);
        pts.push({ t: +(t + j * 0.05).toFixed(2), s: +(q.s - sc.ego.s).toFixed(2), d: +q.d.toFixed(3) });
      }
      const q = planAt(p, 0.25);
      ego = { ...ego, s: q.s, d: q.d, v: q.v, vD: q.dRate };
      previous = { plan: p, age: 0.25 };
    }
    const passed = sc.boxes.map((b) => {
      let least = Infinity;
      for (const q of pts) {
        if (Math.abs(b.s + b.v * q.t - (q.s + sc.ego.s)) > b.length / 2 + hl) continue;
        least = Math.min(least, q.d > (b.dMin + b.dMax) / 2 ? q.d - hw - b.dMax : b.dMin - (q.d + hw));
      }
      return least;
    });
    return { cost, pts, passed };
  };
  const dump = scenes.map((sc) => {
    if (roll > 0) {
      const runs = [0, 1].map((c) => rolled(sc, c));
      const fmt = (r: ReturnType<typeof rolled>) => r.passed.filter(Number.isFinite).map((x) => x.toFixed(2)).join(' ');
      out.push(`seed ${sc.seed} t ${sc.t.toFixed(1)}: rolled ${roll} s, room beside each car level with: cost 0 [${fmt(runs[0])}] / cost 1 [${fmt(runs[1])}], at the end ${runs.map((r) => r.pts[r.pts.length - 1].s.toFixed(0)).join(' / ')} m`);
      return { seed: sc.seed, t: sc.t, v: sc.ego.v, hw, hl, boxes: sc.boxes.map((b) => ({ ...b, s: b.s - sc.ego.s })), runs };
    }
    const runs = COSTS.map((cost) => {
      PLANNER.passCost = cost;
      const p = plan(sc.ego, sc.boxes, sc.previous);
      const r = rooms(p, [sc.boxes[sc.tight]], hw, hl)[0];
      const end = planAt(p, 3);
      return { cost, room: r, end: end.s - sc.ego.s, v: end.v, pts: Array.from({ length: 31 }, (_, k) => { const q = planAt(p, k * 0.1); return { t: +q.t.toFixed(2), s: +(q.s - sc.ego.s).toFixed(2), d: +q.d.toFixed(3) }; }) };
    });
    out.push(`seed ${sc.seed} t ${sc.t.toFixed(1)} ${(sc.ego.v / KMH).toFixed(0)} km/h: room beside the car passed ${runs.map((r) => `cost ${r.cost} ${r.room.toFixed(2)} m (${r.end.toFixed(0)} m in 3 s)`).join(', ')}`);
    return { seed: sc.seed, t: sc.t, v: sc.ego.v, d: sc.ego.d, hw, hl, tight: sc.tight, boxes: sc.boxes.map((b) => ({ ...b, s: b.s - sc.ego.s })), runs };
  });
  PLANNER.passCost = 0;
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(dump));
  process.stdout.write(out.join('\n') + '\n');
}, 1_800_000);
