import { LANE_WIDTH, RAIL_D, ROAD_HALF_WIDTH } from '../config';
import { laneAt, laneCenter } from '../road/coords';
import type { TrafficBox } from './sensors';
import { maxAccel, maxBrake, PLANNER, planAt, type Plan, type PlanEgo, type PlanPoint, type PreviousPlan } from './planner';
import { STREET_RACER } from '../vehicles/cars/streetRacer';

/**
 * Plans by direction of travel (a prototype beside the lattice planner, planner.ts): the car's state is where it is,
 * how fast, and which way it is going (its course, off the road's heading) - and how far its nose is off that (its
 * slip, dying away). Each step it holds a turn (a share of the tightest it can take: its grip, `latAccel / v²`, or its
 * steering lock, `turnMax`, whichever is less) and a pedal (braking and turning share the grip: a friction ellipse),
 * moved along in sub-steps - its path a run of arcs, any angle to the road (across it, standing, after a crash).
 * Collisions with its body as it points (course + slip), turned, against each box. Scored as the lattice planner
 * scores (progress, off a lane centre, the last plan's course, room beside cars passed, the speed it ends with -
 * along the road).
 */
export const COURSE = {
  step: 0.25, // s between plan points
  horizon: 8, // s looked ahead
  sub: 5, // sub-steps a step (moved along and checked)
  /** Shares of the tightest turn a step may hold. */
  turns: [-1, -0.5, -0.2, 0, 0.2, 0.5, 1],
  /** Nodes kept per step (the most promising). */
  beam: 250,
  /** States closer than these count as the same: m across, m/s, rad of course. */
  dCell: 0.25,
  vCell: 2,
  psiCell: 0.015,
  /** 1/s: how fast a slip (the nose off the course) dies away in the plan. */
  slipDecay: 2,
  /** Share of the car's cornering grip (PlanEgo.latAccel) a plan may use. */
  latGrip: 1,
  /** Below this speed (m/s) the course is where the nose points. */
  still: 0.5,
  /** Share of the tightest turn its steering lock gives (PlanEgo.turnMax) a plan may hold: the car never quite gets
   * it (turning out of a crossways start at full lock it ran wide onto the shoulder and stopped). */
  lockShare: 0.8,
};

/** How plans came out, and the time they took (benchmarks). */
export const COURSE_STATS = { normal: 0, relaxed: 0, fallback: 0, ms: 0, slowest: 0 };

interface Node {
  s: number;
  d: number;
  v: number;
  psi: number; // course, rad off the road's heading (+ toward +d)
  beta: number; // the nose off the course (rad)
  score: number;
  parent: Node | null;
}

const ON_CENTRE = 0.3; // m off a lane centre that still counts as on it
/** Ways it may be heading the beam keeps some of each of (45 deg each). */
const SECTORS = 8;
/** Value taken off a dead end (heading for the edge, no room to turn either way). */
const DOOMED = 1000;
/** m of value per rad it still has to turn beyond TURN_FREE rad (lane changes' few degrees cost nothing). */
const TURN_COST = 20;
const TURN_FREE = 0.5;
/** m of progress a plan point on the shoulder costs (past the paved road's edge: allowed up to the rail). */
const OFF_ROAD = 5;
/** rad its nose off the road beyond which it is across the road (a crash): the shoulder allowed. */
const ACROSS = 0.4;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The plan for the next `COURSE.horizon` s (see COURSE). Falls back to braking along its course when nothing is clear. */
export function coursePlan(ego: PlanEgo, traffic: TrafficBox[], previous: PreviousPlan | null = null): Plan {
  const t0 = performance.now();
  const hl = ego.halfLength ?? 2.2;
  // Street racing does not look back (as the lattice planner): what is wholly behind brakes for us.
  const reach = ego.s + Math.max(ego.v, ego.speedCap) * COURSE.horizon + 50;
  const boxes = traffic.filter((t) => t.s < reach && t.s > ego.s - 150 && (PLANNER.lookBehind || t.s + t.length / 2 >= ego.s - hl));
  const start = startNode(ego);
  let found = search(ego, start, boxes, previous, false);
  if (found) COURSE_STATS.normal++;
  else {
    found = search(ego, start, boxes.filter((t) => t.s + t.length / 2 > ego.s - hl), previous, true);
    if (found) COURSE_STATS.relaxed++;
  }
  if (!found) {
    COURSE_STATS.fallback++;
    const dt = COURSE.step;
    const v = Math.max(0, start.v - maxBrake(start.v, ego.brake) * dt);
    const run = ((start.v + v) / 2) * dt;
    found = {
      points: [
        { t: 0, s: start.s, d: start.d, v: start.v, psi: start.psi },
        { t: dt, s: start.s + run * Math.cos(start.psi), d: start.d + run * Math.sin(start.psi), v, psi: start.psi },
      ],
    };
  }
  const ms = performance.now() - t0;
  COURSE_STATS.ms += ms;
  COURSE_STATS.slowest = Math.max(COURSE_STATS.slowest, ms);
  return found;
}

