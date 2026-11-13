import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { plan, PLANNER, planAt, type Plan, type PlanEgo, type PreviousPlan } from '../src/ai/planner';
import { DRIVER_TUNING, planPedals, type PlanSource } from '../src/ai/plannerDriver';
import { makeDriver, planStats, resetStats } from './drivers';
import { baseSteer, netDrive, trackerFrom } from '../src/ai/netTracker';
import { selfStateOf } from '../src/ai/driver';
import { PlayerCar } from '../src/vehicles/playerCar';
import { KMH, LANE_WIDTH, PHYSICS_DT } from '../src/config';
import { laneCenter } from '../src/road/coords';
import type { TrafficBox } from '../src/ai/sensors';
import { initExams, movePlan, SPEC } from './trackerEval';
import { openGround } from './openGround';

/**
 * Threading between two cars a lane apart: the car in lane 2 at V + DV km/h behind F (lane 2, D0 m ahead, bumper to
 * bumper), L in lane 1 at F's left rear (its nose STAGGER m behind F's tail), A beside L in lane 0 and B beside F in
 * lane 3 (no way round): all four at V, real bodies (they hold their lane and speed, and are pushed about by a touch).
 * The only way past: into lane 1 between L's nose and F's tail. Per way of driving: time to LINE m and speed there,
 * time to FAR m (what it carries on with), touches (contacts begun with the car). Ways:
 * - the AI as in the game (PlannerDriver: the planner, the network);
 * - forced: held in lane 2 at an approach speed, from a moment on swung out W cells (right, away from L), then over
 *   into lane 1 as fast as the planner's moves go (movePlan every 0.25 s, the network steering), flat out once in it.
 *   Moment and speed searched: the plans' own best approach speeds (± 10 km/h), every 0.1 s round their moments, all
 *   driven; the earliest to FAR kept (touches allowed: a touch counts only as it costs time), and the earliest that
 *   touched nothing beside it.
 *   DVS=30,50,80 STAGGERS=2,4,6,8,10,14 npx vitest run --config training/vitest.config.ts training/staggerGap.train.ts
 */
const env = (k: string, d: string) => process.env[k] ?? d;
const V = Number(env('V', '150')) * KMH;
const DVS = env('DVS', '30,50,80').split(',').map(Number);
const STAGGERS = env('STAGGERS', '2,4,6,8,10,14').split(',').map(Number);
const SWINGS = env('SWINGS', '0,1,2,3').split(',').map(Number);
const D0 = Number(env('D0', '35'));
const LINE = Number(env('LINE', '300'));
const FAR = Number(env('FAR', '500'));
const PLAN_MARGIN = Number(env('PLAN_MARGIN', '-0.2'));
const SIM_S = 22;
const CELL = LANE_WIDTH / PLANNER.cellsPerLane;
const HW = SPEC.params.width / 2;
const HL = SPEC.params.length / 2;
const CAP = SPEC.params.maxSpeed;
const L1 = laneCenter(1), L2 = laneCenter(2);

/** The four others' starting places (centre s, lane). */
function layout(stagger: number): { s: number; lane: number }[] {
  const fS = HL + D0 + HL; // F's centre (the car's at 0)
  const lS = fS - HL - stagger - HL; // L's nose `stagger` behind F's tail
  return [
    { s: fS, lane: 2 }, // F
    { s: lS, lane: 1 }, // L
    { s: lS, lane: 0 }, // A
    { s: fS, lane: 3 }, // B
  ];
}

/** Room (m) between the car (centre s, d; yaw toward +d) and a box (centre bs, d range): widest gap on any axis. */
function room(s: number, d: number, yaw: number, bs: number, dMin: number, dMax: number, len: number): number {
  const c = Math.cos(yaw), si = Math.sin(yaw);
  const car: [number, number][] = [];
  for (const a of [-HL, HL]) for (const w of [-HW, HW]) car.push([s + a * c - w * si, d + a * si + w * c]);
  const bc: [number, number][] = [[bs - len / 2, dMin], [bs + len / 2, dMin], [bs - len / 2, dMax], [bs + len / 2, dMax]];
  let best = -Infinity;
  for (const [ax, ay] of [[1, 0], [0, 1], [c, si], [-si, c]] as [number, number][]) {
    const p1 = car.map(([x, y]) => x * ax + y * ay), p2 = bc.map(([x, y]) => x * ax + y * ay);
    best = Math.max(best, Math.min(...p2) - Math.max(...p1), Math.min(...p1) - Math.max(...p2));
  }
  return best;
}

