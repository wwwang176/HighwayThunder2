import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { PLAN_STATS, PLANNER, planAt, type Plan } from '../src/ai/planner';
import { PlannerDriver, planPedals } from '../src/ai/plannerDriver';
import { baseSteer, netDrive, trackerFrom } from '../src/ai/netTracker';
import { selfStateOf } from '../src/ai/driver';
import { PlayerCar } from '../src/vehicles/playerCar';
import { KMH, LANE_WIDTH, PHYSICS_DT } from '../src/config';
import { laneCenter } from '../src/road/coords';
import type { TrafficBox } from '../src/ai/sensors';
import { initExams, movePlan, SPEC } from './trackerEval';
import { openGround } from './openGround';

/**
 * Swinging out before crossing a short gap (a flick), driven: the car in lane 2 at LANE1 + DV km/h, lane 1 a queue at
 * LANE1 (QUEUE m apart: no way through) with one GAP m gap (bumper to bumper) whose middle is AT m ahead, lane 3 a row of slow cars
 * (SLOW, every 14 m), lane 0 empty: it is to get into lane 0, through the gap. Its time to the line LINE m on, by:
 * - the AI as in the game (PlannerDriver: the planner, its network);
 * - forced moves: held in lane 2 at an approach speed, from a moment on swung out W cells (away from the gap) and then
 *   across into lane 0 as fast as the planner's moves go (movePlan, replanned every 0.25 s as the tracker's exams),
 *   flat out once clear of lane 1. For each W the moment and approach speed searched (the plans' own motion, its
 *   clearance at least PLAN_MARGIN m), the best TOP of them driven - by the car's network and by the plain tracker -
 *   the earliest to the line without touching anything kept.
 * Per run: time to the line, the least room (m, body to body, the car's yaw counted) to the gap's two cars, to the
 * rest, sideways speed as its body enters lane 1's cars' band, speed then. MAXLAT=<cells a step>: the plans' sideways
 * cap raised (PLANNER.maxLateral: 6, 11 m/s).
 *   DVS=0,30,50,100 GAPS=5,6,8,10,15,20 npx vitest run --config training/vitest.config.ts training/flickGap.train.ts
 * The right-front car gone, swinging out into lane 3: HOLE=-5,40 SWINGS=0,2,4,6,8.
 */
const env = (k: string, d: string) => process.env[k] ?? d;
const LANE1 = Number(env('LANE1', '150')) * KMH;
const SLOW = Number(env('SLOW', '100')) * KMH;
const DVS = env('DVS', '0,30,50,100').split(',').map(Number);
const GAPS = env('GAPS', '5,6,8,10,15,20').split(',').map(Number);
const SWINGS = env('SWINGS', '0,1,2,3').split(',').map(Number); // cells (LANE_WIDTH / 8 each; 8: lane 3's middle)
/** HOLE=a,b: lane 3's cars starting a..b m on left out (the right-front car gone: room to swing out into lane 3). */
const HOLE = process.env.HOLE ? process.env.HOLE.split(',').map(Number) : null;
const AT = Number(env('AT', '30'));
const A2 = Number(env('A2', '80'));
/** Bumper to bumper in lane 1's queue (m): too short to get through, the gap the only way. */
const QUEUE = Number(env('QUEUE', '2'));
const LINE = Number(env('LINE', '300'));
const TOP = Number(env('TOP', '10'));
const PLAN_MARGIN = Number(env('PLAN_MARGIN', '0.1'));
const SIM_S = 16;
const LEN = 4.6;
const CELL = LANE_WIDTH / PLANNER.cellsPerLane;
const HW = SPEC.params.width / 2;
const HL = SPEC.params.length / 2;
const CAP = SPEC.params.maxSpeed;
const L0 = laneCenter(0), L1 = laneCenter(1), L2 = laneCenter(2);
if (process.env.MAXLAT) PLANNER.maxLateral = Number(process.env.MAXLAT);

interface Box extends TrafficBox {
  group: 'gap' | 'queue' | 'row';
}
const box = (id: number, s: number, lane: number, v: number, group: Box['group']): Box => ({ id, s, dMin: laneCenter(lane) - 0.9, dMax: laneCenter(lane) + 0.9, v, length: LEN, group });

