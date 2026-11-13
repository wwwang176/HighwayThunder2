import { KMH, LANE_COUNT, LANE_WIDTH, RAIL_D, ROAD_HALF_WIDTH } from '../config';
import { laneAt, laneCenter } from '../road/coords';
import type { TrafficBox } from './sensors';
import { STREET_RACER } from '../vehicles/cars/streetRacer';

/**
 * Planner settings (mutable: tuned while testing).
 * The plan is a lattice in time × lateral position × speed: lateral positions
 * every quarter lane across the whole paved road (lanes, the lines between
 * them, the shoulders), so a turning point can be anywhere - the gap between
 * two cars side by side included. Every `step` seconds the car may move up to
 * half a lane sideways (one lane a second, three lanes in three seconds on a
 * diagonal) and change speed within what the car can do.
 */
export const PLANNER = {
  // s between plan points. Default: 0.25 s on eighth lanes, sideways moves limited only by the car's grip
  // (latGrip 1), steered by the trained network (DRIVER_TUNING.netTracker) - 30 x 5 km with a crash putting it
  // back at 60 km/h: 98.3 s, 10 resets (the plain tracker: 100.2 s, 15). The panel's Plan grid has the earlier
  // ones: 0.25 s quarter lanes at maxLateral 1 (101.8 s, 25), the 0.5 s grid (101.1 s, 2).
  step: 0.25,
  horizon: 8, // s looked ahead (~650 m at 300 km/h)
  speedCell: 2, // m/s: speeds closer than this count as the same state
  /** Value of speed at the end of the plan: metres per m/s (s it would keep going). */
  endSpeedValue: 2,
  /** Cost of a sideways move (m of progress), so it does not weave for nothing. */
  lateralCost: 0, // 0 (with lineCost 0.3): 15 benchmark runs 106.5 -> 105.6 s, crashes 3 -> 0 - it starts its diagonals sooner
  /**
   * Cost (m) per m/s of speed shed: braking is a last resort - it would rather
   * slip past at speed than brake, wait and then change lanes (street racing).
   */
  brakeCost: 0, // off: at 1.5 the benchmark got no faster (140-151 km/h) and crashed once
  /**
   * Cost per plan point (m) of being off a lane centre (between lanes, splitting
   * two cars): fine when it pays, but not where to cruise - with only an end
   * cost the car spent 80 % of the time on the lines, where traffic coming up
   * behind does not give way to it.
   */
  lineCost: 0.3, // 0: back on the lines 80 % of the time (106.9 s, a crash); 0.15: 106.4 s, a crash
  /**
   * Bonus per plan point (m) for being where the last plan was at that moment:
   * a new plan has to be clearly better to change course (no flip-flopping
   * between two equally good lanes, which left the car straddling the line).
   */
  keepCourseBonus: 1.5,
  /** Room kept to what is ahead: this much plus `headway` seconds of the own speed (right on the bumper). */
  gapAhead: 0, // with headway 0.05, swingMargin 0.05, trackerLead 0.15: 30 benchmark runs 103.4 -> 101.0 s (3 crashed, 2 before)
  headway: 0.05,
  /**
   * Room (m, bumper to bumper) left to what is behind when moving in front of
   * it, plus its closing speed × `cutInTime`. Next to nothing: in the game
   * traffic coming up behind brakes for a car cutting in - a street racer goes
   * the moment the gap is its own length. Raise both for a more considerate driver.
   */
  gapBehind: 0.3,
  cutInTime: 0,
  /**
   * Sideways room kept to other vehicles (each side): the tracker's measured
   * error (p95, 0.75 s after a plan) is 0.18 m holding a line and 0.45 m moving
   * sideways (`swingMargin` adds the difference on the side it moves
   * toward). Not less alongside a car at its speed either: with no room it sat
   * touching one for seconds (a crash past FITNESS.maxContactTime). So it splits
   * two cars side by side only where they leave 2.3 m (the car is 1.86) - two
   * cars centred in their lanes leave 1.9 m.
   */
  sideMargin: 0.15, // with the 0.25 s grid: 30 runs (crash = reset) 48 -> 33 resets, 102.6 -> 101.6 s (0.5 s grid: 0.05)
  /**
   * m extra room on the side the car is moving toward, and still for the step
   * after the move ends (it swings a little past): with `sideMargin`, the
   * measured p95 tracking error while moving sideways (0.45 m).
   */
  swingMargin: 0.1, // per SWING_PER (3.75 m/s) sideways: a quarter lane a step on the 0.25 s grid (0.5 s grid: 0.1, as 0.05 per its cell)
  /** Hardest braking it plans with, and assumes for the room to slow down to a car ahead, with no PlanEgo.brake table. */
  hardBrake: 11, // m/s² (10: the benchmark was ~3 km/h slower)
  softBrake: 3,
  /**
   * Drive on the shoulders too. Off: they are always empty, so the planner
   * would race the whole way down a shoulder instead of through the traffic.
   */
  useShoulders: false,
  /**
   * How far past the paved road's edge (off the shoulders) the car may plan, as a part of its half width:
   * 1 - its centre on the edge line, half the car on the shoulder. 0: all of it on the road - which left
   * the outermost plan positions 0.47 m beyond the outer lane centres (the cell under the 0.9 m there was),
   * so in practice it went no further out than the outer lanes' centres, and a slow car in an outer lane
   * could not be squeezed past on its outside.
   */
  pastEdge: 1,
  /**
   * Most cells (quarter lanes) moved sideways per step. 1: a lane in 2 s. 3:
   * 5.6 m/s, about the most the car does (a lane in 0.7 s at full lock) - the
   * lattice then tells lateral speeds apart. 3 (with maxLateralChange 2, beam
   * 250): 15 benchmark runs 104.7 -> 102.1 s, none crashed (swingMargin grows
   * with the speed sideways; with 0.1 m whatever the speed two crashed).
   */
  maxLateral: 6, // eighth lanes: 11 m/s - in effect no limit, the grip (latGrip) is
  /** Most change in the sideways move from one step to the next (cells per step), with maxLateral > 1: a swing one way, then hard the other. */
  maxLateralChange: 2,
  /** Lateral positions per lane width (4: quarter lanes). Finer cells tell slower sideways speeds and gentler changes apart. */
  cellsPerLane: 8,
  /**
   * Sideways acceleration the plan may ask for, as a fraction of what the car
   * holds at full steering at that speed (PlanEgo.latAccel, measured on the
   * car): the change in sideways move from one step to the next (and from the
   * car's own sideways speed into the first) is limited by it instead of by
   * `maxLateralChange` - plans the car can follow, whatever its sideways speed.
   * 0: off. (0.85: 100.3 s, 24 resets; 1: 100.7 s, 21 - both with the plain tracker, before the side-hug fix.)
   */
  latGrip: 1,
  /**
   * Nodes kept per step, the most promising (progress so far plus the value of
   * the speed): with sideways speeds in the state the lattice grows several
   * times over (950 ms a plan with all of them, 32 ms with 250 - and as far). 0: keep all.
   */
  beam: 250,
  /**
   * Look behind before moving over: keep clear of where traffic coming up from
   * behind will be (`gapBehind`, `cutInTime`). Off: what is wholly behind is
   * not looked at - it brakes for us (street racing). A car alongside always counts.
   */
  lookBehind: false,
  /**
   * Moving sideways the car is where its diagonal puts it at each moment of the
   * step. Off: it takes up the whole width it sweeps for the whole step (half a
   * second), so it can not cut in right after passing a car or slip out just
   * before reaching one - it lifted and moved over beside it instead.
   */
  diagonal: true,
  /** Moving sideways the body points along its diagonal: checked lengthwise piece by piece (nose over first). Off: lined up with the lanes. */
  turnedBody: true,
  /**
   * s ahead on the plan the tracker aims (PlannerDriver) and so cuts the corners:
   * a move sideways is only planned where that lane is clear this much earlier too.
   */
  trackerLead: 0.15, // 0.3 left no room in a gap little over the car's length (the cut-in had to be 0.3 s clear)
  /**
   * ...but cutting in ahead of the car it is passing (behind it, slower by less than passedDv m/s) only this
   * early: it falls back, the lead only kept the cut-in waiting a car's length (two cars side by side a few
   * metres apart were not passed). 60-race benches, three cars: 0.9 s faster, 22 -> 28 resets.
   */
  passedLead: 0,
  passedDv: 25, // 90 km/h: past ordinary traffic (more slower than that) the full lead is kept
  /**
   * A car ahead needs only the room to steer clear of it, not to brake down to
   * its speed, whenever the car can get out of its way sideways: holding a line
   * that only clips its side (e.g. swung out past the car being overtaken, the
   * next lane's car ahead), or pulling out from dead behind it. At a closing
   * speed over ~85 km/h steering out takes less room than braking. Off: only
   * while already moving away from one off to the side.
   * Benchmark (15 runs): ~6 s faster over 5 km, but a car that changes lanes
   * into the way it steers out to is then too close to brake for: 2-3 crashed
   * (with the lane costs cut since: none in 15).
   * Street racing - the others look out for themselves.
   */
  steerClear: true,
  /**
   * s the last plan may be old to be taken up again when no plan is found from where the car is: searched again
   * from where that plan has it now (its sideways position, speed and move), against the traffic as it is now.
   * The car is never quite on its plan (and its sideways speed lags the plan's), and from a little off it a move
   * half done - pulling out past a car - could find no way on: the fallback then braked toward the nearest lane
   * centre, back behind the car it was pulling out from (most of the crashes with nothing changed in the traffic).
   * 0: off.
   */
  reuseAge: 0.75,
  /**
   * Room (m, body to body) it would like beside a vehicle it is level with, and the cost (m of progress per m short,
   * per plan point) of less: it swings out wider passing when that is cheap - starts its move sooner, goes a little
   * further out - instead of brushing past by `sideMargin`. (Passing with less than the emergency brake's pathMargin
   * the brake did not believe the plan: a third of the braking alongside.) 0: off. 1 (60 races each, against 0):
   * street racer 95.8 -> 93.5 s (paired -2.28 +- 0.49), resets 11 -> 6; muscle car 94.5 -> 94.0, 18 -> 21; JDM
   * 99.0 -> 98.7, 12 -> 10. Of 10 tight passes picked from a race, 7 got 0.4-0.5 m more room, none any slower;
   * passes on alternate sides make a gentle S (0.2-0.5 m), inside the lane.
   */
  passRoom: 0.5,
  passCost: 1,
};

