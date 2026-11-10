import { it } from 'vitest';
import { plan, planAt, PLANNER } from '../src/ai/planner';
import { laneCenter } from '../src/road/coords';
import { CARS } from '../src/vehicles/cars';
import { KMH } from '../src/config';
import type { TrafficBox } from '../src/ai/sensors';

/**
 * Crossing a short gap: the car (EGO_KMH) in lane 2 behind a slow car (SLOW_KMH, 50 m on), lane 3 a row of slow
 * cars, lane 0 empty; lane 1 has two cars (LANE1_KMH) GAP m apart bumper to bumper, the gap AT m ahead. For each
 * gap length the planner (one plan from there, 8 s) under each setting: through the gap or not (behind / ahead of
 * the pair, or staying in lane 2), metres covered in 8 s, how far it swings out (right, away) first, the most
 * sideways speed crossing.
 *   npx vitest run --config training/vitest.config.ts training/gapCross.train.ts
 */
const spec = CARS[process.env.CAR ?? 'street-racer'];
const hw = spec.params.width / 2;
const hl = spec.params.length / 2;
const EGO = Number(process.env.EGO_KMH ?? 200) * KMH;
const SLOW = Number(process.env.SLOW_KMH ?? 100) * KMH;
const LANE1 = Number(process.env.LANE1_KMH ?? 150) * KMH;
const GAPS = (process.env.GAPS ?? '60,40,30,25,20,15,10').split(',').map(Number);
const ATS = (process.env.ATS ?? '10,20,30,40,50,60,70').split(',').map(Number);
const LEN = 4.6;
const box = (id: number, s: number, lane: number, v: number): TrafficBox => ({ id, s, dMin: laneCenter(lane) - 0.9, dMax: laneCenter(lane) + 0.9, v, length: LEN });

const SETTINGS: [string, Partial<typeof PLANNER>][] = [
  ['as is', {}],
  ['beam unlimited', { beam: 0 }],
  ['no lineCost', { lineCost: 0 }],
  ['no passCost', { passCost: 0 }],
  ['no swingMargin', { swingMargin: 0 }],
];

it('gap cross', () => {
  const base = { ...PLANNER };
  const out: string[] = [`ego ${EGO / KMH} km/h in lane 2, lane 1 pair at ${LANE1 / KMH}, slow ones ${SLOW / KMH}; gap ahead at ${ATS.join('/')} m`];
  for (const gap of GAPS) {
    out.push(`gap ${gap} m (bumper to bumper):`);
    for (const [name, set] of SETTINGS) {
      Object.assign(PLANNER, base, set);
      let through = 0, other = 0, stay = 0, dist = 0, swing = 0, latV = 0, ms = 0;
      for (const at of ATS) {
        // The pair: R behind the gap, F ahead of it (the gap's middle `at` m on).
        const R = box(1, at - gap / 2 - LEN / 2, 1, LANE1);
        const F = box(2, at + gap / 2 + LEN / 2, 1, LANE1);
        const boxes = [R, F, box(3, 50, 2, SLOW)];
        // QUEUE=1: lane 1 a queue (8 m apart) with that one gap - no way round the pair.
        if (process.env.QUEUE) for (let k = 1; k <= 25; k++) boxes.push(box(100 + k, R.s - k * (LEN + 8), 1, LANE1), box(200 + k, F.s + k * (LEN + 8), 1, LANE1));
        for (let s = -20; s <= 160; s += 14) boxes.push(box(10 + s, s, 3, SLOW));
        const ego = { s: 0, d: laneCenter(2), v: EGO, speedCap: 300 * KMH, vD: 0, accel: spec.ai.accel, latAccel: spec.ai.latAccel, halfWidth: hw, halfLength: hl };
        const t0 = performance.now();
        const p = plan(ego, boxes);
        ms += performance.now() - t0;
        const end = planAt(p, 8);
        dist += end.s;
        let maxRight = 0, cross: number | null = null, prevD = ego.d, maxV = 0;
        for (let k = 0; k <= 80; k++) {
          const q = planAt(p, k * 0.1);
          if (cross === null) maxRight = Math.max(maxRight, q.d - ego.d);
          if (cross === null && prevD > laneCenter(1) && q.d <= laneCenter(1)) cross = q.t;
          maxV = Math.max(maxV, Math.abs(q.dRate));
          prevD = q.d;
        }
        if (cross === null || end.d > laneCenter(0) + 1) {
          stay++;
          continue;
        }
        const q = planAt(p, cross);
        const rs = R.s + R.v * cross, fs = F.s + F.v * cross;
        if (q.s > rs && q.s < fs) {
          through++;
          swing += maxRight;
          latV += maxV;
        } else other++;
      }
      const n = ATS.length;
      out.push(`  ${name.padEnd(15)} through the gap ${through}/${n}, round the pair ${other}, stayed in lane 2 ${stay}; 8 s: ${(dist / n).toFixed(0)} m` +
        (through ? `; swung out ${(swing / through).toFixed(2)} m first, crossing at up to ${(latV / through).toFixed(1)} m/s sideways` : '') + `  (${(ms / n).toFixed(0)} ms a plan)`);
    }
  }
  Object.assign(PLANNER, base);
  process.stdout.write(out.join('\n') + '\n');
}, 1_800_000);
