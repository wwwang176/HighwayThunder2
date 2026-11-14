import { GRASS_GRIP, LANE_WIDTH, MEDIAN_FAR_X, MEDIAN_NEAR_X, RAIL_D, ROAD_HALF_WIDTH, SHOULDER } from '../config';
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
  step: 0.25, // s between plan points, and a step for the first `fine` s
  fine: 2,
  /** s a step after that (its points' halves filled in): the far end needs less detail. */
  longStep: 0.5,
  horizon: 8, // s looked ahead
  sub: 3, // sub-steps a step (moved along and checked)
  /** Shares of the tightest turn a step may hold. */
  turns: [-1, -0.4, 0, 0.4, 1], // (seven, with 0.2 and 0.5: no better, half as fast again)
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
  /** s: a plan cut short (ending more than `reuseShort` s before the horizon) is made again from where the last one,
   * at most this old, has the car now (0: never). */
  reuseAge: 0.3,
  reuseShort: 0.5,
  /** Speed bands (over a step's speeds) the beam's shared-out half is also kept by; 0 / 1: none. */
  speedBands: 3,
  /**
   * Room round the traffic kept by a cost rather than walls (0: walls - PLANNER.sideMargin, gapBehind, headway).
   * On: walls only `softWall` m round the body (and braking for what is ahead), and a cost the nearer anything comes,
   * rising steeply (exponentially): `softCost` (m of progress a step) times e^-x, x the room in e-folds - across
   * `softSideFall` m, ahead `softAheadFall` s of its speed spare over braking for it, behind `softBehindFall` m (the
   * two together diagonally) - none from `softReach` e-folds out. A few cm off its last plan is then a little dearer,
   * not closed; already beside a car it goes on through (leaving costs too), not yet there it may go round.
   */
  soft: 0,
  softWall: 0.03,
  softCost: 5,
  softSideFall: 0.4,
  softAheadFall: 0.3,
  softBehindFall: 1,
  softReach: 4,
  /** The cost of a car the more, the faster this one comes at it: times 1 + softClose (at most), reached coming at it
   * across at softCloseSide m/s or from behind at softCloseAhead m/s (the two added; 0: off). */
  softClose: 0,
  softCloseSide: 3,
  softCloseAhead: 20,
  /** Every way ends against something before the horizon (cut short): 1 - the plan that ends slowest (braking the
   * most; the most promising of those), not the one going on furthest and fastest; 0 - as any plan. */
  deadEnd: 1,
};

/** How plans came out, and the time they took (benchmarks). */
export const COURSE_STATS = { normal: 0, relaxed: 0, fallback: 0, reused: 0, deadEnd: 0, ms: 0, slowest: 0 };

interface Node {
  s: number;
  d: number;
  v: number;
  psi: number; // course, rad off the road's heading (+ toward +d)
  beta: number; // the nose off the course (rad)
  score: number;
  t: number; // s into the plan
  /** What the beam keeps it by (value: the score, the speed it has, the turn it still has to make). */
  val: number;
  parent: Node | null;
}

