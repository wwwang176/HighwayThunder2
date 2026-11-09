import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Plan, PLAN_STATS, planAt } from '../src/ai/planner';
import { DRIVER_TUNING, PlannerDriver } from '../src/ai/plannerDriver';
import { TrainingSim } from '../src/ai/trainingSim';
import { CARS } from '../src/vehicles/cars';
import { trackerFrom } from '../src/ai/netTracker';
import type { SelfState, TrafficBox } from '../src/ai/sensors';

/**
 * Plans that give up a move sideways halfway, closing on a car ahead: races (as planner.train.ts), and every new
 * plan whose sideways course 1 s on is ABORT_M m off the last plan's, with a car ahead in the way closing fast. For
 * each: how the new plan came out (normal / relaxed / none found), what changed in the traffic since the last plan
 * (a car moved sideways, a merging one appeared, a new one), and whether a crash followed within 3 s.
 *   CAR=muscle-car EVAL_SEEDS=7001,7002 npx vitest run --config training/vitest.config.ts training/planAbort.train.ts
 * DRIVER_JSON='{"pathAgree":99}': driver settings. SHOW=n: print the first n in full.
 */
const ABORT_M = Number(process.env.ABORT_M ?? 1.2);

interface Abort {
  seed: number;
  t: number;
  kind: 'normal' | 'relaxed' | 'reused' | 'fallback';
  lines: string[];
  changed: string[];
  crashed: boolean;
}

it('plan aborts', async () => {
  await RAPIER.init();
  if (process.env.DRIVER_JSON) Object.assign(DRIVER_TUNING, JSON.parse(process.env.DRIVER_JSON));
  const spec = CARS[process.env.CAR ?? 'street-racer'];
  const aborts: Abort[] = [];
  let plans = 0;
  for (const seed of (process.env.EVAL_SEEDS ?? '7001,7002,7003,7004').split(',').map(Number)) {
    const driver = new PlannerDriver();
    driver.accel = spec.ai.accel;
    driver.latAccel = spec.ai.latAccel;
    driver.tracker = trackerFrom(spec.ai.tracker);
    driver.recovery = trackerFrom(spec.ai.recovery);
    let clock = 0;
    let last: { plan: Plan; t: number; boxes: Map<number, TrafficBox> } | null = null;
    const open: Abort[] = [];
    const drive = driver.drive.bind(driver);
    driver.drive = (self: SelfState, traffic: TrafficBox[], p) => {
      clock += 1 / 120;
      const before = driver.plan;
      const f0 = PLAN_STATS.fallback, r0 = PLAN_STATS.relaxed, u0 = PLAN_STATS.reused;
      const out = drive(self, traffic, p);
      if (driver.plan && driver.plan !== before) {
        plans++;
        const kind = PLAN_STATS.fallback > f0 ? 'fallback' : PLAN_STATS.reused > u0 ? 'reused' : PLAN_STATS.relaxed > r0 ? 'relaxed' : 'normal';
        const boxes = new Map<number, TrafficBox>();
        traffic.forEach((t) => t.id !== undefined && boxes.set(t.id * 2 + (t.phantom ? 1 : 0), t));
        if (last) {
          const age = clock - last.t;
          const was = planAt(last.plan, age + 1).d, now = planAt(driver.plan, 1).d;
          const hw = self.halfWidth ?? 0.93;
          const ahead = traffic.filter((t) => !t.phantom && t.s > self.s && t.s < self.s + 70 && self.vLong - t.v > 8 && Math.min(t.dMax, self.d + hw) - Math.max(t.dMin, self.d - hw) > 0);
          if (Math.abs(was - now) > ABORT_M && ahead.length) {
            const vD = self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw);
            const path = (pl: Plan, a: number) => [0, 0.5, 1, 1.5, 2].map((k) => planAt(pl, a + k).d.toFixed(1)).join(' ');
            const lines = [
              `seed ${seed} t ${clock.toFixed(2)} ${kind}: v ${(self.vLong * 3.6).toFixed(0)} d ${self.d.toFixed(2)} vD ${vD.toFixed(2)}; last plan's d over 2 s ${path(last.plan, age)} -> new ${path(driver.plan, 0)}`,
            ];
            const changed: string[] = [];
            for (const t of traffic) {
              if (t.s < self.s - 30 || t.s > self.s + 90 || t.id === undefined) continue;
              const key = t.id * 2 + (t.phantom ? 1 : 0);
              const then = last.boxes.get(key);
              let note = '';
              if (!then) note = t.phantom ? 'NEW MERGE' : 'NEW';
              else if (Math.abs((then.dMin + then.dMax) / 2 - (t.dMin + t.dMax) / 2) > 0.15) note = 'MOVED';
              if (note) changed.push(note);
              lines.push(`    ${t.phantom ? 'merge' : 'car  '} ${t.id} ds ${(t.s - self.s).toFixed(1)} d ${t.dMin.toFixed(2)}..${t.dMax.toFixed(2)} dv ${(self.vLong - t.v).toFixed(1)}${then ? ` (was ${then.dMin.toFixed(2)}..${then.dMax.toFixed(2)})` : ''} ${note}`);
            }
            const a: Abort = { seed, t: clock, kind, lines, changed, crashed: false };
            aborts.push(a);
            open.push(a);
          }
        }
        last = { plan: driver.plan, t: clock, boxes };
      }
      return out;
    };
    const sim = new TrainingSim([driver], seed, { spec, speedCap: 300 / 3.6, trafficSeesCars: true, resetOnCrash: 60 / 3.6 });
    let crashes = 0;
    while (!sim.done) {
      sim.step();
      const n = sim.ghosts[0].result.crashLog?.length ?? 0;
      if (n > crashes) {
        crashes = n;
        for (const a of open) if (clock - a.t < 3) a.crashed = true;
      }
      while (open.length && clock - open[0].t > 3) open.shift();
    }
    sim.dispose();
  }
  const by = (f: (a: Abort) => string) => {
    const m: Record<string, number> = {};
    for (const a of aborts) m[f(a)] = (m[f(a)] ?? 0) + 1;
    return JSON.stringify(m);
  };
  const out = [
    `${plans} plans (${JSON.stringify(PLAN_STATS)}), ${aborts.length} gave up a move closing on a car ahead; crash within 3 s after ${aborts.filter((a) => a.crashed).length}`,
    `by kind ${by((a) => a.kind)}; crashed by kind ${JSON.stringify(Object.fromEntries(['normal', 'relaxed', 'reused', 'fallback'].map((k) => [k, aborts.filter((a) => a.crashed && a.kind === k).length])))}`,
    `what changed since the last plan: ${by((a) => [...new Set(a.changed)].sort().join('+') || 'nothing')}`,
    `...for those that crashed: ${JSON.stringify(aborts.filter((a) => a.crashed).map((a) => [...new Set(a.changed)].sort().join('+') || 'nothing'))}`,
  ];
  const show = Number(process.env.SHOW ?? 0);
  for (const a of aborts.filter((x) => x.crashed).slice(0, show)) out.push(...a.lines);
  process.stdout.write(out.join('\n') + '\n');
}, 3_600_000);