/** Half the planned car's length and width (m): `plan` sets them from its ego (default: the street racer's). */
let egoHalfL = 2.2;
let egoHalfW = 0.93;
/** The planned car's full-brake table (PlanEgo.brake): `plan` sets it (none: PLANNER.hardBrake). */
let egoBrake: AccelTable | undefined;
/** A car merging into the held lane this close (m, beyond touching) waits for it in the game. */
const MERGE_YIELD = 5;
/** m around a step's positions beyond which nothing can touch: half our length, margins and a closing speed's worth. */
const NEAR_MARGIN = 40;
/** m off a lateral position that still counts as on it (the car is never exactly on a cell). */
const ON_CELL = 0.3;

/** Lateral positions: `perLane` cells a lane across the lanes (the car's body on them), or out to the shoulders too. */
class Grid {
  readonly cell: number; // m
  readonly edge: number; // cells beyond the outer lane centres
  readonly first: number;
  readonly cells: number;
  constructor(
    shoulders: boolean,
    readonly perLane: number,
  ) {
    this.cell = LANE_WIDTH / perLane;
    // Furthest out the car's centre may be.
    const out = shoulders ? RAIL_D - 0.3 - egoHalfW : ROAD_HALF_WIDTH - egoHalfW * (1 - PLANNER.pastEdge);
    this.edge = Math.max(0, Math.floor((out - laneCenter(LANE_COUNT - 1)) / this.cell + 1e-9));
    this.first = laneCenter(0) - this.edge * this.cell;
    this.cells = perLane * (LANE_COUNT - 1) + 1 + 2 * this.edge;
  }
  d(c: number): number {
    return this.first + c * this.cell;
  }
  nearest(d: number): number {
    return Math.max(0, Math.min(this.cells - 1, Math.round((d - this.first) / this.cell)));
  }
  isLaneCentre(c: number): boolean {
    const k = c - this.edge;
    return k >= 0 && k % this.perLane === 0 && k / this.perLane < LANE_COUNT;
  }
}
const grids = new Map<string, Grid>();
function gridFor(shoulders: boolean, perLane: number): Grid {
  const k = `${shoulders}/${perLane}/${egoHalfW}/${PLANNER.pastEdge}`; // the edge cells leave room for the car's width
  let g = grids.get(k);
  if (!g) grids.set(k, (g = new Grid(shoulders, perLane)));
  return g;
}
/** Sideways moves per step, in cells: 0, -1, 1, -2, 2 ... up to the most any setting allows (PLANNER.maxLateral picks). */
const MAX_MOVE = 24;
const MOVES = [0, ...Array.from({ length: MAX_MOVE }, (_, i) => [-(i + 1), i + 1]).flat()];
/** m/s sideways `swingMargin` is given for (a lane a second). */
const SWING_PER = 3.75;

