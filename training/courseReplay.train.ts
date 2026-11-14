import { it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { COURSE, coursePlan } from '../src/ai/coursePlanner';
import { planAt, type Plan } from '../src/ai/planner';

/**
 * Investigation: replay the course planner on the "collapse" snapshots planner.train.ts writes (TRACE_CONTACT=1
 * SNAP_DIR=...): a full plan followed by one ending within 1.5 s. Each is planned again with other settings, to sort
 * the collapses into "the search lost the way" (a bigger beam finds a full plan), "the car left the plan" (planned
 * from where the last plan had it, a full plan) or "no way" (nothing finds one).
 *   SNAP_DIR=bench-out/snaps npx vitest run --config training/vitest.config.ts training/courseReplay.train.ts
 * VARIANTS='beam:1000,beam:4000' (default below); SNAP_FILTER=muscle-car.
 */
it('course replay', () => {
  const dir = process.env.SNAP_DIR ?? 'bench-out/snaps';
  const base = { ...COURSE };
  const variants = (process.env.VARIANTS ?? 'beam:1000,beam:4000,onPrev,latGrip:0.8').split(',');
  const out: string[] = [];
  const end = (p: Plan) => p.points[p.points.length - 1].t;
  const tally: Record<string, { full: number; n: number; ms: number }> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x.includes(process.env.SNAP_FILTER ?? ''))) {
    for (const sn of JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))) {
      Object.assign(COURSE, base);
      const again = coursePlan(sn.ego, sn.traffic, sn.previous);
      const cols = [`base ${end(again).toFixed(2)}`];
      for (const v of ['base', ...variants]) {
        Object.assign(COURSE, base);
        let ego = sn.ego;
        if (v === 'onPrev') {
          // Planned from where the last plan had it now (as the lattice planner's reuse): on its line, its speed, its course.
          const at = planAt(sn.previous.plan, sn.previous.age);
          const k = Math.min(sn.previous.plan.points.length - 1, Math.round(sn.previous.age / 0.25));
          const psi = sn.previous.plan.points[k].psi ?? 0;
          ego = { ...sn.ego, s: at.s, d: at.d, v: at.v, vD: at.v * Math.sin(psi), yaw: psi, vLat: 0 };
        } else if (v !== 'base') {
          const [k, x] = v.split(':');
          (COURSE as Record<string, number>)[k] = Number(x);
        }
        const t0 = performance.now();
        const p = coursePlan(ego, sn.traffic, sn.previous);
        const ms = performance.now() - t0;
        const e = end(p);
        tally[v] ??= { full: 0, n: 0, ms: 0 };
        tally[v].n++;
        tally[v].ms += ms;
        if (e >= 7.5) tally[v].full++;
        if (v !== 'base') cols.push(`${v} ${e.toFixed(2)}`);
      }
      out.push(
        `${f.replace('.json', '')} t ${sn.t.toFixed(2)} ${sn.kind}${sn.end.toFixed(2)} wreck ${sn.wreckAfter === null ? '-' : `+${(sn.wreckAfter - sn.t).toFixed(1)}s`} | v ${(sn.ego.v * 3.6).toFixed(0)} d ${sn.ego.d.toFixed(2)} yaw ${sn.yaw.toFixed(3)} vLat ${sn.vLat.toFixed(2)} off-plan d ${sn.err.d.toFixed(2)} s ${sn.err.s.toFixed(2)} v ${(sn.err.v * 3.6).toFixed(1)} km/h${sn.emerRecent ? ' EMER' : ''} | ${cols.join(', ')}`,
      );
    }
  }
  Object.assign(COURSE, base);
  for (const [k, x] of Object.entries(tally)) out.push(`${k}: full plan ${x.full}/${x.n}, ${(x.ms / x.n).toFixed(0)} ms a plan`);
  process.stdout.write(out.join('\n') + '\n');
});
