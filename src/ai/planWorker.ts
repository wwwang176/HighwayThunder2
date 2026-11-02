import { plan, PLANNER } from './planner';
import type { PlanRequest, PlanAnswer } from './workerPlanSource';

/** Web Worker: works out plans off the game's thread. */
const ctx = self as unknown as { onmessage: ((e: MessageEvent<PlanRequest>) => void) | null; postMessage(m: PlanAnswer): void };

ctx.onmessage = (e) => {
  const r = e.data;
  Object.assign(PLANNER, r.settings); // tuned in the game's panel
  ctx.postMessage({ stamp: r.stamp, plan: plan(r.ego, r.traffic, r.previous) });
};