function scene(gap: number): Box[] {
  const R = box(1, AT - gap / 2 - LEN / 2, 1, LANE1, 'gap');
  const F = box(2, AT + gap / 2 + LEN / 2, 1, LANE1, 'gap');
  const out = [R, F];
  for (let k = 1; k <= 40; k++) out.push(box(100 + k, R.s - k * (LEN + QUEUE), 1, LANE1, 'queue'), box(200 + k, F.s + k * (LEN + QUEUE), 1, LANE1, 'queue'));
  for (let s = -40; s <= 500; s += 14) if (!(HOLE && s >= HOLE[0] && s <= HOLE[1])) out.push(box(1000 + s, s, 3, SLOW, 'row'));
  // A slow car ahead in lane 2 (A2 m on): the reason to get across (the AI's too); 'row' with the others.
  out.push(box(3000, A2, 2, SLOW, 'row'));
  return out;
}

/** Room (m) between the car's body (centre s, d; heading yaw toward +d) and a box: the widest gap on any axis (< 0: overlapping). */
function room(s: number, d: number, yaw: number, b: TrafficBox, t: number): number {
  const bs = b.s + b.v * t;
  const c = Math.cos(yaw), si = Math.sin(yaw);
  const corners: [number, number][] = [];
  for (const a of [-HL, HL]) for (const w of [-HW, HW]) corners.push([s + a * c - w * si, d + a * si + w * c]);
  const bc: [number, number][] = [[bs - b.length / 2, b.dMin], [bs + b.length / 2, b.dMin], [bs - b.length / 2, b.dMax], [bs + b.length / 2, b.dMax]];
  let best = -Infinity;
  for (const [ax, ay] of [[1, 0], [0, 1], [c, si], [-si, c]] as [number, number][]) {
    const p1 = corners.map(([x, y]) => x * ax + y * ay), p2 = bc.map(([x, y]) => x * ax + y * ay);
    best = Math.max(best, Math.min(...p2) - Math.max(...p1), Math.min(...p1) - Math.max(...p2));
  }
  return best;
}

interface Move {
  w: number; // cells out
  at: number; // s: swung out from then (w 0: across from then)
  vc: number; // approach speed, m/s
}

/** Where a forced move aims now: lane 2, then out, then lane 0; and its speed. */
class Steps {
  phase: 'hold' | 'out' | 'across' = 'hold';
  outSince = 0;
  constructor(private readonly m: Move) {}
  target(t: number, d: number, vD: number): { d: number; v: number } {
    const m = this.m;
    if (this.phase === 'hold' && t >= m.at) {
      this.phase = m.w > 0 ? 'out' : 'across';
      this.outSince = t;
    }
    // Out until it is (nearly) there and no longer moving out, or 1.2 s.
    if (this.phase === 'out' && ((d >= L2 + m.w * CELL - 0.5 * CELL && vD <= 0.5) || t - this.outSince > 1.2)) this.phase = 'across';
    if (this.phase === 'hold') return { d: L2, v: m.vc };
    if (this.phase === 'out') return { d: L2 + m.w * CELL, v: m.vc };
    const clear = d + HW < L1 - 0.9 - 0.1;
    return { d: L0, v: clear ? CAP : m.vc };
  }
}

interface Result {
  time: number; // to the line (Infinity: never, or spun)
  gapRoom: number;
  otherRoom: number;
  entryVD: number;
  entryV: number;
  crossed: boolean;
}

