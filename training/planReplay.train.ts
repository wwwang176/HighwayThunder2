import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { coursePlan } from '../src/ai/coursePlanner';
import type { PlanEgo, PreviousPlan } from '../src/ai/planner';
import type { TrafficBox } from '../src/ai/sensors';

/**
 * Benchmark: the course planner's time on plan requests recorded in the game (each { ego, traffic, previous }, as
 * WorkerPlanSource sends them), the same every run - one version against another on the very same inputs, and a
 * hash of every plan made (the same hash: the same plans to the bit).
 *   REQS=path/to/requests.json PASSES=5 EVERY=1 npx vitest run --config training/vitest.config.ts training/planReplay.train.ts
 */
it('plan replay', () => {
  // (EVERY=3: every third of them)
  const every = Number(process.env.EVERY ?? 1);
  const all = JSON.parse(readFileSync(process.env.REQS!, 'utf8')) as { ego: PlanEgo; traffic: TrafficBox[]; previous: PreviousPlan | null }[];
  const reqs = all.filter((_, i) => i % every === 0);
  const passes = Number(process.env.PASSES ?? 5);
  const hash = createHash('sha1');
  for (const r of reqs) hash.update(JSON.stringify(coursePlan(r.ego, r.traffic, r.previous))); // (and warmed up)
  const times: number[] = [];
  for (let p = 0; p < passes; p++) {
    const t0 = performance.now();
    for (const r of reqs) coursePlan(r.ego, r.traffic, r.previous);
    times.push((performance.now() - t0) / reqs.length);
  }
  times.sort((a, b) => a - b);
  process.stdout.write(`${reqs.length} plans: ${times[0].toFixed(2)} ms a plan at best, ${times[Math.floor(times.length / 2)].toFixed(2)} median (${passes} passes); plans ${hash.digest('hex').slice(0, 12)}\n`);
});