/**
 * Most change in the sideways move from one step to the next (cells per
 * step) at speed `v`: what `latGrip` of the car's cornering grip gives (at
 * least 1), or `maxLateralChange` (with maxLateral > 1; otherwise none).
 */
export function lateralTurn(v: number, dt: number, cell: number, latAccel?: AccelTable): number {
  const P = PLANNER;
  if (P.latGrip > 0) return Math.max(1, Math.floor((P.latGrip * maxAccel(v, latAccel ?? STREET_RACER.ai.latAccel) * dt * dt) / cell + 1e-6));
  return P.maxLateral > 1 ? P.maxLateralChange : Infinity;
}

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
  /** Its course there (rad off the road's heading, + toward +d): plans made by direction of travel (coursePlanner) only. */
  psi?: number;
}

export interface Plan {
  points: PlanPoint[];
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
  /** Its cornering grip, sideways m/s² at full steering (default: the street racer's): PLANNER.latGrip. */
  latAccel?: AccelTable;
  /** Its full-brake deceleration by speed (CarSpec.ai.brake); none: PLANNER.hardBrake at every speed. */
  brake?: AccelTable;
  /** Half its body's width and length (m; default: the street racer's, 0.93 x 2.2). */
  halfWidth?: number;
  halfLength?: number;
  /** Its nose off the road's heading (rad, + toward +d) and its sideways speed off its nose (m/s, + to its right): plans by direction of travel only. */
  yaw?: number;
  vLat?: number;
  /** The tightest it can turn on its steering lock (1/m: tan(maxSteer) / wheelbase): plans by direction of travel only. */
  turnMax?: number;
}

