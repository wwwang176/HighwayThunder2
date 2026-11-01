import { it } from 'vitest';
import { plan, PLANNER } from '../src/ai/planner';
import type { TrafficBox } from '../src/ai/sensors';
import { KMH } from '../src/config';
import { laneCenter } from '../src/road/coords';
import { mulberry32 } from '../src/ai/rng';

/**
 * How long one plan takes (ms) on busy random traffic, and how far it gets: to size the lattice
 * (sideways speeds in the state, beam).
 *   PLANNER_JSON='{"maxLateral":3,"maxLateralChange":2,"beam":800}' npx vitest run --config training/vitest.config.ts training/planSpeed.train.ts
 */
it('planSpeed', () => {
  if (process.env.PLANNER_JSON) Object.assign(PLANNER, JSON.parse(process.env.PLANNER_JSON));
  const rng = mulberry32(5);
  const scenes: TrafficBox[][] = [];
  for (let i = 0; i < 40; i++) {
    const boxes: TrafficBox[] = [];
    for (let k = 0; k < 14; k++) {
      const lane = Math.floor(rng() * 4);
      boxes.push({ s: -20 + rng() * 300, dMin: laneCenter(lane) - 0.925, dMax: laneCenter(lane) + 0.925, v: (70 + rng() * 40) * KMH, length: 4.5 });
    }
    scenes.push(boxes);
  }
  let ms = 0;
  let worst = 0;
  let reach = 0;
  for (const boxes of scenes) {
    const t0 = performance.now();
    const p = plan({ s: 0, d: laneCenter(1), v: 180 * KMH, speedCap: 300 * KMH }, boxes);
    const t = performance.now() - t0;
    ms += t;
    worst = Math.max(worst, t);
    reach += p.points[p.points.length - 1].s;
  }
  process.stdout.write(`plan ${(ms / scenes.length).toFixed(1)} ms average, worst ${worst.toFixed(1)} ms, reaches ${(reach / scenes.length).toFixed(0)} m in ${PLANNER.horizon} s\n`);
});
