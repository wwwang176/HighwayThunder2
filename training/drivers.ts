import { PlannerDriver, type PlanSource } from '../src/ai/plannerDriver';
import { CourseDriver } from '../src/ai/courseDriver';
import { COURSE_STATS } from '../src/ai/coursePlanner';
import { trackerFrom } from '../src/ai/netTracker';
import type { CarSpec } from '../src/vehicles/cars';

/**
 * The AI driver the sims use, by DRIVER:
 * - game (unset): the game's driver - plans by direction of travel (src/ai/coursePlanner.ts), the car's tracker
 *   network, the emergency brake; across the road (a crash) the plans followed plainly;
 * - course: the same plans followed by a plain pursuit (src/ai/courseDriver.ts), no network.
 */
export const DRIVER = process.env.DRIVER ?? 'game';

export type SimDriver = PlannerDriver | CourseDriver;

export function makeDriver(spec: CarSpec, source: PlanSource | null = null): SimDriver {
  if (DRIVER === 'course') {
    const c = new CourseDriver();
    c.accel = spec.ai.accel;
    c.latAccel = spec.ai.latAccel;
    return c;
  }
  const d = new PlannerDriver(source);
  d.accel = spec.ai.accel;
  d.latAccel = spec.ai.latAccel;
  d.tracker = trackerFrom(spec.ai.tracker);
  d.reset();
  return d;
}

/** Plans made since resetStats and the time they took. */
export function planStats(): string {
  const st = COURSE_STATS;
  const n = st.normal + st.relaxed + st.fallback;
  return `${DRIVER} plans ${n} (relaxed ${st.relaxed}, fallback ${st.fallback}), ${(st.ms / Math.max(1, n)).toFixed(1)} ms a plan (slowest ${st.slowest.toFixed(0)})`;
}

export function resetStats(): void {
  Object.assign(COURSE_STATS, { normal: 0, relaxed: 0, fallback: 0, ms: 0, slowest: 0 });
}