interface Node {
  s: number;
  v: number;
  cell: number;
  d: number;
  score: number; // progress so far minus costs
  parent: Node | null;
  /** Sideways move that led here (cells per step, signed). */
  lat: number;
}

/** How plans came out (normal search / relaxed replan / from the last plan's state / boxed-in fallback): for benchmarks. */
export const PLAN_STATS = { normal: 0, relaxed: 0, reused: 0, fallback: 0, ms: 0, slowest: 0 };

/**
 * The fastest way through the traffic for the next `horizon` seconds, assuming
 * every vehicle keeps its speed and lane (an NPC about to change lanes holds its
 * target lane too). When nothing gets through, the furthest reachable spot is
 * right behind the fastest car ahead - so it tailgates the one most likely to
 * open a gap, and the next plan (a fraction of a second later) takes the gap.
 *
 * While the car holds a lane, traffic behind it there and cars merging into it
 * from alongside are ignored: in the game they brake / wait for the player (and
 * in training they do not count as a crash). Moving sideways in front of
 * traffic is never ignored.
 *
 * If no first step is clear (something already too close), it plans again
 * without following / cut-in gaps and ignoring what is wholly behind; then (`reuseAge`) from where the last plan
 * has the car now; if even that fails it heads for the nearest lane centre braking hard - never frozen between
 * two lanes.
 */
export function plan(ego: PlanEgo, traffic: TrafficBox[], previous: PreviousPlan | null = null): Plan {
  const t0 = performance.now();
  const p = planned(ego, traffic, previous);
  const ms = performance.now() - t0;
  PLAN_STATS.ms += ms;
  PLAN_STATS.slowest = Math.max(PLAN_STATS.slowest, ms);
  return p;
}

function planned(ego: PlanEgo, traffic: TrafficBox[], previous: PreviousPlan | null): Plan {
  egoHalfW = ego.halfWidth ?? 0.93;
  egoHalfL = ego.halfLength ?? 2.2;
  egoBrake = ego.brake;
  // Only what can matter within the horizon.
  const reachAhead = ego.s + Math.max(ego.v, ego.speedCap) * PLANNER.horizon + 50;
  // Street racing does not look back: what is wholly behind (its nose behind our tail) brakes for us,
  // so it is left out of the whole plan - not predicted to drive on into us. (Plans come every 0.25 s:
  // one that does get alongside is in the next.)
  const behind = (t: TrafficBox) => t.s + t.length / 2 < ego.s - egoHalfL;
  const boxes = traffic.filter((t) => t.s < reachAhead && t.s > ego.s - 150 && (PLANNER.lookBehind || !behind(t)));
  const merging = new Set<number>();
  for (const t of boxes) if (t.phantom && t.id !== undefined) merging.add(t.id);
  const normal = search(ego, boxes, merging, previous, false);
  if (normal) PLAN_STATS.normal++;
  let found = normal ?? search(ego, boxes, merging, previous, true);
  if (!normal && found) PLAN_STATS.relaxed++;
  if (!found && previous && previous.age <= PLANNER.reuseAge) {
    const was = planAt(previous.plan, previous.age);
    const onIt: PlanEgo = { ...ego, d: was.d, v: was.v, vD: was.dRate };
    found = search(onIt, boxes, merging, previous, false) ?? search(onIt, boxes, merging, previous, true);
    if (found) PLAN_STATS.reused++;
  }
  if (!found) PLAN_STATS.fallback++;
  if (found) return found;
  const dt = PLANNER.step;
  const v = Math.max(0, ego.v - maxBrake(ego.v, ego.brake) * dt);
  return {
    points: [
      { t: 0, s: ego.s, d: ego.d, v: ego.v },
      { t: dt, s: ego.s + ((ego.v + v) / 2) * dt, d: laneCenter(laneAt(ego.d)), v },
    ],
  };
}

/**
 * The best path, or null when not even a first step is clear. `relaxed`: no
 * following / cut-in gaps and nothing wholly behind counts - but the side room
 * (the tracker's real error) and the room to brake down to a car's speed stay:
 * relaxed without them, it slid in 2 cm beside a car and touched it at 17 km/h.
 * Except for what is alongside inside that side room right now (it cannot be
 * made instantly - the swing room counted too): that only must not come any
 * closer than it is, so one already rubbing the car's side is no wall either.
 * (Without that, a car hugging ours left it no plan at all: a brake toward the
 * lane centre and nothing ahead.)
 */