/** The forced move as its plans have it (no car): time to the line and the least room. */
function rollout(boxes: Box[], m: Move, v0: number): Result {
  const steps = new Steps(m);
  let s = 0, d = L2, vD = 0, v = v0;
  let gapRoom = Infinity, otherRoom = Infinity, entryVD = NaN, entryV = NaN, crossed = false;
  for (let t = 0; t < SIM_S; t += PLANNER.step) {
    const aim = steps.target(t, d, vD);
    const p = movePlan(s, d, vD, Math.max(5, v), aim.d, aim.v);
    for (let k = 1; k <= 5; k++) {
      const q = planAt(p, k * 0.05);
      const tt = t + k * 0.05;
      const yaw = Math.atan2(q.dRate, Math.max(1, q.v));
      for (const b of boxes) {
        if (Math.abs(b.s + b.v * tt - q.s) > 12 || Math.abs((b.dMin + b.dMax) / 2 - q.d) > 3.5) continue;
        const r = room(q.s, q.d, yaw, b, tt);
        if (b.group === 'gap') gapRoom = Math.min(gapRoom, r);
        else otherRoom = Math.min(otherRoom, r);
      }
      if (Number.isNaN(entryVD) && q.d - HW < L1 + 0.9) {
        entryVD = -q.dRate;
        entryV = q.v;
      }
      if (q.d + HW < L1 - 0.9) crossed = true;
      if (Math.min(gapRoom, otherRoom) < PLAN_MARGIN) return { time: Infinity, gapRoom, otherRoom, entryVD, entryV, crossed };
      if (q.s >= LINE) return { time: crossed ? tt : Infinity, gapRoom, otherRoom, entryVD, entryV, crossed };
    }
    const q = planAt(p, PLANNER.step);
    s = q.s;
    d = q.d;
    vD = q.dRate;
    v = q.v;
  }
  return { time: Infinity, gapRoom, otherRoom, entryVD, entryV, crossed };
}

// (made once RAPIER is in: initExams)
let physics: ReturnType<typeof openGround>;
let car: PlayerCar;
let brain: ReturnType<typeof trackerFrom>;

/** Driven: a forced move (by the network, or `plain`: the plain tracker), or the AI as in the game (`ai`). */
/** TRACE: the car's way, every 1/30 s (t, s, d, yaw, km/h, sideways m/s). */
let trace: number[][] | null = null;

function drive(boxes: Box[], v0: number, how: { m: Move; plain: boolean } | 'ai'): Result {
  car.resetTo(0, 2, v0);
  trace?.push([0, car.s, car.d, car.yaw, v0 / KMH, 0]);
  const ai = how === 'ai' ? new PlannerDriver(null) : null;
  if (ai) {
    ai.accel = SPEC.ai.accel;
    ai.latAccel = SPEC.ai.latAccel;
    ai.tracker = trackerFrom(SPEC.ai.tracker);
    ai.recovery = trackerFrom(SPEC.ai.recovery);
    ai.reset();
  }
  const steps = how === 'ai' ? null : new Steps(how.m);
  let plan: Plan | null = null, madeAt = 0;
  let gapRoom = Infinity, otherRoom = Infinity, entryVD = NaN, entryV = NaN, crossed = false;
  const n = Math.round(SIM_S / PHYSICS_DT);
  for (let i = 0; i < n; i++) {
    const t = i * PHYSICS_DT;
    const self = selfStateOf(car, CAP);
    const vD = self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw);
    let input;
    if (ai) input = ai.drive(self, boxes.map((b) => ({ ...b, s: b.s + b.v * t })), car.params);
    else {
      if (!plan || t - madeAt >= PLANNER.step - 1e-9) {
        const aim = steps!.target(t, self.d, vD);
        plan = movePlan(self.s, self.d, vD, Math.max(5, self.vLong), aim.d, aim.v);
        madeAt = t;
      }
      const age = t - madeAt;
      const pedals = planPedals(plan, age, self.vLong, SPEC.ai.accel);
      let steer: number;
      if (how !== 'ai' && !how.plain) {
        const net = netDrive(brain!, plan, age, self, car.params, pedals.throttle);
        steer = net.steer;
        pedals.throttle = net.throttle;
        if (net.across) pedals.brake = 0;
      } else steer = baseSteer(plan, age, self, car.params);
      input = { steer, ...pedals };
    }
    car.prePhysics(input, PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
    if (trace && i % 4 === 3)
      trace.push([+(t + PHYSICS_DT).toFixed(4), +car.s.toFixed(3), +car.d.toFixed(3), +car.yaw.toFixed(4), +(car.vLong / KMH).toFixed(1), +(car.vLong * Math.sin(car.yaw) + car.vLat * Math.cos(car.yaw)).toFixed(2)]);
    const tt = t + PHYSICS_DT;
    if (i % 3 === 2) {
      for (const b of boxes) {
        if (Math.abs(b.s + b.v * tt - car.s) > 12 || Math.abs((b.dMin + b.dMax) / 2 - car.d) > 3.5) continue;
        const r = room(car.s, car.d, car.yaw, b, tt);
        if (b.group === 'gap') gapRoom = Math.min(gapRoom, r);
        else otherRoom = Math.min(otherRoom, r);
      }
    }
    if (Number.isNaN(entryVD) && car.d - HW < L1 + 0.9) {
      entryVD = -(car.vLong * Math.sin(car.yaw) + car.vLat * Math.cos(car.yaw));
      entryV = car.vLong;
    }
    if (car.d + HW < L1 - 0.9) crossed = true;
    const slip = Math.abs(Math.atan2(car.vLat, Math.max(1, car.vLong)));
    if (slip > 0.35) return { time: Infinity, gapRoom, otherRoom, entryVD, entryV, crossed };
    if (car.s >= LINE) return { time: crossed || !boxes.length ? tt : Infinity, gapRoom, otherRoom, entryVD, entryV, crossed }; // (alone: nothing to cross)
  }
  return { time: Infinity, gapRoom, otherRoom, entryVD, entryV, crossed };
}