const ON_CENTRE = 0.3; // m off a lane centre that still counts as on it
/** Other ways besides the plan it hands back (Plan.alts: drawn fainter beside it). */
const ALTERNATIVES = 2;
/** Ways it may be heading the beam keeps some of each of (45 deg each). */
const SECTORS = 8;
/** Value taken off a dead end (heading for the edge, no room to turn either way). */
const DOOMED = 1000;
/** m of value per rad it still has to turn beyond TURN_FREE rad (lane changes' few degrees cost nothing). */
const TURN_COST = 20;
const TURN_FREE = 0.5;
/** m of progress a plan point on the shoulder costs (past the paved road's edge: allowed up to the rail). */
const OFF_ROAD = 5;
/** m of progress a plan point costs per m it is outside where it may go (it heads back in). */
const OUT_COST = 2;
/** The ground's grip at d (the median's grass) as a share of the road's. */
const surface = (d: number) => (d < MEDIAN_NEAR_X ? GRASS_GRIP : 1);
/** rad its nose off the road beyond which it is across the road (a crash): the shoulder allowed. */
const ACROSS = 0.4;
/** m across / along the car may be off the last plan for it to be planned again from there (COURSE.reuseAge). */
const REUSE_NEAR_D = 1;
const REUSE_NEAR_S = 5;
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
  // Cut short (every way ends against something within the horizon) or none at all: planned again from where the last
  // plan has the car now, if that one is recent (reuseAge) - its plans ride the edge of what is clear (the side room,
  // the room to brake), and a few cm or km/h off the last one the way it was on can be closed to it (as the lattice
  // planner's reuseAge).
  const ends = (p: Plan | null) => (p ? p.points[p.points.length - 1].t : 0);
  if (COURSE.reuseAge > 0 && previous && previous.age <= COURSE.reuseAge && ends(found) < COURSE.horizon - COURSE.reuseShort) {
    const at = planAt(previous.plan, previous.age);
    const pts = previous.plan.points;
    const k = Math.min(pts.length - 1, Math.floor(previous.age / COURSE.step));
    const u = k + 1 < pts.length ? (previous.age - pts[k].t) / (pts[k + 1].t - pts[k].t) : 0;
    const psi = (pts[k].psi ?? 0) + (k + 1 < pts.length ? wrap((pts[k + 1].psi ?? 0) - (pts[k].psi ?? 0)) * Math.min(1, Math.max(0, u)) : 0);
    const onIt: PlanEgo = { ...ego, s: at.s, d: at.d, v: at.v, vD: at.v * Math.sin(psi), yaw: psi, vLat: 0 };
    const from = startNode(onIt);
    // (only near it: a car knocked off it - a crash - plans from where it is)
    const again = Math.abs(ego.d - at.d) > REUSE_NEAR_D || Math.abs(ego.s - at.s) > REUSE_NEAR_S ? null : search(onIt, from, boxes, previous, false) ?? search(onIt, from, boxes.filter((t) => t.s + t.length / 2 > ego.s - hl), previous, true);
    if (again && ends(again) > ends(found)) {
      found = again;
      COURSE_STATS.reused++;
    }
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
  return { s: ego.s, d: ego.d, v: speed, psi, beta: moving ? wrap(yaw - psi) : 0, score: 0, t: 0, val: 0, parent: null };
}