function search(ego: PlanEgo, boxes: TrafficBox[], merging: Set<number>, previous: PreviousPlan | null, relaxed: boolean): Plan | null {
  const P = PLANNER;
  const steps = Math.round(P.horizon / P.step);
  const dt = P.step;
  const grid = gridFor(P.useShoulders, P.cellsPerLane);
  // Relaxed: what is wholly behind the car does not count (what is alongside still does).
  if (relaxed) boxes = boxes.filter((t) => t.s + t.length / 2 > ego.s - egoHalfL);
  const margin = relaxed ? 0 : 1;
  // Alongside within the side room: how far into the car's own width it reaches now (signed: - on its left).
  const tight = new Map<TrafficBox, number>();
  if (relaxed) {
    const room = P.sideMargin + swingFor(P.maxLateral, grid.cell, dt) + 0.01;
    for (const t of boxes)
      if (Math.abs(t.s - ego.s) < egoHalfL + t.length / 2 && t.dMax > ego.d - egoHalfW - room && t.dMin < ego.d + egoHalfW + room) {
        const left = t.dMin + t.dMax < 2 * ego.d;
        const overlap = left ? t.dMax - (ego.d - egoHalfW) : ego.d + egoHalfW - t.dMin;
        const beside = t.dMax < ego.d || t.dMin > ego.d; // rubbing a side, not dead ahead or behind (that is a crash)
        const into = beside && overlap > 0 ? overlap + 0.02 : 0;
        tight.set(t, left ? -into : into);
      }
  }

  let layer = new Map<number, Node>();
  const lat = Math.max(-P.maxLateral, Math.min(P.maxLateral, ((ego.vD ?? 0) * dt) / grid.cell));
  const start: Node = { s: ego.s, v: ego.v, cell: grid.nearest(ego.d), d: ego.d, score: 0, parent: null, lat };
  layer.set(key(start.cell, start.v, start.lat), start);
  let deepest: Node[] = [start];

  for (let k = 0; k < steps; k++) {
    const t0 = k * dt;
    const next = new Map<number, Node>();
    const wasD = previous ? planAt(previous.plan, previous.age + t0 + dt).d : null;
    // Only boxes that can be near any of this step's nodes (the rest are far ahead or behind).
    let sLo = Infinity;
    let sHi = -Infinity;
    for (const n of layer.values()) {
      sLo = Math.min(sLo, n.s);
      sHi = Math.max(sHi, n.s + n.v * dt + maxAccel(n.v, ego.accel) * dt * dt);
    }
    const near = boxes.filter((t) => {
      const lo = Math.min(t.s + t.v * t0, t.s + t.v * (t0 + dt)) - t.length / 2;
      const hi = Math.max(t.s + t.v * t0, t.s + t.v * (t0 + dt)) + t.length / 2;
      return hi > sLo - NEAR_MARGIN && lo < sHi + NEAR_MARGIN;
    });
    // ...and by lateral position: each cell lists the boxes that can touch a car there (with every margin).
    const byCell: TrafficBox[][] = Array.from({ length: grid.cells }, () => []);
    const reachSide = egoHalfW + P.sideMargin + swingFor(P.maxLateral, grid.cell, dt) + ON_CELL;
    for (const t of near) {
      const c0 = Math.max(0, grid.nearest(t.dMin - reachSide) - 1);
      const c1 = Math.min(grid.cells - 1, grid.nearest(t.dMax + reachSide) + 1);
      for (let c = c0; c <= c1; c++) if (t.dMax > grid.d(c) - reachSide && t.dMin < grid.d(c) + reachSide) byCell[c].push(t);
    }
    // ...and those within `passRoom` of a car there (`passCost`).
    const wide = P.passCost > 0 ? egoHalfW + P.passRoom + ON_CELL : 0;
    const passing: TrafficBox[][] | null = P.passCost > 0 ? Array.from({ length: grid.cells }, () => []) : null;
    if (passing)
      for (const t of near) {
        const c0 = Math.max(0, grid.nearest(t.dMin - wide) - 1);
        const c1 = Math.min(grid.cells - 1, grid.nearest(t.dMax + wide) + 1);
        for (let c = c0; c <= c1; c++) if (t.dMax > grid.d(c) - wide && t.dMin < grid.d(c) + wide) passing[c].push(t);
      }
    for (const n of layer.values()) {
      const top = maxAccel(n.v, ego.accel);
      const accels = [top, top / 2, top / 4, 0, -P.softBrake / 2, -P.softBrake, -maxBrake(n.v, ego.brake)];
      const turn = lateralTurn(n.v, dt, grid.cell, ego.latAccel);
      for (const move of MOVES) {
        if (Math.abs(move) > P.maxLateral || Math.abs(move - n.lat) > turn + 0.01) continue;
        const cell = n.cell + move;
        if (cell < 0 || cell >= grid.cells) continue;
        const d = grid.d(cell);
        // The same for every speed: what the move and where it ends cost.
        const moveCost = move !== 0 ? P.lateralCost : 0;
        const lineCost = grid.isLaneCentre(cell) ? 0 : P.lineCost;
        const onCourse = wasD !== null && Math.abs(d - wasD) < LANE_WIDTH / 4;
        const keyBase = cell * 1000;
        for (const a of accels) {
          const v = Math.max(0, Math.min(ego.speedCap, n.v + a * dt));
          const s = n.s + ((n.v + v) / 2) * dt;
          let score = n.score + (s - n.s) - moveCost - lineCost - P.brakeCost * Math.max(0, n.v - v);
          if (onCourse) score += P.keepCourseBonus;
          if (passing && passing[cell].length) score -= passShort(passing[cell], d, s, t0 + dt);
          const kk = (keyBase + Math.round(v / P.speedCell)) * LAT_KEYS + latKey(move);
          const old = next.get(kk);
          if (old && score <= old.score) continue; // something as good gets there already: no need to check this way is clear
          if (
            collides(n, d, v, t0, dt, byCell[n.cell], move, merging, margin, grid, tight) ||
            (move !== 0 && collides(n, d, v, t0, dt, byCell[cell], move, merging, margin, grid, tight, byCell[n.cell]))
          )
            continue;
          next.set(kk, { s, v, cell, d, score, parent: n, lat: move });
        }
      }
    }
    if (next.size === 0) break;
    deepest = [...next.values()];
    if (P.beam > 0 && deepest.length > P.beam) {
      // Keep the most promising: as the plan's own end is valued (progress plus what the speed is worth).
      deepest.sort((a, b) => b.score + P.endSpeedValue * b.v - (a.score + P.endSpeedValue * a.v));
      deepest.length = P.beam;
      next.clear();
      for (const n of deepest) next.set(key(n.cell, n.v, n.lat), n);
    }
    layer = next;
  }

  let best: Node | null = null;
  let bestValue = -Infinity;
  for (const n of deepest) {
    const value = n.score + P.endSpeedValue * n.v;
    if (value > bestValue) {
      bestValue = value;
      best = n;
    }
  }
  const chain: Node[] = [];
  for (let n = best; n; n = n.parent) chain.push(n);
  chain.reverse();
  if (chain.length === 1) return null;
  return { points: chain.map((n, i) => ({ t: i * dt, s: n.s, d: n.d, v: n.v })) };
}

