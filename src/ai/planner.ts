import { KMH } from '../config';
import { STREET_RACER } from '../vehicles/cars/streetRacer';

/** The AI's plans: their shape, the car they are made for, and the settings the planner and its driver share. */

/** Settings the plans and the driver following them share (mutable: tuned in the debug panel, sent to the plan worker). */
export const PLANNER = {
  /** Value of speed at the end of the plan: metres per m/s (s it would keep going). */
  endSpeedValue: 2,
  /**
   * Cost per plan point (m) of being off a lane centre (between lanes, splitting
   * two cars): fine when it pays, but not where to cruise - traffic coming up
   * behind does not give way to a car on the lines.
   */
  lineCost: 0.3,
  /**
   * Bonus per plan point (m) for being where the last plan was at that moment:
   * a new plan has to be clearly better to change course (no flip-flopping
   * between two equally good lanes, which left the car straddling the line).
   */
  keepCourseBonus: 1.5,
  /** Room kept to what is ahead: `headway` seconds of the own speed on top of the room to brake (right on the bumper). */
  headway: 0.05,
  /**
   * Room (m, bumper to bumper) left to what is behind when moving in front of
   * it. Next to nothing: in the game traffic coming up behind brakes for a car
   * cutting in - a street racer goes the moment the gap is its own length.
   */
  gapBehind: 0.3,
  /**
   * Sideways room kept to other vehicles (each side): about the tracker's measured error holding a line. Not less
   * alongside a car at its speed either: with no room it sat touching one for seconds.
   */
  sideMargin: 0.15,
  /** Hardest braking it plans with, and assumes for the room to slow down to a car ahead, with no PlanEgo.brake table. */
  hardBrake: 11, // m/s² (10: the benchmark was ~3 km/h slower)
  /** Gentle braking (m/s²): what it slows by when it need not brake hard. */
  softBrake: 3,
  /**
   * Room (m, body to body) it would like beside a vehicle it is level with, and the cost (m of progress per m short,
   * per plan point) of less: it swings out wider passing when that is cheap - starts its move sooner, goes a little
   * further out - instead of brushing past by `sideMargin`. 0: off.
   */
  passRoom: 0.5,
  passCost: 1,
  /**
   * Look behind before moving over. Off: what is wholly behind is not looked at - it brakes for us (street racing).
   * A car alongside always counts.
   */
  lookBehind: false,
  /**
   * s ahead on the plan the tracker aims (PlannerDriver) and so cuts the corners:
   * a move sideways is only planned where that lane is clear this much earlier too.
   */
  trackerLead: 0.15, // 0.3 left no room in a gap little over the car's length (the cut-in had to be 0.3 s clear)
  /**
   * A car ahead needs only the room to steer clear of it, not to brake down to
   * its speed, whenever the car can get out of its way sideways: holding a line
   * that only clips its side, or pulling out from dead behind it. At a closing
   * speed over ~85 km/h steering out takes less room than braking. Off: only
   * while already moving away from one off to the side.
   * Street racing - the others look out for themselves.
   */
  steerClear: true,
};

/** A car's full-throttle acceleration (m/s²) at speeds (km/h): CarSpec.ai.accel. */
export type AccelTable = [kmh: number, accel: number][];

/** Full-throttle acceleration (m/s²) at speed `v` (m/s), from the car's table (default: the street racer). */
export function maxAccel(v: number, table: AccelTable = STREET_RACER.ai.accel): number {
  const kmh = v / KMH;
  for (let i = 1; i < table.length; i++) {
    const [k1, a1] = table[i];
    if (kmh <= k1) {
      const [k0, a0] = table[i - 1];
      return a0 + ((a1 - a0) * (kmh - k0)) / (k1 - k0);
    }
  }
  return table[table.length - 1][1];
}

/** Full-brake deceleration (m/s²) at speed `v` (m/s): from the car's table (CarSpec.ai.brake), or PLANNER.hardBrake with none. */
export function maxBrake(v: number, table?: AccelTable | null): number {
  return table ? maxAccel(v, table) : PLANNER.hardBrake;
}

export interface PlanPoint {
  t: number;
  s: number;
  d: number;
  v: number;
  /** Its course there (rad off the road's heading, + toward +d). */
  psi?: number;
}

export interface Plan {
  points: PlanPoint[];
  /** The next best ways it found (another order of lanes): shown fainter beside it. */
  alts?: PlanPoint[][];
}

/** The plan being followed, and how long ago it was made: the next plan sticks to it unless clearly better. */
export interface PreviousPlan {
  plan: Plan;
  age: number;
}

export interface PlanEgo {
  s: number;
  d: number;
  v: number;
  speedCap: number;
  /** Sideways speed (m/s, + toward +d) it has now. */
  vD?: number;
  /** Its full-throttle acceleration (default: the street racer's), boosted or not. */
  accel?: AccelTable;
  /** Its cornering grip, sideways m/s² at full steering (default: the street racer's). */
  latAccel?: AccelTable;
  /** Its full-brake deceleration by speed (CarSpec.ai.brake); none: PLANNER.hardBrake at every speed. */
  brake?: AccelTable;
  /** Half its body's width and length (m; default: the street racer's, 0.93 x 2.2). */
  halfWidth?: number;
  halfLength?: number;
  /** Its nose off the road's heading (rad, + toward +d) and its sideways speed off its nose (m/s, + to its right). */
  yaw?: number;
  vLat?: number;
  /** The tightest it can turn on its steering lock (1/m: tan(maxSteer) / wheelbase). */
  turnMax?: number;
}

/** Where the plan is `t` seconds after it was made (between points: linear), and how fast it moves sideways there. */
export function planAt(p: Plan, t: number): PlanPoint & { dRate: number } {
  const pts = p.points;
  const step = pts.length > 1 ? pts[1].t - pts[0].t : 0.25; // its own (a plan of one point: any)
  const k = Math.min(pts.length - 2, Math.max(0, Math.floor(t / step)));
  const a = pts[k];
  const b = pts[k + 1] ?? a;
  const span = b.t - a.t;
  const u = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
  const dRate = span > 0 && t < b.t ? (b.d - a.d) / span : 0;
  return { t, s: a.s + (b.s - a.s) * u, d: a.d + (b.d - a.d) * u, v: a.v + (b.v - a.v) * u, dRate };
}