/** Where the plan starts: the car's velocity in road terms (its course), and its nose off it. */
function startNode(ego: PlanEgo): Node {
  const yaw = ego.yaw ?? 0;
  let vS: number, vD: number;
  if (ego.vLat !== undefined) {
    vS = ego.v * Math.cos(yaw) - ego.vLat * Math.sin(yaw);
    vD = ego.v * Math.sin(yaw) + ego.vLat * Math.cos(yaw);
  } else {
    vD = ego.vD ?? 0;
    vS = ego.v;
  }
  const speed = Math.hypot(vS, vD);
  const moving = speed > COURSE.still;
  const psi = moving ? Math.atan2(vD, vS) : yaw;
  return { s: ego.s, d: ego.d, v: speed, psi, beta: moving ? wrap(yaw - psi) : 0, score: 0, parent: null };
}

function search(ego: PlanEgo, start: Node, boxes: TrafficBox[], previous: PreviousPlan | null, relaxed: boolean): Plan | null {
  const P = PLANNER, K = COURSE;
  const dt = K.step, h = dt / K.sub;
  const steps = Math.round(K.horizon / dt);
  const hl = ego.halfLength ?? 2.2, hw = ego.halfWidth ?? 0.93;
  const side = relaxed ? 0 : P.sideMargin;
  const along = relaxed ? 0 : P.gapBehind;
  const margin = relaxed ? 0 : 1;
  const turnMax = K.lockShare * (ego.turnMax ?? Math.tan(0.55) / 2.5);
  const latTable = ego.latAccel ?? STREET_RACER.ai.latAccel;
  const decay = Math.exp(-K.slipDecay * h);
  // How far out its centre may go: the paved road's edge (as the lattice planner), or - off it already, or across the
  // road (a crash: ACROSS) - up to the rail, the shoulder at a cost (OFF_ROAD). (Allowed always, it passed a car on
  // the shoulder rather than take the gap.)
  const edge = Math.abs(start.d) > ROAD_HALF_WIDTH || Math.abs(start.psi + start.beta) > ACROSS ? RAIL_D - hw : ROAD_HALF_WIDTH;
  // How far (rad) a node still has to turn to run along the road, the way round there is room for at its tightest
  // turn: the short way (toward the edge it is heading for), or else the long way (away from it, through backward);
  // Infinity: neither - a dead end, kept only if nothing else is. Turning a long way round costs (TURN_COST) in the
  // value the beam keeps nodes by: both ways start alike, and the short way looks better at first (it gains ground)
  // - nodes heading for the edge filled the beam and a car standing at 120 or 135 deg off the road stayed put.
  const turnLeft = (n: Node) => {
    const a = Math.abs(n.psi);
    if (a < 1e-3) return 0;
    // (to its edge: `edge`)
    const toward = n.psi > 0 ? edge - n.d : edge + n.d;
    const away = n.psi > 0 ? edge + n.d : edge - n.d;
    const grip = K.latGrip * maxAccel(n.v, latTable);
    const r = Math.max(1 / turnMax, (n.v * n.v) / Math.max(1, grip));
    const c = Math.cos(a);
    if (r * (1 - c) <= toward + 0.05) return a;
    if (r * (1 + c) <= toward + 0.05 && r * (1 - c) <= away + 0.05) return 2 * Math.PI - a;
    return Infinity;
  };
  const value = (n: Node) => {
    const turn = turnLeft(n);
    return n.score + P.endSpeedValue * n.v * Math.cos(n.psi) - (turn === Infinity ? DOOMED : TURN_COST * Math.max(0, turn - TURN_FREE));
  };

  let layer: Node[] = [start];
  let deepest: Node[] = [start];
  for (let k = 0; k < steps; k++) {
    const tA = k * dt;
    const next = new Map<number, Node>();
    // Boxes that can be near this step's nodes.
    let sLo = Infinity, sHi = -Infinity;
    for (const n of layer) {
      sLo = Math.min(sLo, n.s);
      sHi = Math.max(sHi, n.s + n.v * dt + 10 * dt * dt);
    }
    const near = boxes.filter((b) => {
      const lo = Math.min(b.s + b.v * tA, b.s + b.v * (tA + dt)) - b.length / 2;
      const hi = Math.max(b.s + b.v * tA, b.s + b.v * (tA + dt)) + b.length / 2;
      return hi > sLo - 40 && lo < sHi + 40;
    });
    const wasD = previous ? planAt(previous.plan, previous.age + tA + dt).d : null;
    for (const n of layer) {
      const top = maxAccel(n.v, ego.accel);
      const brakeMax = maxBrake(n.v, ego.brake);
      const accels = [top, top / 2, 0, -P.softBrake, -brakeMax];
      const grip = K.latGrip * maxAccel(n.v, latTable);
      const kMax = n.v > 1 ? Math.min(turnMax, grip / (n.v * n.v)) : turnMax;
      for (const f of K.turns) {
        const kappa = f * kMax;
        const aLat = kappa * n.v * n.v;
        for (const a of accels) {
          // Braking and turning share the grip - and so do driving and turning: flat out with the wheel at full
          // lock the rear tyres spun and the tail slid out (a crossways start).
          if ((aLat / grip) ** 2 + (a / (a < 0 ? brakeMax : grip)) ** 2 > 1 + 1e-9) continue;
          let s = n.s, d = n.d, v = n.v, psi = n.psi, beta = n.beta;
          let hit = false;
          for (let j = 1; j <= K.sub && !hit; j++) {
            const v1 = Math.max(0, Math.min(ego.speedCap, v + a * h));
            const vm = (v + v1) / 2;
            const dpsi = kappa * vm * h;
            const pm = psi + dpsi / 2;
            s += vm * h * Math.cos(pm);
            d += vm * h * Math.sin(pm);
            psi = wrap(psi + dpsi);
            v = v1;
            beta *= decay;
            if (v < K.still) {
              psi = wrap(psi + beta); // (standing: it goes where its nose points)
              beta = 0;
            }
            if (Math.abs(d) > edge && Math.abs(d) > Math.abs(n.d)) hit = true; // (the edge: `edge`)
            else hit = touches(s, d, psi + beta, hl + along, hw + side, near, tA + j * h);
          }
          if (hit) continue;
          if (!relaxed && tooClose(s, d, v, psi + beta, psi, hl, hw, side, near, tA + dt, margin, ego)) continue;
          let score = n.score + (s - n.s);
          if (Math.abs(d) > ROAD_HALF_WIDTH) score -= OFF_ROAD;
          else if (Math.abs(d - laneCenter(laneAt(d))) > ON_CENTRE) score -= P.lineCost;
          if (wasD !== null && Math.abs(d - wasD) < LANE_WIDTH / 4) score += P.keepCourseBonus;
          if (P.passCost > 0) score -= passShort(near, s, d, hl, hw, tA + dt);
          const key = (Math.round(d / K.dCell) * 1000 + Math.round(v / K.vCell)) * 1000 + Math.round(wrap(psi) / K.psiCell) + 500;
          const old = next.get(key);
          if (old && value(old) >= score + P.endSpeedValue * v * Math.cos(psi)) continue;
          next.set(key, { s, d, v, psi, beta, score, parent: n });
        }
      }
    }
    if (next.size === 0) break;
    let nodes = [...next.values()];
    if (K.beam > 0 && nodes.length > K.beam) {
      // The most promising, but some of every way it is heading (SECTORS): turning one way round and the other both
      // kept, not only what looks best this early.
      nodes.sort((x, y) => value(y) - value(x));
      const quota = Math.ceil(K.beam / (2 * SECTORS));
      const per = new Array(SECTORS).fill(0);
      const kept: Node[] = [], rest: Node[] = [];
      for (const n of nodes) {
        const sec = Math.min(SECTORS - 1, Math.floor(((n.psi + Math.PI) / (2 * Math.PI)) * SECTORS));
        if (per[sec] < quota) {
          per[sec]++;
          kept.push(n);
        } else rest.push(n);
      }
      nodes = kept.concat(rest.slice(0, Math.max(0, K.beam - kept.length)));
    }
    layer = nodes;
    deepest = nodes;
  }
  let best: Node | null = null;
  for (const n of deepest) if (!best || value(n) > value(best)) best = n;
  const chain: Node[] = [];
  for (let n = best; n; n = n.parent) chain.push(n);
  chain.reverse();
  if (chain.length === 1) return null;
  return { points: chain.map((n, i): PlanPoint => ({ t: i * dt, s: n.s, d: n.d, v: n.v, psi: n.psi })) };
}