/** Where the plan is `t` seconds after it was made (between points: linear), and how fast it moves sideways there. */
export function planAt(p: Plan, t: number): PlanPoint & { dRate: number } {
  const pts = p.points;
  const step = pts.length > 1 ? pts[1].t - pts[0].t : PLANNER.step; // its own (the setting may have changed since)
  const k = Math.min(pts.length - 2, Math.max(0, Math.floor(t / step)));
  const a = pts[k];
  const b = pts[k + 1] ?? a;
  const span = b.t - a.t;
  const u = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
  const dRate = span > 0 && t < b.t ? (b.d - a.d) / span : 0;
  return { t, s: a.s + (b.s - a.s) * u, d: a.d + (b.d - a.d) * u, v: a.v + (b.v - a.v) * u, dRate };
}

/** A node's state: cell, speed and (when the sideways change is limited) sideways move. */
const key = (cell: number, v: number, lat: number) => (cell * 1000 + Math.round(v / PLANNER.speedCell)) * LAT_KEYS + latKey(lat);
const LAT_KEYS = 2 * MAX_MOVE + 1;
const latKey = (lat: number) => (PLANNER.maxLateral > 1 || PLANNER.latGrip > 0 ? Math.round(lat) + MAX_MOVE : 0);

/** m of `swingMargin` room for moving `cells` a step sideways (it is given per SWING_PER m/s). */
function swingFor(cells: number, cell: number, dt: number): number {
  return (PLANNER.swingMargin * Math.abs(cells) * cell) / dt / SWING_PER;
}

/**
 * The part [u0, u1] of a step (0..1) during which a car moving sideways
 * linearly from d0 to d1 overlaps the band (lo, hi) of its centre positions,
 * or null if it never does.
 */
export function crossing(d0: number, d1: number, lo: number, hi: number): [number, number] | null {
  return crossingInto(d0, d1, lo, hi) ? [CROSS.u0, CROSS.u1] : null;
}

