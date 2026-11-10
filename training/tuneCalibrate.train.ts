import { it } from 'vitest';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { CARS } from '../src/vehicles/cars';
import { TUNE_ITEMS, type TuneCal, type TuneEnd, type TuneItem } from '../src/vehicles/tuning';
import { initExams } from './trackerEval';
import { measure } from './tuneMetrics';

/**
 * Calibrates the tuning (src/vehicles/tuning.ts), each car and item, each end - by a few runs near it and a straight
 * line through them (each change taken as growing with its scale), then one run to check:
 * - `s`: the item's own measure (`metric`) moved the same either way (the mean of the two ends as written; at most
 *   MAX_S times as written);
 * - perf with `balance`: `b` - what the end gains in one time measure it loses in the other (they add up to nothing);
 * - feel: `cl` / `ct` (`cb`) - its braking and cornering put back as they were (only if it moves them NEUTRAL_SHARE
 *   or more; by at most NEUTRAL_MAX).
 *   CAR=jdm CARS=jdm OUT=cal.json npx vitest run --config training/vitest.config.ts training/tuneCalibrate.train.ts
 * (OUT is read first and added to: each car its own run. ITEMS=a,b: only those.)
 */
const MAX_S = 3;
const NEUTRAL_SHARE = 0.01;
const NEUTRAL_MAX = 0.15;
const PROBE_C = 1.1;
/** Times the compensations are put right again from what they are still off by. */
const REFINE = 3;

it('tune calibrate', async () => {
  await initExams();
  const out = process.env.OUT ?? 'tune-cal.json';
  const all: Record<string, TuneCal> = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
  const only = process.env.ITEMS?.split(',');
  for (const specId of (process.env.CARS ?? Object.keys(CARS).join(',')).split(',')) {
    const cal: TuneCal = all[specId] ?? {};
    for (const item of TUNE_ITEMS) {
      if (only && !only.includes(item.key)) continue;
      const res = calibrate(specId, item);
      if (res.ends) cal[item.key] = res.ends;
      else delete cal[item.key];
      process.stdout.write(`${specId} ${item.key}: ${res.note}\n`);
    }
    all[specId] = cal;
    writeFileSync(out, JSON.stringify(all, null, 1));
  }
}, 7_200_000);

type Side = -1 | 1;
const f = (x: number) => (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(3));