/** Whether the body (centre s, d; pointing `heading` off the road's; half length / width) overlaps a box at time t. */
function touches(s: number, d: number, heading: number, hl: number, hw: number, boxes: TrafficBox[], t: number): boolean {
  const c = Math.abs(Math.cos(heading)), si = Math.abs(Math.sin(heading));
  const cs = Math.cos(heading), sn = Math.sin(heading);
  for (const b of boxes) {
    const bs = b.s + b.v * t;
    const bl = b.length / 2, bw = (b.dMax - b.dMin) / 2, bd = (b.dMin + b.dMax) / 2;
    const dx = bs - s, dy = bd - d;
    // Separating axes: the road's two, the body's two.
    if (Math.abs(dx) > bl + hl * c + hw * si) continue;
    if (Math.abs(dy) > bw + hl * si + hw * c) continue;
    if (Math.abs(dx * cs + dy * sn) > hl + bl * c + bw * si) continue;
    if (Math.abs(-dx * sn + dy * cs) > hw + bl * si + bw * c) continue;
    return true;
  }
  return false;
}

/**
 * Whether a box ahead in its way is closer than it can brake down to its speed in (plus a headway) - unless it is
 * already steering out of its way and clears it sideways in time (as the lattice planner's steerClear).
 */
function tooClose(s: number, d: number, v: number, heading: number, psi: number, hl: number, hw: number, side: number, boxes: TrafficBox[], t: number, margin: number, ego: PlanEgo): boolean {
  const c = Math.abs(Math.cos(heading)), si = Math.abs(Math.sin(heading));
  const halfW = hw * c + hl * si, halfL = hl * c + hw * si;
  const vS = v * Math.cos(psi), vD = v * Math.sin(psi);
  for (const b of boxes) {
    const bs = b.s + b.v * t;
    const rear = bs - b.length / 2;
    if (rear < s) continue; // (not ahead)
    const bw = (b.dMax - b.dMin) / 2, bd = (b.dMin + b.dMax) / 2;
    const overlap = bw + halfW + side - Math.abs(bd - d);
    if (overlap <= 0) continue;
    const closing = vS - b.v;
    if (closing <= 0) continue;
    const gap = rear - (s + halfL);
    let keep = (closing * closing) / (2 * maxBrake(v - closing / 2, ego.brake)) + PLANNER.headway * v * margin;
    const away = bd < d ? vD > 0.5 : bd > d ? vD < -0.5 : PLANNER.steerClear && Math.abs(vD) > 0.5;
    if (away) keep = Math.min(keep, closing * (overlap / Math.abs(vD)));
    if (gap < keep) return true;
  }
  return false;
}

/** passCost for the car at (s, d) at time t: what it is short of passRoom beside the boxes it is level with. */
function passShort(boxes: TrafficBox[], s: number, d: number, hl: number, hw: number, t: number): number {
  const P = PLANNER;
  let cost = 0;
  for (const b of boxes) {
    if (Math.abs(b.s + b.v * t - s) > b.length / 2 + hl) continue;
    const gap = d > (b.dMin + b.dMax) / 2 ? d - hw - b.dMax : b.dMin - (d + hw);
    if (gap < P.passRoom) cost += P.passCost * (P.passRoom - Math.max(0, gap));
  }
  return cost;
}
