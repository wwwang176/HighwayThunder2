import { PlannerDriver, type PlanSource } from '../src/ai/plannerDriver';
import { CourseDriver, courseSource } from '../src/ai/courseDriver';
import { COURSE_STATS } from '../src/ai/coursePlanner';
import { PLAN_STATS } from '../src/ai/planner';
import { trackerFrom } from '../src/ai/netTracker';
import type { CarSpec } from '../src/vehicles/cars';

/**
 * The AI driver the sims use, by DRIVER:
 * - lattice (unset): as in the game - the lattice planner, the car's networks, the emergency brake;
 * - course-net: the same driver, its plans by direction of travel (src/ai/coursePlanner.ts);
 * - course: plans by direction of travel followed by a plain pursuit (src/ai/courseDriver.ts), no networks.
 */
export const DRIVER = process.env.DRIVER ?? 'lattice';

export type SimDriver = PlannerDriver | CourseDriver;

export function makeDriver(spec: CarSpec, source: PlanSource | null = null): SimDriver {
  if (DRIVER === 'course') {
    const c = new CourseDriver();
    c.accel = spec.ai.accel;
    c.latAccel = spec.ai.latAccel;
    return c;
  }
  const d = new PlannerDriver(DRIVER === 'course-net' ? courseSource() : source);
  d.accel = spec.ai.accel;
  d.latAccel = spec.ai.latAccel;
  d.tracker = trackerFrom(spec.ai.tracker);
  d.recovery = trackerFrom(spec.ai.recovery);
  d.reset();
  return d;
}

/** Plans made since resetStats and the time they took, for the planner the driver uses. */
export function planStats(): string {
  const st = DRIVER === 'lattice' ? PLAN_STATS : COURSE_STATS;
  const n = st.normal + st.relaxed + st.fallback;
  return `${DRIVER} plans ${n} (relaxed ${st.relaxed}, fallback ${st.fallback}), ${(st.ms / Math.max(1, n)).toFixed(1)} ms a plan (slowest ${st.slowest.toFixed(0)})`;
}

export function resetStats(): void {
  Object.assign(PLAN_STATS, { normal: 0, relaxed: 0, reused: 0, fallback: 0, ms: 0, slowest: 0 });
  Object.assign(COURSE_STATS, { normal: 0, relaxed: 0, fallback: 0, ms: 0, slowest: 0 });
}