interface Move {
  w: number;
  at: number;
  vc: number;
}

class Steps {
  phase: 'hold' | 'out' | 'over' = 'hold';
  outSince = 0;
  constructor(private readonly m: Move) {}
  target(t: number, d: number, vD: number): { d: number; v: number } {
    const m = this.m;
    if (this.phase === 'hold' && t >= m.at) {
      this.phase = m.w > 0 ? 'out' : 'over';
      this.outSince = t;
    }
    if (this.phase === 'out' && ((d >= L2 + m.w * CELL - 0.5 * CELL && vD <= 0.5) || t - this.outSince > 1.2)) this.phase = 'over';
    if (this.phase === 'hold') return { d: L2, v: m.vc };
    if (this.phase === 'out') return { d: L2 + m.w * CELL, v: m.vc };
    const inLane1 = d < (L1 + L2) / 2 - 0.3;
    return { d: L1, v: inLane1 ? CAP : m.vc };
  }
}

interface Result {
  t300: number;
  v300: number;
  tFar: number;
  touches: number;
  room: number; // least room to the others (plans: their boxes; driven: as the bodies are)
  inVD: number; // sideways m/s as its body first enters lane 1's cars' band
  inV: number;
  through: boolean; // in lane 1 ahead of L
}

/** The forced move as its plans have it, the others as boxes at V. */
function rollout(stagger: number, m: Move, v0: number): Result {
  const others = layout(stagger);
  const steps = new Steps(m);
  let s = 0, d = L2, vD = 0, v = v0;
  const r: Result = { t300: Infinity, v300: 0, tFar: Infinity, touches: 0, room: Infinity, inVD: NaN, inV: NaN, through: false };
  for (let t = 0; t < SIM_S; t += PLANNER.step) {
    const aim = steps.target(t, d, vD);
    const p = movePlan(s, d, vD, Math.max(5, v), aim.d, aim.v);
    for (let k = 1; k <= 5; k++) {
      const q = planAt(p, k * 0.05);
      const tt = t + k * 0.05;
      const yaw = Math.atan2(q.dRate, Math.max(1, q.v));
      for (const o of others) {
        const bs = o.s + V * tt;
        if (Math.abs(bs - q.s) > 12) continue;
        r.room = Math.min(r.room, room(q.s, q.d, yaw, bs, laneCenter(o.lane) - HW, laneCenter(o.lane) + HW, 2 * HL));
      }
      if (r.room < PLAN_MARGIN) return r;
      if (Number.isNaN(r.inVD) && q.d - HW < L1 + HW) {
        r.inVD = -q.dRate;
        r.inV = q.v;
      }
      if (q.d < (L1 + L2) / 2 - 0.3 && q.s - HL > others[1].s + V * tt + HL) r.through = true;
      if (r.through && q.s >= LINE && !Number.isFinite(r.t300)) {
        r.t300 = tt;
        r.v300 = q.v;
      }
      if (r.through && q.s >= FAR) {
        r.tFar = tt;
        return r;
      }
    }
    const q = planAt(p, PLANNER.step);
    s = q.s;
    d = q.d;
    vD = q.dRate;
    v = q.v;
  }
  return r;
}

let physics: ReturnType<typeof openGround>;
let car: PlayerCar;
let others: PlayerCar[];
let brain: ReturnType<typeof trackerFrom>;
let trace: number[][] | null = null;
let traceOthers: number[][][] | null = null;

