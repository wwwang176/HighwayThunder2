import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { CARS } from '../src/vehicles/cars';
import { TUNE_ITEMS, type TuneCal } from '../src/vehicles/tuning';
import { initExams } from './trackerEval';
import { measure, type Metrics } from './tuneMetrics';

/**
 * Every tuning item at -2, 0, +2 on each car (training/tuneMetrics.ts's measurements), as calibrated (CAL=<json>:
 * { carId: { key: [lo, hi] } }, tuneCalibrate's; none: as written).
 *   CAR=street-racer CARS=street-racer OUT=file.json npx vitest run --config training/vitest.config.ts training/tuneMeasure.train.ts
 */
const COLS: [string, number][] = [
  ['launchPitch', 2], ['brakePitch', 2], ['flickRoll', 2], ['laneRoll', 2], ['laneSettle', 2], ['laneSwings', 0],
  ['t100', 2], ['t200', 2], ['top', 2], ['v25', 0], ['vTop', 0], ['reaccel', 1], ['brake200', 1], ['brakeSlip', 1], ['brakeTurnSlip', 1], ['lat150', 1], ['lat250', 1],
  ['flick', 2], ['flickSlip', 1], ['lane', 2], ['laneOver', 2], ['laneSlip', 1], ['nitro3', 1], ['nitroSecs', 1],
];

it('tune measure', async () => {
  await initExams();
  const out: string[] = [];
  const dump: Record<string, unknown> = {};
  for (const specId of (process.env.CARS ?? Object.keys(CARS).join(',')).split(',')) {
    const cal: TuneCal = process.env.CAL ? (JSON.parse(readFileSync(process.env.CAL, 'utf8'))[specId] ?? {}) : {};
    const base = measure(specId, {}, cal);
    const rows: Record<string, { lo: Metrics; hi: Metrics }> = {};
    out.push(`== ${specId}: stock ${COLS.map(([k, d]) => `${k} ${base[k].toFixed(d)}`).join(', ')}`);
    for (const item of TUNE_ITEMS) {
      const lo = measure(specId, { [item.key]: -2 }, cal);
      const hi = measure(specId, { [item.key]: 2 }, cal);
      rows[item.key] = { lo, hi };
      // Each metric: -2 / +2 as a change from stock (only those that move 1 % or more).
      const moved = COLS.filter(([k]) => Math.max(Math.abs(lo[k] - base[k]), Math.abs(hi[k] - base[k])) >= Math.max(0.01 * Math.abs(base[k]), 1e-3))
        .map(([k, d]) => `${k} ${(lo[k] - base[k] >= 0 ? '+' : '') + (lo[k] - base[k]).toFixed(d)}/${(hi[k] - base[k] >= 0 ? '+' : '') + (hi[k] - base[k]).toFixed(d)}`);
      out.push(`  ${item.key.padEnd(10)} ${moved.join(', ') || '(nothing moved 1 %)'}`);
    }
    dump[specId] = { base, rows };
    process.stdout.write(out.splice(0).join('\n') + '\n');
  }
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(dump, null, 1));
}, 7_200_000);