/** `crossing` without making an array (it runs ~10^5 times a plan): the part is left in CROSS. */
const CROSS = { u0: 0, u1: 0 };
function crossingInto(d0: number, d1: number, lo: number, hi: number): boolean {
  if (d0 === d1) {
    if (!(d0 > lo && d0 < hi)) return false;
    CROSS.u0 = 0;
    CROSS.u1 = 1;
    return true;
  }
  let u0 = (lo - d0) / (d1 - d0);
  let u1 = (hi - d0) / (d1 - d0);
  if (u0 > u1) {
    const x = u0;
    u0 = u1;
    u1 = x;
  }
  u0 = Math.max(0, u0);
  u1 = Math.min(1, u1);
  if (!(u0 < u1)) return false;
  CROSS.u0 = u0;
  CROSS.u1 = u1;
  return true;
}

/** Where a car at (s, v) accelerating at `accel` is a fraction u of a step dt on (before it: at its starting speed). */
function sAt(s: number, v: number, accel: number, dt: number, u: number): number {
  return s + v * u * dt + (u > 0 ? 0.5 * accel * (u * dt) ** 2 : 0);
}

/**
 * Whether moving from node `n` to (d1, v1) over [t0, t0 + dt] touches any
 * box, kept apart by the planner's margins. Checked over the whole interval: a
 * box passed between two plan points (relative position changed sign) is hit.
 * Moving sideways the car goes diagonally (straight from one plan point to the
 * next), so a box only counts for the part of the step the car is level with
 * it: it may cut in right in front of a car it has just passed, or slip out
 * from behind one just before it gets there - not wait a whole step for that.
 */
function collides(
  n: Node,
  d1: number,
  v1: number,
  t0: number,
  dt: number,
  boxes: TrafficBox[],
  move: number,
  merging: Set<number>,
  margin: number,
  grid: Grid,
  tight: Map<TrafficBox, number>,
  skip: TrafficBox[] | null = null,
): boolean {
  const P = PLANNER;
  const sideways = move !== 0 || Math.abs(n.d - d1) > ON_CELL;
  // Extra room toward where it is heading sideways (this step's move, or the one just ended): it swings past.
  const heading = move !== 0 ? move : n.lat;
  const swing = swingFor(heading, grid.cell, dt); // more the faster it moves (the tracker swings further past)
  const accel = (v1 - n.v) / dt;
  const inLane = !sideways && grid.isLaneCentre(n.cell);
  // Moving sideways the body points along its diagonal (`turnedBody`): the nose already over toward where it
  // goes, the tail still back where it came from. Checked as `pieces` lengthwise slices, each where that part
  // of the body is - so it can cut through a gap barely its own length between a car ahead and one in the next
  // lane, nose first (lined up with the lanes it would need room for the whole car at once).
  const slope = P.turnedBody && sideways ? (d1 - n.d) / (dt * Math.max(5, (n.v + v1) / 2)) : 0;
  const pieces = Math.min(5, Math.max(1, Math.ceil((Math.abs(slope) * 2 * egoHalfL) / 0.1)));
  const halfL = egoHalfL / pieces;
  const halfW = egoHalfW + halfL * Math.abs(slope);
  // Swerving away sideways, it closes the overlap at this speed (m/s).
  const awaySpeed = (Math.max(1, Math.abs(move)) * grid.cell) / dt;
  for (const t of boxes) {
    if (skip !== null && skip.includes(t)) continue; // checked already (the move's other cell)
    // Already inside the side room: no side room, and no closer than it reaches into ours now (- on our left).
    const into = tight.get(t);
    const side = into === undefined ? 1 : 0;
    const reach = halfL + egoHalfW * Math.abs(slope) + t.length / 2; // a turned body's corners poke ahead (and back) of its piece
    for (let j = 0; j < pieces; j++) {
      const along = -egoHalfL + (2 * j + 1) * halfL; // this piece's centre, from ours
      const off = along * slope; // ...and how far it is over sideways
      // Centre positions where this piece is level with it (with the side room).
      const lo = t.dMin - halfW - off - (P.sideMargin + (heading > 0 ? swing : 0)) * side + Math.max(0, into ?? 0);
      const hi = t.dMax + halfW - off + (P.sideMargin + (heading < 0 ? swing : 0)) * side + Math.min(0, into ?? 0);
      let u0 = 0;
      let u1 = 1;
      if (P.diagonal) {
        if (!crossingInto(n.d, d1, lo, hi)) continue;
        u0 = CROSS.u0;
        u1 = CROSS.u1;
      } else if (!(Math.max(n.d, d1) > lo && Math.min(n.d, d1) < hi)) continue;
      const r0 = t.s + t.v * (t0 + u0 * dt) - (sAt(n.s, n.v, accel, dt, u0) + along); // box centre relative to this piece
      const r1 = t.s + t.v * (t0 + u1 * dt) - (sAt(n.s, n.v, accel, dt, u1) + along);
      if (inLane && r0 < 0 && r1 < 0 && t.dMin < n.d && t.dMax > n.d) continue; // behind us in our lane: it brakes for us (traffic, and racers are drivers too)
      // Merging in alongside or from behind: it waits for us (in the game). Merging in ahead: let it in.
      if (inLane && t.id !== undefined && merging.has(t.id) && r0 < egoHalfL && r0 > -(reach + MERGE_YIELD)) continue;
      if (Math.sign(r0) !== Math.sign(r1)) return true; // passed through it
      const va = n.v + accel * Math.max(0, u0) * dt;
      const vb = n.v + accel * Math.max(0, u1) * dt;
      let rEarly: number | null = null;
      if (sideways && t.dMax > d1 + off - halfW && t.dMin < d1 + off + halfW) {
        // Moving toward it: the car gets level with it up to trackerLead s early, so where it was then counts too
        // (only stricter for one being passed - it was still alongside - braking does not help a sideswipe;
        // passedLead for the slower one behind it, the one it cuts in ahead of).
        const uEarly = u0 - (r0 < 0 && r1 < 0 && t.v < Math.min(va, vb) && Math.min(va, vb) - t.v < P.passedDv ? P.passedLead : P.trackerLead) / dt;
        rEarly = t.s + t.v * (t0 + uEarly * dt) - (sAt(n.s, n.v, accel, dt, uEarly) + along);
        if (Math.sign(rEarly) !== Math.sign(r0)) return true;
      }
      if (r0 >= 0) {
        // Ahead: right on the bumper, but never closer than it takes to brake down to its speed - without this
        // the plan closed in fast up to the last moment and the emergency brake did the braking (all five
        // benchmark runs crashed with the emergency brake held back past the plan's own hardest braking).
        // Each end of the step with its own speed: checking the end with the speed before braking made it
        // start braking half a second (~15 m at 200 km/h) early.
        // Which way the car can steer clear of it (+1 / -1): away from the side it is on, or (`steerClear`) the
        // way the car is moving when it is dead ahead.
        const away = t.dMax < n.d + off ? 1 : t.dMin > n.d + off ? -1 : P.steerClear ? Math.sign(move) : 0;
        // ...and only where the road goes on that way far enough to get clear of it (not off the edge).
        const clearAt = (away > 0 ? t.dMax + P.sideMargin + halfW : t.dMin - P.sideMargin - halfW) - off;
        const roomThere = away !== 0 && (away > 0 ? clearAt <= grid.d(grid.cells - 1) : clearAt >= grid.d(0));
        const swerving = roomThere && (move !== 0 ? Math.sign(move) === away : P.steerClear);
        // Moving away from it sideways (or only clipping its side, `steerClear`): it only has to stay ahead
        // until the car is clear of it - swerve out at speed instead of braking to its speed first (keeps
        // going sideways or the next step fails).
        const overlap = !swerving ? 0 : away > 0 ? t.dMax + P.sideMargin - (d1 + off - halfW) : d1 + off + halfW - (t.dMin - P.sideMargin);
        const roomA = aheadRoom(va, t.v, reach, swerving, overlap, awaySpeed, margin);
        if (r0 < roomA || r1 < aheadRoom(vb, t.v, reach, swerving, overlap, awaySpeed, margin) || (rEarly !== null && rEarly < roomA)) return true;
      } else {
        const behind = reach + (P.gapBehind + P.cutInTime * Math.max(0, t.v - Math.min(va, vb))) * margin;
        const r = Math.min(-r0, -r1, rEarly !== null ? -rEarly : Infinity);
        if (r < behind) return true;
      }
    }
  }
  return false;
}