/** Driven: a forced move (the network steering) or the AI as in the game. */
function drive(stagger: number, v0: number, how: Move | 'ai'): Result {
  const at = layout(stagger);
  // A new world and cars each run: a reset kept some of the last run (gearbox, revs, launch control...), and a world
  // bodies came and went in steps a little differently - runs came out a little different after one another.
  car.dispose(physics);
  for (const o of others) o.dispose(physics);
  physics.free();
  physics = openGround();
  physics.timestep = PHYSICS_DT;
  car = new PlayerCar(physics, null, { spec: SPEC, entity: { type: 'player' } });
  car.params.maxSpeed = CAP;
  others = [0, 1, 2, 3].map((k) => new PlayerCar(physics, null, { spec: SPEC, entity: { type: 'rival', id: k + 1 } }));
  for (const o of others) o.params.maxSpeed = CAP;
  car.resetTo(0, 2, v0);
  others.forEach((o, i) => o.resetTo(at[i].s, at[i].lane, V));
  const lanes = at.map((a) => a.lane);
  // (WHY: its plans made through a source that keeps each request - ego, traffic, last plan - to plan again later)
  const ai = how === 'ai' ? makeDriver(SPEC, why ? whySource() : null) : null; // (DRIVER: the planner and driver - drivers.ts)
  const steps = how === 'ai' ? null : new Steps(how);
  let plan: Plan | null = null, madeAt = 0;
  const theirs: { plan: Plan | null; madeAt: number }[] = others.map(() => ({ plan: null, madeAt: 0 }));
  const r: Result = { t300: Infinity, v300: 0, tFar: Infinity, touches: 0, room: Infinity, inVD: NaN, inV: NaN, through: false };
  const n = Math.round(SIM_S / PHYSICS_DT);
  for (let i = 0; i < n; i++) {
    const t = i * PHYSICS_DT;
    // The others hold their lanes at V (the plain tracker).
    others.forEach((o, k) => {
      const self = selfStateOf(o, CAP);
      const vD = self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw);
      const th = theirs[k];
      if (!th.plan || t - th.madeAt >= PLANNER.step - 1e-9) {
        th.plan = movePlan(self.s, self.d, vD, Math.max(5, self.vLong), laneCenter(lanes[k]), V);
        th.madeAt = t;
      }
      o.prePhysics({ steer: baseSteer(th.plan, t - th.madeAt, self, o.params), ...planPedals(th.plan, t - th.madeAt, self.vLong, SPEC.ai.accel) }, PHYSICS_DT);
    });
    const self = selfStateOf(car, CAP);
    const vD = self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw);
    let input;
    if (ai) {
      const boxes: TrafficBox[] = others.map((o, k) => ({ id: k + 1, s: o.s, dMin: o.d - HW, dMax: o.d + HW, v: o.vLong, length: 2 * HL }));
      input = ai.drive(self, boxes, car.params);
    } else {
      if (!plan || t - madeAt >= PLANNER.step - 1e-9) {
        const aim = steps!.target(t, self.d, vD);
        plan = movePlan(self.s, self.d, vD, Math.max(5, self.vLong), aim.d, aim.v);
        madeAt = t;
      }
      const age = t - madeAt;
      const pedals = planPedals(plan, age, self.vLong, SPEC.ai.accel);
      const net = netDrive(brain!, plan, age, self, car.params, pedals.throttle);
      pedals.throttle = net.throttle;
      if (net.across) pedals.brake = 0;
      input = { steer: net.steer, ...pedals };
    }
    if (why && ai) why.steps.push({ t, overrides: ai.overrides, brake: input.brake, v: self.vLong / KMH, d: self.d });
    car.prePhysics(input, PHYSICS_DT);
    physics.step((a, b) => {
      if (a.type === 'player' || b.type === 'player') r.touches++;
    });
    car.postPhysics();
    for (const o of others) o.postPhysics();
    const tt = t + PHYSICS_DT;
    if (i % 3 === 2)
      for (const o of others)
        if (Math.abs(o.s - car.s) < 12) r.room = Math.min(r.room, room(car.s, car.d, car.yaw, o.s, o.d - HW, o.d + HW, 2 * HL));
    if (trace && i % 4 === 3) {
      trace.push([+tt.toFixed(4), +car.s.toFixed(3), +car.d.toFixed(3), +car.yaw.toFixed(4), +(car.vLong / KMH).toFixed(1), +(car.vLong * Math.sin(car.yaw) + car.vLat * Math.cos(car.yaw)).toFixed(2)]);
      traceOthers!.push(others.map((o) => [+o.s.toFixed(3), +o.d.toFixed(3), +o.yaw.toFixed(4)]));
    }
    if (Number.isNaN(r.inVD) && car.d - HW < L1 + HW) {
      r.inVD = -(car.vLong * Math.sin(car.yaw) + car.vLat * Math.cos(car.yaw));
      r.inV = car.vLong;
    }
    if (car.d < (L1 + L2) / 2 - 0.3 && car.s - HL > others[1].s + HL) r.through = true;
    if (Math.abs(Math.atan2(car.vLat, Math.max(1, car.vLong))) > 0.35) return r; // spun
    if (car.s >= LINE && !Number.isFinite(r.t300)) {
      r.t300 = r.through ? tt : Infinity;
      r.v300 = car.vLong;
    }
    if (car.s >= FAR) {
      if (r.through) r.tFar = tt;
      return r;
    }
  }
  return r;
}