const touched = (r: Result) => Math.min(r.gapRoom, r.otherRoom) <= 0;
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');

it('flick gap', async () => {
  await initExams();
  physics = openGround();
  physics.timestep = PHYSICS_DT;
  car = new PlayerCar(physics, null, { spec: SPEC });
  car.params.maxSpeed = CAP;
  brain = trackerFrom(SPEC.ai.tracker);
  const lines: string[] = [];
  const dump: unknown[] = [];
  const say = (s: string) => {
    lines.push(s);
    process.stdout.write(s + '\n');
  };
  // TRACE=<in.json>,<out.json>: the runs listed ({ dv, gap, w?, at?, vc? (km/h) }: no w, the AI as in game) driven, their ways kept.
  if (process.env.TRACE) {
    const [inPath, outPath] = process.env.TRACE.split(',');
    const runs = JSON.parse(readFileSync(inPath, 'utf8')) as { dv: number; gap: number; label: string; w?: number; at?: number; vc?: number }[];
    const out = runs.map((r) => {
      const boxes = scene(r.gap);
      const v0 = LANE1 + r.dv * KMH;
      trace = [];
      const res = drive(boxes, v0, r.w === undefined ? 'ai' : { m: { w: r.w, at: r.at!, vc: r.vc! * KMH }, plain: false });
      const way = trace;
      trace = null;
      const near = boxes.filter((b) => b.group !== 'queue' || Math.abs(b.s - AT) < 160);
      return { ...r, res, way, cars: near.map((b) => ({ s: b.s, d: (b.dMin + b.dMax) / 2, v: b.v / KMH, len: b.length, group: b.id === 1 || b.id === 2 ? 'gap' : b.id === 3000 ? 'slow' : b.group })) };
    });
    writeFileSync(outPath, JSON.stringify({ lane1: LANE1 / KMH, at: AT, line: LINE, lanes: [L0, L1, L2, laneCenter(3)], laneW: LANE_WIDTH, hw: HW, hl: HL, runs: out }));
    say('traced ' + out.map((o) => `${o.label}: ${f(o.res.time)} s${touched(o.res) ? ' TOUCHED' : ''}`).join(', '));
    return;
  }
  say(`${SPEC.id}: lane 1 at ${LANE1 / KMH} km/h, the gap's middle ${AT} m ahead, to the line ${LINE} m; swings in cells of ${CELL.toFixed(3)} m; plans' sideways cap ${((PLANNER.maxLateral * CELL) / PLANNER.step).toFixed(1)} m/s`);
  for (const dv of DVS) {
    const v0 = LANE1 + dv * KMH;
    // Free: alone, flat out down lane 2.
    const free = drive([], v0, { m: { w: 0, at: 99, vc: CAP }, plain: false }).time;
    say(`\n== ${dv} km/h faster than lane 1 (${(v0 / KMH).toFixed(0)} km/h): alone ${f(free)} s to the line`);
    for (const gap of GAPS) {
      const boxes = scene(gap);
      const aiRun = drive(boxes, v0, 'ai');
      say(`gap ${gap} m: AI as in game ${touched(aiRun) ? 'TOUCHED ' : ''}${f(aiRun.time)} s${aiRun.crossed ? '' : ' (never got across)'}, room gap ${f(aiRun.gapRoom)} / others ${f(aiRun.otherRoom)}, in at ${f(aiRun.entryVD, 1)} m/s sideways, ${f(aiRun.entryV / KMH, 0)} km/h`);
      const row: Record<string, unknown> = { dv, gap, free, ai: aiRun };
      for (const w of SWINGS) {
        // The moves its plans get through, earliest to the line first.
        const found: { m: Move; r: Result }[] = [];
        for (let kmh = Math.max(60, LANE1 / KMH - 30); kmh <= Math.min(CAP / KMH, v0 / KMH + 30) + 1e-6; kmh += 10)
          for (let at = 0; at <= 8 + 1e-6; at += 0.1) {
            const m = { w, at: +at.toFixed(2), vc: kmh * KMH };
            const r = rollout(boxes, m, v0);
            if (Number.isFinite(r.time)) found.push({ m, r });
          }
        found.sort((a, b) => a.r.time - b.r.time);
        const tried = found.slice(0, TOP);
        // Driven; the earliest untouched kept (none: the nearest miss, as `near`).
        const best = (plain: boolean) => {
          let pick: { m: Move; r: Result } | null = null;
          let near: { m: Move; r: Result } | null = null;
          for (const c of tried) {
            const r = drive(boxes, v0, { m: c.m, plain });
            if (!touched(r) && Number.isFinite(r.time) && (!pick || r.time < pick.r.time)) pick = { m: c.m, r };
            const least = (x: Result) => Math.min(x.gapRoom, x.otherRoom);
            if (!near || least(r) > least(near.r)) near = { m: c.m, r };
          }
          return { pick, near };
        };
        // REAL=1: the moment searched on the car itself (the network driving, every 0.1 s), at the approach speeds
        // of the plans' best three and 10 km/h either side: the car lags a swing, so the plans' moments may not suit it.
        if (process.env.REAL && found.length) {
          const vcs = new Set<number>();
          for (const c of found.slice(0, 3)) for (const k of [-10, 0, 10]) vcs.add(Math.round(c.m.vc / KMH) + k);
          let pick: { m: Move; r: Result } | null = null;
          for (const kmh of vcs)
            for (let at = 0; at <= 8 + 1e-6; at += 0.1) {
              const m = { w, at: +at.toFixed(2), vc: kmh * KMH };
              const r = drive(boxes, v0, { m, plain: false });
              if (!touched(r) && Number.isFinite(r.time) && (!pick || r.time < pick.r.time)) pick = { m, r };
            }
          say(`  swing ${w} (${(w * CELL).toFixed(2)} m), searched on the car: ${pick ? `${f(pick.r.time)} s (at ${pick.m.at.toFixed(1)} s, ${(pick.m.vc / KMH).toFixed(0)} km/h; room ${f(pick.r.gapRoom)} / ${f(pick.r.otherRoom)}; in at ${f(pick.r.entryVD, 1)} m/s, ${f(pick.r.entryV / KMH, 0)} km/h)` : 'none untouched'}`);
          row[`real${w}`] = pick;
          continue;
        }
        const net = best(false), plain = best(true);
        const show = ({ pick: p, near: n }: ReturnType<typeof best>) =>
          p
            ? `${f(p.r.time)} s (at ${p.m.at.toFixed(1)} s, ${(p.m.vc / KMH).toFixed(0)} km/h; room ${f(p.r.gapRoom)}; in at ${f(p.r.entryVD, 1)} m/s, ${f(p.r.entryV / KMH, 0)} km/h)`
            : `none untouched${n ? ` (nearest: room gap ${f(n.r.gapRoom)} / others ${f(n.r.otherRoom)}${n.r.crossed ? '' : ', not across'}${Number.isFinite(n.r.time) ? '' : ', spun or late'})` : ''}`;
        say(`  swing ${w} (${(w * CELL).toFixed(2)} m): plans ${found.length ? f(found[0].r.time) + ' s' : 'none'} (${found.length} found) | network ${show(net)} | plain ${show(plain)}`);
        row[`w${w}`] = { plan: found[0] ?? null, net, plain };
      }
      dump.push(row);
    }
  }
  const plans = PLAN_STATS.normal + PLAN_STATS.relaxed + PLAN_STATS.fallback;
  process.stdout.write(`plans: ${plans}, ${(PLAN_STATS.ms / Math.max(1, plans)).toFixed(1)} ms a plan (slowest ${PLAN_STATS.slowest.toFixed(0)})\n`);
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(dump, null, 1));
}, 7_200_000);
