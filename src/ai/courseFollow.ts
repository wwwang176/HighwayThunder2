import { CarParams, steerRange } from '../vehicles/handling';
import { planAt, type Plan } from './planner';
import type { SelfState } from './sensors';

/** s ahead on the plan it steers for, and the least distance (m) it looks. */
const LEAD = 0.4;
const LEAD_MIN = 3;
/** m/s of rear wheelspin the throttle starts coming off at, and all off this much past it. */
const SPIN_FROM = 3;
const SPIN_SPAN = 6;
/** m/s: slower than this it counts as standing (the brake pedal would select reverse). */
export const STANDING = 0.5;

/**
 * Steering (-1..1) toward where the plan is LEAD s on (pure pursuit: the arc from the nose's direction through that
 * point), whatever the car's angle to the road - across it, standing, after a crash.
 */
export function followSteer(plan: Plan, age: number, self: SelfState, p: CarParams): number {
  const aim = planAt(plan, age + LEAD);
  const ds = aim.s - self.s, dd = aim.d - self.d;
  const fwd = ds * Math.cos(self.yaw) + dd * Math.sin(self.yaw);
  const right = -ds * Math.sin(self.yaw) + dd * Math.cos(self.yaw);
  const look = Math.max(LEAD_MIN, Math.hypot(fwd, right));
  const alpha = Math.atan2(right, Math.max(fwd, 0.1));
  const wheel = Math.atan((2 * p.wheelbase * Math.sin(alpha)) / look);
  return Math.max(-1, Math.min(1, wheel / steerRange(self.vLong, p)));
}

/**
 * Traction control: the throttle's share left as the rear tyres spin past their grip (flat out turning, they spun
 * 25 m/s and the tail slid out).
 */
export function tractionShare(self: SelfState): number {
  const spin = self.rearSpin ?? 0;
  return spin > SPIN_FROM ? Math.max(0, 1 - (spin - SPIN_FROM) / SPIN_SPAN) : 1;
}