/** WHY=<dv>,<stagger>: the AI's run there, each plan it asked for kept, and what it did step by step. */
let why: { asks: { t: number; ego: PlanEgo; traffic: TrafficBox[]; previous: PreviousPlan | null; plan: Plan }[]; steps: { t: number; overrides: number; brake: number; v: number; d: number }[] } | null = null;
function whySource(): PlanSource {
  let answer: { stamp: number; plan: Plan } | null = null;
  return {
    busy: false,
    request(stamp, ego, traffic, previous) {
      const p = plan(ego, traffic, previous);
      why!.asks.push({ t: stamp, ego: { ...ego }, traffic: traffic.map((b) => ({ ...b })), previous, plan: p });
      answer = { stamp, plan: p };
    },
    take() {
      const a = answer;
      answer = null;
      return a;
    },
  };
}

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const show = (r: Result) =>
  `${f(r.t300)} s / ${f(r.v300 / KMH, 0)} km/h at ${LINE} m, ${f(r.tFar)} s to ${FAR} m${r.touches ? `, ${r.touches} touch${r.touches > 1 ? 'es' : ''}` : ''}${r.through ? '' : ' (not through)'}; room ${f(r.room)}; in at ${f(r.inVD, 1)} m/s, ${f(r.inV / KMH, 0)} km/h`;