function search(ego: PlanEgo, start: Node, boxes: TrafficBox[], previous: PreviousPlan | null, relaxed: boolean): Plan | null {
  const P = PLANNER, K = COURSE;
  // The steps: fine ones first, then longer.
  const stepAt: number[] = [];
  for (let t = 0; t < K.horizon - 1e-9; ) {
    const dt = t < K.fine - 1e-9 ? K.step : K.longStep;
    stepAt.push(dt);
    t += dt;
  }
  const hl = ego.halfLength ?? 2.2, hw = ego.halfWidth ?? 0.93;
  const soft = !relaxed && K.soft > 0;
  const side = relaxed ? 0 : soft ? K.softWall : P.sideMargin;
  const along = relaxed ? 0 : soft ? K.softWall : P.gapBehind;
  const margin = relaxed || soft ? 0 : 1;
  const turnMax = K.lockShare * (ego.turnMax ?? Math.tan(0.55) / 2.5);
  const latTable = ego.latAccel ?? STREET_RACER.ai.latAccel;
  // How far out its centre may go: the paved road's edge (as the lattice planner), or - off it already, or across the
  // road (a crash: ACROSS) - up to the rail, the shoulder at a cost (OFF_ROAD). (Allowed always, it passed a car on
  // the shoulder rather than take the gap.)
  const edge = Math.abs(start.d) > ROAD_HALF_WIDTH || Math.abs(start.psi + start.beta) > ACROSS ? RAIL_D - hw : ROAD_HALF_WIDTH;
  // Outside that (on the median's grass, say) it still plans - going out further only to turn back in, at a cost the
  // further out (OUT_COST); once in it never goes out again. (Outside, every move out was refused: heading away from
  // the road it could not even start turning back, and stood braking.) Never past our rail, nor past the median onto
  // the oncoming road's lanes (its traffic is not in the boxes).
  const out = (d: number) => Math.abs(d) > edge;
  const hardHi = RAIL_D - hw, hardLo = MEDIAN_FAR_X - SHOULDER + hw; // (the oncoming shoulder is room to turn round on: to the median's side only, 90 deg across 6 m out it stood)
  // How far (rad) a node still has to turn to run along the road, the way round there is room for at its tightest
  // turn: the short way (toward the edge it is heading for), or else the long way (away from it, through backward);
  // Infinity: neither - a dead end, kept only if nothing else is. Turning a long way round costs (TURN_COST) in the
  // value the beam keeps nodes by: both ways start alike, and the short way looks better at first (it gains ground)
  // - nodes heading for the edge filled the beam and a car standing at 120 or 135 deg off the road stayed put.
  const turnLeft = (n: Node) => {
    const a = Math.abs(n.psi);
    if (a < 1e-3) return 0;
    // (to its edge: `edge`; outside, to the hard limits)
    const hi = out(n.d) ? hardHi : edge, lo = out(n.d) ? hardLo : -edge;
    const toward = n.psi > 0 ? hi - n.d : n.d - lo;
    const away = n.psi > 0 ? n.d - lo : hi - n.d;
    const grip = K.latGrip * maxAccel(n.v, latTable) * surface(n.d);
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
  let tA = 0;
  for (let k = 0; k < stepAt.length; tA += stepAt[k], k++) {
    const dt = stepAt[k], h = dt / K.sub;
    const decay = Math.exp(-K.slipDecay * h);
    const w = dt / K.step; // (costs a point: per K.step s)
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
      const surf = surface(n.d); // (the grass: less of everything)
      const top = maxAccel(n.v, ego.accel) * surf;
      const brakeMax = maxBrake(n.v, ego.brake) * surf;
      const accels = [top, top / 2, 0, -P.softBrake * surf, -brakeMax];
      const grip = K.latGrip * maxAccel(n.v, latTable) * surf;
      const kMax = n.v > 1 ? Math.min(turnMax, grip / (n.v * n.v)) : turnMax;
      // The boxes its body can touch this step, wherever its moves take it (most of `near` is lanes away).
      const run = Math.max(n.v, n.v + top * dt) * dt;
      const reachS = run + hl + along + 1, reachD = run + hl + hw + side + 1;
      const local = near.filter((b) => {
        const bs = b.s + b.v * (tA + dt / 2);
        return Math.abs(bs - n.s) < reachS + b.length / 2 + Math.abs(b.v - n.v) * dt && b.dMax > n.d - reachD && b.dMin < n.d + reachD;
      });
      // ...and those ahead it may have to brake for (in its way, however far).
      const inWay = near.filter((b) => b.dMax > n.d - reachD && b.dMin < n.d + reachD);
      // (COURSE.soft: those it can come within softReach of across this step - at most its tightest turn's move across)
      const sideRun = n.v * dt * Math.min(1, Math.abs(Math.sin(n.psi)) + kMax * n.v * dt) + hl + hw + K.softReach * K.softSideFall + 0.5;
      const costed = soft ? inWay.filter((b) => b.dMax > n.d - sideRun && b.dMin < n.d + sideRun) : inWay;
      for (const f of K.turns) {
        const kappa = f * kMax;
        const aLat = kappa * n.v * n.v;
        for (const a of accels) {
          // Braking and turning share the grip - and so do driving and turning: flat out with the wheel at full
          // lock the rear tyres spun and the tail slid out (a crossways start).
          if ((aLat / grip) ** 2 + (a / (a < 0 ? brakeMax : grip)) ** 2 > 1 + 1e-9) continue;
          let s = n.s, d = n.d, v = n.v, psi = n.psi, beta = n.beta;
          let hit = false;
          let close = 0; // (COURSE.soft: the cost of the room left, over the step's sub-steps)
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
            if ((d > hardHi && d > n.d) || (d < hardLo && d < n.d) || (!out(n.d) && out(d))) hit = true; // (`edge`, `out`)
            else hit = touches(s, d, psi + beta, hl + along, hw + side, local, tA + j * h);
            if (soft && !hit) close += nearness(s, d, v, psi + beta, psi, hl, hw, costed, tA + j * h, ego) * (h / K.step);
          }
          if (hit) continue;
          if (!relaxed && tooClose(s, d, v, psi + beta, psi, hl, hw, side, inWay, tA + dt, margin, ego)) continue;
          let score = n.score + (s - n.s);
          if (Math.abs(d) > ROAD_HALF_WIDTH) score -= (OFF_ROAD + (out(d) ? OUT_COST * (Math.abs(d) - edge) : 0)) * w;
          else if (Math.abs(d - laneCenter(laneAt(d))) > ON_CENTRE) score -= P.lineCost * w;
          if (wasD !== null && Math.abs(d - wasD) < LANE_WIDTH / 4) score += P.keepCourseBonus * w;
          if (soft) score -= close;
          else if (P.passCost > 0) score -= passShort(local, s, d, hl, hw, tA + dt) * w;
          const key = (Math.round(d / K.dCell) * 1000 + Math.round(v / K.vCell)) * 1000 + Math.round(wrap(psi) / K.psiCell) + 500;
          const old = next.get(key);
          if (old && old.score >= score) continue; // (the same state: the same speed and turn left)
          const node: Node = { s, d, v, psi, beta, score, t: tA + dt, val: 0, parent: n };
          node.val = value(node);
          next.set(key, node);
        }
      }
    }
    if (next.size === 0) break;
    let nodes = [...next.values()];
    if (K.beam > 0 && nodes.length > K.beam) {
      // The most promising, but half the beam shared out over where across the road it is (half lanes) and which way
      // it is heading (SECTORS): waiting to take a gap on the left and passing on the right both kept, and turning
      // one way round and the other - not only what looks best this early. (By value alone, with 250 kept, nodes
      // speeding off to the right filled it and the way through a gap on the left was lost; with 1000 it was found.)
      nodes.sort((x, y) => y.val - x.val);
      // (speedBands: and how fast it goes, in that many bands over this step's speeds)
      let vLo = Infinity, vHi = -Infinity;
      for (const n of nodes) {
        vLo = Math.min(vLo, n.v);
        vHi = Math.max(vHi, n.v);
      }
      const bands = K.speedBands, vSpan = Math.max(1e-6, vHi - vLo);
      const band = (n: Node) => (bands > 1 ? Math.min(bands - 1, Math.floor(((n.v - vLo) / vSpan) * bands)) : 0);
      const group = (n: Node) => (Math.round(n.d / (LANE_WIDTH / 2)) * SECTORS + Math.min(SECTORS - 1, Math.floor(((n.psi + Math.PI) / (2 * Math.PI)) * SECTORS))) * 8 + band(n);
      const groups = new Set(nodes.map(group)).size;
      const quota = Math.max(2, Math.floor(K.beam / (2 * groups)));
      const per = new Map<number, number>();
      const kept: Node[] = [], rest: Node[] = [];
      for (const n of nodes) {
        const g = group(n);
        const k = per.get(g) ?? 0;
        if (k < quota && kept.length < K.beam) {
          per.set(g, k + 1);
          kept.push(n);
        } else rest.push(n);
      }
      nodes = kept.concat(rest.slice(0, Math.max(0, K.beam - kept.length)));
    }
    layer = nodes;
    deepest = nodes;
  }
  // The best end, and the next best that go another way (another order of lanes along it): shown beside the plan.
  const cut = deepest[0].t < K.horizon - 1e-6;
  const slowest = (x: Node, y: Node) => Math.round(x.v / K.vCell) - Math.round(y.v / K.vCell) || y.val - x.val;
  const ends = [...deepest].sort(cut && K.deadEnd > 0 ? slowest : (x, y) => y.val - x.val);
  if (cut && K.deadEnd > 0 && ends.length && ends[0].parent) COURSE_STATS.deadEnd++;
  if (!ends.length || !ends[0].parent) return null;
  const picked: Node[] = [], ways = new Set<string>(), paths: number[][] = [];
  for (const n of ends) {
    const way = lanesOf(n);
    if (ways.has(way)) continue;
    // ...and apart from each picked: on average DISTINCT m across (two ways that only lean toward a line and back,
    // a little differently, are one way).
    const path = acrossOf(n);
    if (paths.some((q) => meanApart(q, path) < DISTINCT)) continue;
    ways.add(way);
    paths.push(path);
    picked.push(n);
    if (picked.length === 1 + ALTERNATIVES) break;
  }
  return { points: pointsOf(picked[0]), alts: picked.slice(1).map(pointsOf) };
}

