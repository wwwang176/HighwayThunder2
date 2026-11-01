import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PLAN_STATS, PLANNER } from '../src/ai/planner';
import { PlannerDriver } from '../src/ai/plannerDriver';
import { TrainingSim } from '../src/ai/trainingSim';
import { laneAt, laneCenter } from '../src/road/coords';

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const a = xs.map(Math.abs).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
};
const f = (x: number) => x.toFixed(2);

/**
 * Benchmark: the planner with plain controllers on unseen traffic, and how
 * closely the car follows its plans (to size the planner's margins from).
 *   EVAL_SEEDS=7001,7002 CAP_KMH=300 npx vitest run --config training/vitest.config.ts training/planner.train.ts
 */
it('planner', async () => {
  // PLANNER_JSON='{"hardBrake":11}': try planner settings without editing the code.
  if (process.env.PLANNER_JSON) Object.assign(PLANNER, JSON.parse(process.env.PLANNER_JSON));
  await RAPIER.init();
  const out: string[] = [];
  const all = { lateralMoving: [] as number[], lateralHolding: [] as number[], along: [] as number[], speedAtOverride: [] as number[] };
  for (const seed of (process.env.EVAL_SEEDS ?? '7001,7002,7003,7004,7005').split(',').map(Number)) {
    const driver = new PlannerDriver();
    const st = driver.measure();
    // Traffic gives way to the AI car as it does the player in the game (TRAFFIC_BLIND=1: as in training).
    const sim = new TrainingSim([driver], seed, { speedCap: Number(process.env.CAP_KMH ?? 300) / 3.6, trafficSeesCars: !process.env.TRAFFIC_BLIND });
    let maxV = 0;
    let offCentre = 0;
    let steps = 0;
    const t0 = performance.now();
    while (!sim.done) {
      sim.step();
      const c = sim.ghosts[0].car;
      maxV = Math.max(maxV, c.speed);
      steps++;
      if (Math.abs(c.d - laneCenter(laneAt(c.d))) > 0.5) offCentre++;
    }
    const ms = performance.now() - t0;
    const g = sim.ghosts[0];
    const r = g.result;
    const end = r.finishTime !== null ? `FINISH ${r.finishTime.toFixed(0)}s` : r.crashed ? `CRASH at ${Math.round(r.distance)} m` : `timeout at ${Math.round(r.distance)} m`;
    out.push(
      `${seed}: ${end}, avg ${Math.round((r.distance / sim.time) * 3.6)} km/h, max ${Math.round(maxV * 3.6)}, lane changes ${g.laneChanges}, ` +
        `off lane centre ${Math.round((100 * offCentre) / steps)}%, light contacts ${r.contacts}, emergency brake ${Math.round((100 * driver.overrides) / steps)}% of steps, ${(ms / 1000).toFixed(1)} s cpu`,
    );
    for (const k of Object.keys(all) as (keyof typeof all)[]) all[k].push(...st[k]);
    sim.dispose();
  }
  out.push(
    `tracking 0.75 s after a plan (p50 / p95 / max, m): lateral while moving ${f(pct(all.lateralMoving, 0.5))} / ${f(pct(all.lateralMoving, 0.95))} / ${f(pct(all.lateralMoving, 1))}` +
      `, holding ${f(pct(all.lateralHolding, 0.5))} / ${f(pct(all.lateralHolding, 0.95))} / ${f(pct(all.lateralHolding, 1))}` +
      `, along ${f(pct(all.along, 0.5))} / ${f(pct(all.along, 0.95))} / ${f(pct(all.along, 1))} (ahead of plan ${Math.round((100 * all.along.filter((x) => x > 0).length) / Math.max(1, all.along.length))}%)`,
  );
  const plans = PLAN_STATS.normal + PLAN_STATS.relaxed + PLAN_STATS.fallback;
  out.push(`plans: ${plans}, relaxed ${Math.round((100 * PLAN_STATS.relaxed) / plans)}%, boxed-in fallback ${Math.round((100 * PLAN_STATS.fallback) / plans)}%`);
  const sa = all.speedAtOverride;
  out.push(`at emergency brake: speed over plan p50 ${f(pct(sa, 0.5))} m/s, faster than plan ${Math.round((100 * sa.filter((x) => x > 0).length) / Math.max(1, sa.length))}% of the time`);
  process.stdout.write(out.join('\n') + '\n');
});