it('stagger gap', async () => {
  await initExams();
  physics = openGround();
  physics.timestep = PHYSICS_DT;
  car = new PlayerCar(physics, null, { spec: SPEC, entity: { type: 'player' } });
  car.params.maxSpeed = CAP;
  others = [0, 1, 2, 3].map((k) => new PlayerCar(physics, null, { spec: SPEC, entity: { type: 'rival', id: k + 1 } }));
  for (const o of others) o.params.maxSpeed = CAP;
  brain = trackerFrom(SPEC.ai.tracker);
  const say = (s: string) => process.stdout.write(s + '\n');

  // TRACE=<in.json>,<out.json>: the runs listed ({ dv, stagger, label, w?, at?, vc? (km/h) }: no w, the AI) driven, their ways kept.
  if (process.env.TRACE) {
    const [inPath, outPath] = process.env.TRACE.split(',');
    const runs = JSON.parse(readFileSync(inPath, 'utf8')) as { dv: number; stagger: number; label: string; w?: number; at?: number; vc?: number }[];
    const out = runs.map((q) => {
      trace = [];
      traceOthers = [];
      const res = drive(q.stagger, V + q.dv * KMH, q.w === undefined ? 'ai' : { w: q.w, at: q.at!, vc: q.vc! * KMH });
      const run = { ...q, res, way: trace, theirs: traceOthers };
      trace = traceOthers = null;
      return run;
    });
    writeFileSync(outPath, JSON.stringify({ v: V / KMH, line: LINE, far: FAR, lanes: [0, 1, 2, 3].map(laneCenter), laneW: LANE_WIDTH, hw: HW, hl: HL, runs: out }));
    say('traced ' + out.map((o) => `${o.label}: ${show(o.res)}`).join('\n  '));
    return;
  }

  if (process.env.WHY) {
    const [dv, stagger] = process.env.WHY.split(',').map(Number);
    why = { asks: [], steps: [] };
    const res = drive(stagger, V + dv * KMH, 'ai');
    say(`AI, ${dv} km/h faster, L's nose ${stagger} m behind F's tail: ${show(res)}`);
    // What the car did: every 0.25 s its speed, lane position, and the emergency brake stepping in.
    let lastO = 0;
    for (const st of why.steps) {
      if (Math.round(st.t * 120) % 30 !== 0 || st.t > 6) continue;
      const o = st.overrides - lastO;
      lastO = st.overrides;
      say(`  t ${st.t.toFixed(2)}: ${st.v.toFixed(0)} km/h, d ${st.d.toFixed(2)} (lane 1 at ${L1.toFixed(2)}), brake ${st.brake.toFixed(2)}${o ? `, emergency brake ${o} steps` : ''}`);
    }
    // Each plan in the first 4 s planned again with one setting changed: its speed 1 and 2 s on, its most sideways
    // speed in 2 s, where it is 2 s on.
    const base = { ...PLANNER };
    const VARIANTS: [string, Partial<typeof PLANNER>][] = [
      ['as is', {}],
      ['swingMargin 0', { swingMargin: 0 }],
      ['sideMargin 0.05', { sideMargin: 0.05 }],
      ['passCost 0', { passCost: 0 }],
      ['keepCourse 0', { keepCourseBonus: 0 }],
      ['trackerLead 0', { trackerLead: 0 }],
      ['gapBehind 0', { gapBehind: 0 }],
      ['no previous', {}],
      ['all of them', { swingMargin: 0, sideMargin: 0.05, passCost: 0, keepCourseBonus: 0, trackerLead: 0, gapBehind: 0 }],
    ];
    const sum = (p: Plan) => {
      let lat = 0;
      for (let k = 0; k <= 20; k++) lat = Math.max(lat, Math.abs(planAt(p, k * 0.1).dRate));
      const a = planAt(p, 1), b = planAt(p, 2);
      return `${(a.v / KMH).toFixed(0)}/${(b.v / KMH).toFixed(0)} km/h, side ${lat.toFixed(1)} m/s, d ${b.d.toFixed(1)}`;
    };
    for (const ask of why.asks) {
      if (ask.t > 4) break;
      say(`plan at t ${ask.t.toFixed(2)} (${(ask.ego.v / KMH).toFixed(0)} km/h, d ${ask.ego.d.toFixed(2)}):`);
      for (const [name, set] of VARIANTS) {
        Object.assign(PLANNER, base, set);
        const p = plan(ask.ego, ask.traffic, name === 'no previous' || name === 'all of them' ? null : ask.previous);
        say(`    ${name.padEnd(16)} ${sum(p)}`);
      }
      Object.assign(PLANNER, base);
    }
    return;
  }

  // SETS=base|passedLead=0.05|passedLead=0.05,gapBehind=0: the AI alone over the grid, per set of settings (D.x: the driver's).
  if (process.env.SETS) {
    const baseP = { ...PLANNER }, baseD = { ...DRIVER_TUNING };
    const sets = process.env.SETS.split('|');
    const rows: Record<string, Result[]> = {};
    for (const set of sets) {
      Object.assign(PLANNER, baseP);
      Object.assign(DRIVER_TUNING, baseD);
      if (set !== 'base')
        for (const kv of set.split(',')) {
          const [k, v] = kv.split('=');
          if (k.startsWith('D.')) (DRIVER_TUNING as Record<string, number>)[k.slice(2)] = Number(v);
          else (PLANNER as Record<string, unknown>)[k] = Number(v);
        }
      rows[set] = [];
      resetStats();
      for (const dv of DVS)
        for (const stagger of STAGGERS) {
          const r = drive(stagger, V + dv * KMH, 'ai');
          rows[set].push(r);
          say(`[${set}] dv ${dv} stagger ${stagger}: ${show(r)}`);
        }
      say(`[${set}] ${planStats()}`);
    }
    Object.assign(PLANNER, baseP);
    Object.assign(DRIVER_TUNING, baseD);
    // Table: t to FAR (v at LINE), per cell; then per set, the mean over cells where every set got through.
    const cells = DVS.flatMap((dv) => STAGGERS.map((st) => `${dv}/${st}`));
    say(`\n${'dv/stagger'.padEnd(10)} ${sets.map((s) => s.slice(0, 22).padStart(24)).join('')}`);
    cells.forEach((c, i) => {
      say(`${c.padEnd(10)} ${sets.map((s) => { const r = rows[s][i]; return `${f(r.tFar)} ${f(r.v300 / KMH, 0)}${r.touches ? '*' + r.touches : ''}`.padStart(24); }).join('')}`);
    });
    const all = cells.map((_, i) => sets.every((s) => Number.isFinite(rows[s][i].tFar)));
    say(`${'mean'.padEnd(10)} ${sets.map((s) => { const xs = rows[s].filter((_, i) => all[i]); return `${f(xs.reduce((a, r) => a + r.tFar, 0) / xs.length, 3)} (${xs.length})`.padStart(24); }).join('')}`);
    say(`${'through'.padEnd(10)} ${sets.map((s) => `${rows[s].filter((r) => Number.isFinite(r.tFar)).length}/${cells.length}`.padStart(24)).join('')}`);
    if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ sets, cells, rows }, null, 1));
    return;
  }

  const dump: unknown[] = [];
  say(`${SPEC.id}: the others at ${V / KMH} km/h, F ${D0} m ahead; ${LINE} m and ${FAR} m lines; swings in cells of ${CELL.toFixed(3)} m`);
  for (const dv of DVS) {
    const v0 = V + dv * KMH;
    say(`\n== ${dv} km/h faster (${(v0 / KMH).toFixed(0)} km/h)`);
    for (const stagger of STAGGERS) {
      const aiRun = drive(stagger, v0, 'ai');
      say(`L's nose ${stagger} m behind F's tail: AI as in game ${show(aiRun)}`);
      const row: Record<string, unknown> = { dv, stagger, ai: aiRun };
      for (const w of SWINGS) {
        // The plans' best (approach speed, moment)s, then driven round them.
        const found: { m: Move; r: Result }[] = [];
        for (let kmh = Math.max(60, V / KMH - 40); kmh <= Math.min(CAP / KMH, v0 / KMH + 20) + 1e-6; kmh += 10)
          for (let at = 0; at <= 6 + 1e-6; at += 0.1) {
            const m = { w, at: +at.toFixed(2), vc: kmh * KMH };
            const r = rollout(stagger, m, v0);
            if (Number.isFinite(r.tFar)) found.push({ m, r });
          }
        found.sort((a, b) => a.r.tFar - b.r.tFar);
        const tries = new Map<string, Move>();
        for (const c of found.slice(0, 3))
          for (const dk of [-10, 0, 10])
            for (let k = -6; k <= 6; k++) {
              const at = +(c.m.at + k * 0.1).toFixed(2);
              const vc = Math.round(c.m.vc / KMH) + dk;
              if (at >= 0) tries.set(`${at}|${vc}`, { w, at, vc: vc * KMH });
            }
        let best: { m: Move; r: Result } | null = null, clean: { m: Move; r: Result } | null = null;
        for (const m of tries.values()) {
          const r = drive(stagger, v0, m);
          if (!Number.isFinite(r.tFar)) continue;
          if (!best || r.tFar < best.r.tFar) best = { m, r };
          if (r.touches === 0 && (!clean || r.tFar < clean.r.tFar)) clean = { m, r };
        }
        const pick = (p: { m: Move; r: Result } | null) => (p ? `${show(p.r)} [at ${p.m.at.toFixed(1)} s, ${(p.m.vc / KMH).toFixed(0)} km/h]` : 'none got through');
        say(`  swing ${w} (${(w * CELL).toFixed(2)} m): plans ${found.length ? f(found[0].r.tFar) + ' s' : 'none'} (${found.length}), driven ${tries.size}: best ${pick(best)}`);
        if (best && best.r.touches) say(`      untouched best ${pick(clean)}`);
        row[`w${w}`] = { best, clean };
      }
      dump.push(row);
    }
  }
  process.stdout.write(`plans: ${planStats()}\n`);
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(dump, null, 1));
}, 7_200_000);