/**
 * The lanes a plan ending at `n` settles in, in order (near a lane's centre: crossing one on the way over is no
 * settling - cutting across now and a moment later are the same way, holding back in a lane between is another).
 */
function lanesOf(n: Node): string {
  const lanes: number[] = [];
  for (let m: Node | null = n; m; m = m.parent) {
    const lane = Math.round((m.d - laneCenter(0)) / LANE_WIDTH);
    if (Math.abs(m.d - laneCenter(0) - lane * LANE_WIDTH) > SETTLED) continue;
    if (lanes[lanes.length - 1] !== lane) lanes.push(lane);
  }
  return lanes.join(',');
}
/** m off a lane's centre that counts as settled in it (lanesOf). */
const SETTLED = 0.6;
/** m two ways must be apart across, on average, to be shown as two. */
const DISTINCT = 1;

/** Where across the road a plan ending at `n` is, node by node from the start. */
function acrossOf(n: Node): number[] {
  const out: number[] = [];
  for (let m: Node | null = n; m; m = m.parent) out.push(m.d);
  return out.reverse();
}
const meanApart = (a: number[], b: number[]) => {
  const k = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < k; i++) sum += Math.abs(a[i] - b[i]);
  return k ? sum / k : 0;
};

/** The plan ending at `n`: its points every COURSE.step (a longer step's in between filled in on its straight). */
function pointsOf(end: Node): PlanPoint[] {
  const chain: Node[] = [];
  for (let n: Node | null = end; n; n = n.parent) chain.push(n);
  chain.reverse();
  const points: PlanPoint[] = [];
  for (let i = 0; i < chain.length; i++) {
    const n = chain[i], m = chain[i + 1];
    points.push({ t: n.t, s: n.s, d: n.d, v: n.v, psi: n.psi });
    if (!m) break;
    for (let t = n.t + COURSE.step; t < m.t - 1e-9; t += COURSE.step) {
      const u = (t - n.t) / (m.t - n.t);
      points.push({ t, s: n.s + (m.s - n.s) * u, d: n.d + (m.d - n.d) * u, v: n.v + (m.v - n.v) * u, psi: n.psi + wrap(m.psi - n.psi) * u });
    }
  }
  return points;
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

/**
 * COURSE.soft: the cost (m of progress, a step) of the room left round the body at (s, d) - pointing `heading`, going
 * v along `psi` - at time t: for each box, its room in e-folds across (m), and ahead (s of its speed spare over
 * braking down to the box's) or behind (m), diagonally the two together; e^-x, none from softReach out.
 */
function nearness(s: number, d: number, v: number, heading: number, psi: number, hl: number, hw: number, boxes: TrafficBox[], t: number, ego: PlanEgo): number {
  const K = COURSE;
  const c = Math.abs(Math.cos(heading)), si = Math.abs(Math.sin(heading));
  const halfW = hw * c + hl * si, halfL = hl * c + hw * si;
  const vS = v * Math.cos(psi);
  const floor = Math.exp(-K.softReach);
  let cost = 0;
  for (const b of boxes) {
    const bw = (b.dMax - b.dMin) / 2, bd = (b.dMin + b.dMax) / 2;
    const across = Math.max(0, Math.abs(bd - d) - bw - halfW) / K.softSideFall;
    if (across >= K.softReach) continue;
    const bs = b.s + b.v * t, bl = b.length / 2;
    let along = 0;
    // How fast the car comes at it, in shares of softCloseSide (across) / softCloseAhead (from behind it).
    let rate = 0;
    if (K.softClose > 0) rate = Math.max(0, (bd > d ? 1 : -1) * v * Math.sin(psi)) / K.softCloseSide;
    if (bs - bl > s + halfL) {
      const closing = vS - b.v;
      const need = closing > 0 ? (closing * closing) / (2 * maxBrake(v - closing / 2, ego.brake)) : 0;
      along = Math.max(0, bs - bl - (s + halfL) - need) / (Math.max(v, 5) * K.softAheadFall);
      if (K.softClose > 0) rate += Math.max(0, closing) / K.softCloseAhead;
    } else if (bs + bl < s - halfL) along = (s - halfL - (bs + bl)) / K.softBehindFall;
    const x = Math.hypot(across, along);
    if (x < K.softReach) cost += (Math.exp(-x) - floor) * (1 + K.softClose * Math.min(1, rate));
  }
  return K.softCost * cost;
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