function calibrate(specId: string, item: TuneItem): { ends: { lo: TuneEnd; hi: TuneEnd } | null; note: string } {
  const k = item.metric;
  const neutral = item.neutral ?? [];
  const names = [...new Set([k, ...(item.balance ?? []), ...neutral])];
  const base = measure(specId, {}, {}, names);
  /** Each named measure's change at the end `side` as `end`. */
  const run = (side: Side, end: TuneEnd): Record<string, number> => {
    const r = measure(specId, { [item.key]: 2 * side }, { [item.key]: side < 0 ? { lo: end, hi: { s: 1 } } : { lo: { s: 1 }, hi: end } }, names);
    return Object.fromEntries(names.map((m) => [m, r[m] - base[m]]));
  };
  const notes: string[] = [];
  const ends: Record<Side, TuneEnd> = { [-1]: { s: 1 }, [1]: { s: 1 } } as Record<Side, TuneEnd>;
  /** Per unit of scale: the item's own measure's change at each end (its balance / pace as they will be set). */
  const unit: Record<Side, number> = { [-1]: 0, [1]: 0 } as Record<Side, number>;
  /** feel: each neutral measure's change per unit of scale (u) and per ln of its compensation (v); its own measure's too. */
  const comp: Record<Side, { u: Record<string, number>; v: Record<string, Record<string, number>> }> = {} as never;

  for (const side of [-1, 1] as Side[]) {
    if (item.balance) {
      // Changes as s (u, at b 0) plus s b (w): gains and losses even at b = -(uA + uB) / (wA + wB), whatever s.
      const u = run(side, { s: 1, b: 0 });
      const uw = run(side, { s: 1, b: 1 });
      const uSum = item.balance.reduce((a, m) => a + u[m], 0);
      const wSum = item.balance.reduce((a, m) => a + uw[m] - u[m], 0);
      let b = wSum !== 0 ? -uSum / wSum : 1;
      if (!(b >= 0) || b > 6) {
        notes.push(`${side < 0 ? '-2' : '+2'} gains and losses can't be evened (b ${b.toFixed(2)})`);
        b = Math.max(0, Math.min(6, Number.isFinite(b) ? b : 1));
      }
      ends[side].b = Number(b.toFixed(3));
      unit[side] = u[k] + b * (uw[k] - u[k]);
    } else if (neutral.length) {
      const u = run(side, { s: 1 });
      const v: Record<string, Record<string, number>> = {};
      for (const n of neutral) {
        const key = n === 'lat250' ? 'ct' : item.neutralByBrakes ? 'cb' : 'cl';
        const r = run(side, { s: 0, [key]: PROBE_C }); // (the compensation alone)
        v[key] = Object.fromEntries(names.map((m) => [m, r[m] / Math.log(PROBE_C)]));
      }
      comp[side] = { u, v };
      unit[side] = u[k];
    } else unit[side] = run(side, { s: 1 })[k];
  }
  // (An item taken as written - its pace still put back - needs no two ends.)
  if (!item.asWritten && (!(Math.sign(unit[-1]) === -Math.sign(unit[1])) || Math.abs(unit[-1]) < 1e-6 || Math.abs(unit[1]) < 1e-6)) {
    return { ends: null, note: `${k} per unit ${f(unit[-1])} / ${f(unit[1])} - not two ends: as written (whatever it does)` };
  }
  // Even: the mean of the two, no end past MAX_S.
  let target = (Math.abs(unit[-1]) + Math.abs(unit[1])) / 2;
  target = Math.min(target, MAX_S * Math.abs(unit[-1]), MAX_S * Math.abs(unit[1]));
  for (const side of [-1, 1] as Side[]) {
    const s = item.asWritten ? 1 : target / Math.abs(unit[side]);
    ends[side].s = Number(s.toFixed(3));
    if (comp[side]) {
      // Its pace back: ln c for each neutral one, solving s u_n + sum(ln c_j v_j[n]) = 0 (each its own c: diagonal enough).
      for (const n of neutral) {
        const key = n === 'lat250' ? 'ct' : item.neutralByBrakes ? 'cb' : 'cl';
        const moved = s * comp[side].u[n];
        if (Math.abs(moved) < NEUTRAL_SHARE * Math.abs(base[n])) continue;
        const vn = comp[side].v[key][n];
        if (!vn) continue;
        const c = Math.exp(-moved / vn);
        const most = item.neutralMax ?? NEUTRAL_MAX;
        const clamped = Math.min(1 + most, Math.max(1 - most, c));
        if (clamped !== c) notes.push(`${side < 0 ? '-2' : '+2'} ${n} only partly put back (c ${c.toFixed(3)})`);
        ends[side][key] = Number(clamped.toFixed(4));
      }
      // ...and again from what it still is off by, as run (the straight line from 1 may be far off): a few times.
      for (let pass = 0; pass < REFINE; pass++) {
        const r = run(side, ends[side]);
        let changed = false;
        for (const n of neutral) {
          const key = n === 'lat250' ? 'ct' : item.neutralByBrakes ? 'cb' : 'cl';
          const off = r[n], c0 = ends[side][key];
          const vn = comp[side].v[key][n];
          if (c0 === undefined || !vn || Math.abs(off) < NEUTRAL_SHARE * Math.abs(base[n])) continue;
          const most = item.neutralMax ?? NEUTRAL_MAX;
          const c = Math.min(1 + most, Math.max(1 - most, c0 * Math.exp(-off / vn)));
          if (c !== c0) {
            ends[side][key] = Number(c.toFixed(4));
            changed = true;
          }
        }
        if (!changed) break;
      }
    }
  }
  // The check: one run each end as calibrated.
  const runs = { [-1]: run(-1, ends[-1]), [1]: run(1, ends[1]) } as Record<Side, Record<string, number>>;
  const check = (side: Side) => names.map((m) => `${m} ${f(runs[side][m])}`).join(', ');
  const fmt = (e: TuneEnd) => Object.entries(e).map(([a, v]) => `${a} ${v}`).join(' ');
  // As calibrated the ends go the same way after all (the straight line wrong far out): as written instead.
  if (!item.asWritten && !(Math.sign(runs[-1][k]) === -Math.sign(runs[1][k]))) {
    return { ends: null, note: `as calibrated ${k} ${f(runs[-1][k])} / ${f(runs[1][k])} - the same way: as written (whatever it does)` };
  }
  return {
    ends: { lo: ends[-1], hi: ends[1] },
    note: `even ±${f(target)} ${k}; -2 [${fmt(ends[-1])}]: ${check(-1)} | +2 [${fmt(ends[1])}]: ${check(1)}${notes.length ? ' | ' + notes.join('; ') : ''}`,
  };
}