/** `passCost` for a plan point at (d, s) `t` s on: what it is short of `passRoom` beside the boxes it is level with. */
function passShort(boxes: TrafficBox[], d: number, s: number, t: number): number {
  const P = PLANNER;
  let cost = 0;
  for (const b of boxes) {
    if (Math.abs(b.s + b.v * t - s) > b.length / 2 + egoHalfL) continue; // not level with it
    const gap = d > (b.dMin + b.dMax) / 2 ? d - egoHalfW - b.dMax : b.dMin - (d + egoHalfW);
    if (gap < P.passRoom) cost += P.passCost * (P.passRoom - Math.max(0, gap));
  }
  return cost;
}

/** Room (m, centre to piece) kept to a box ahead at speed v - braking down to its speed, or (swerving) only until clear of it. */
function aheadRoom(v: number, tv: number, reach: number, swerving: boolean, overlap: number, awaySpeed: number, margin: number): number {
  const P = PLANNER;
  const closing = Math.max(0, v - tv);
  // (Braking from v down to its speed: the car's deceleration halfway down, the table's middle of that run.)
  let keep = (closing * closing) / (2 * maxBrake(v - closing / 2, egoBrake)) + P.headway * v * margin;
  if (swerving) keep = Math.min(keep, closing * (Math.max(0, overlap) / awaySpeed));
  return reach + keep + P.gapAhead * margin;
}
