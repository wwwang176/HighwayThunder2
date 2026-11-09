import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PLAN_STATS, planAt } from '../src/ai/planner';
import { emergencyBrake, PlannerDriver } from '../src/ai/plannerDriver';
import { TrainingSim } from '../src/ai/trainingSim';
import { CARS } from '../src/vehicles/cars';
import { trackerFrom } from '../src/ai/netTracker';
import type { SelfState, TrafficBox } from '../src/ai/sensors';

/**
 * Why the AI pulses brake / throttle passing close beside traffic: races (as planner.train.ts) with every step's
 * pedals put down to their cause - the emergency brake, a fallback plan (none found), a relaxed plan, or the plan's
 * own speed - split by whether a vehicle is alongside (overlapping along the road, within BESIDE_GAP m sideways).
 *   CAR=jdm EVAL_SEEDS=7001,7002 npx vitest run --config training/vitest.config.ts training/passBrake.train.ts
 * TRACE=1 prints the first episodes step by step.
 */
const BESIDE_GAP = Number(process.env.BESIDE_GAP ?? 1);

type Cause = 'emergency' | 'fallback' | 'relaxed' | 'plan';
interface Row {
  t: number;
  gap: number; // m sideways to the nearest alongside (NaN: none)
  ds: number; // its centre ahead of ours (m)
  dv: number; // our speed minus its (m/s)
  v: number;
  planV: number; // the plan's speed for now
  planV1: number; // ...and 1 s on
  throttle: number;
  brake: number;
  cause: Cause;
  rubbing: boolean; // boxes overlapping sideways
  why: string;
}

it('pass brake', async () => {
  await RAPIER.init();
  const spec = CARS[process.env.CAR ?? 'street-racer'];
  const trace = !!process.env.TRACE;
  const tally = { beside: { steps: 0, brake: {} as Record<string, number>, lift: 0, onsets: 0 }, clear: { steps: 0, brake: {} as Record<string, number>, lift: 0, onsets: 0 } };
  const episodes: Row[][] = [];
  const planClears = [0, 0];
  const [dSeed, dFrom, dTo, dFile] = (process.env.DUMP ?? '').split(':');
  const dump = process.env.DUMP ? { seed: Number(dSeed), from: Number(dFrom), to: Number(dTo), file: process.env.DUMP.split(':').slice(3).join(':') } : null;
  const frames: unknown[] = [];
  const crashes = !!process.env.CRASHES;
  const ring: string[] = [];
  const crashLines: string[] = [];
  const clearMargin: number[] = [];
  const offsetMargin: number[] = [];
  for (const seed of (process.env.EVAL_SEEDS ?? '7001,7002,7003,7004').split(',').map(Number)) {
    const driver = new PlannerDriver();
    driver.accel = spec.ai.accel;
    driver.latAccel = spec.ai.latAccel;
    driver.tracker = trackerFrom(spec.ai.tracker);
    driver.recovery = trackerFrom(spec.ai.recovery);
    let planCause: Cause = 'plan';
    let lastPlan: unknown = null;
    let wasBraking = false;
    let ep: Row[] | null = null;
    let quiet = 0;
    let clock = 0;
    const drive = driver.drive.bind(driver);
    driver.drive = (self: SelfState, traffic: TrafficBox[], p) => {
      clock += 1 / 120;
      const o0 = driver.overrides, f0 = PLAN_STATS.fallback, r0 = PLAN_STATS.relaxed;
      const out = drive(self, traffic, p);
      if (driver.plan !== lastPlan) {
        lastPlan = driver.plan;
        planCause = PLAN_STATS.fallback > f0 ? 'fallback' : PLAN_STATS.relaxed > r0 ? 'relaxed' : 'plan';
      }
      const cause: Cause = driver.overrides > o0 ? 'emergency' : planCause;
      // CRASHES=1: what it was doing the last 2 s before each crash - would the old straight-on brake have braked?
      if (crashes && driver.plan) {
        const now = planAt(driver.plan, driver.planAge);
        const old = emergencyBrake(self, traffic, now.dRate);
        const hw2 = self.halfWidth ?? 0.93;
        let near = '';
        for (const t of traffic) {
          if (t.phantom || t.s <= self.s || t.s > self.s + 60) continue;
          const over = Math.min(t.dMax, self.d + hw2) - Math.max(t.dMin, self.d - hw2);
          if (over < -0.6) continue;
          near += ` [${t.id} ds ${(t.s - self.s).toFixed(1)} dv ${(self.vLong - t.v).toFixed(1)} over ${over.toFixed(2)} ${t.dMin.toFixed(2)}..${t.dMax.toFixed(2)}]`;
        }
        ring.push(`${clock.toFixed(2)} v ${(self.vLong * 3.6).toFixed(0)} d ${self.d.toFixed(2)} off ${(self.d - now.d).toFixed(2)} yaw ${self.yaw.toFixed(2)} plan v ${(now.v * 3.6).toFixed(0)} dRate ${now.dRate.toFixed(2)} thr ${(out.throttle ?? 0).toFixed(2)} brk ${(out.brake ?? 0).toFixed(2)} ${cause}${old > 0 && cause !== 'emergency' ? ' OLD-WOULD-BRAKE ' + old.toFixed(2) : ''}${near}`);
        if (ring.length > 300) ring.shift();
      }
      // What the emergency brake braked for: each box alone (the plan's sideways rate as PlannerDriver passes it).
      let why = '';
      if (cause === 'emergency' && driver.plan) {
        const rate = planAt(driver.plan, driver.planAge).dRate;
        for (const t of traffic) {
          if (emergencyBrake(self, [t], rate, [{ plan: driver.plan, age: driver.planAge }, { plan: driver.plan, age: driver.planAge }]) <= 0) continue;
          const hwS = self.halfWidth ?? 0.93;
          const over = Math.min(t.dMax, self.d + hwS) - Math.max(t.dMin, self.d - hwS);
          const closing = self.vLong - t.v;
          const arrive = closing > 0 ? Math.max(0, t.s - t.length / 2 - self.s - (self.halfLength ?? 2.2)) / closing : 0;
          const pd = planAt(driver.plan, driver.planAge + arrive).d;
          const clears = pd + hwS < t.dMin || pd - hwS > t.dMax;
          planClears[clears ? 1 : 0]++;
          if (clears) clearMargin.push(Math.max(t.dMin - (pd + hwS), pd - hwS - t.dMax));
          // ...with the car's own offset from the plan now carried along
          const pdo = pd + (self.d - planAt(driver.plan, driver.planAge).d);
          offsetMargin.push(Math.max(t.dMin - (pdo + hwS), pdo - hwS - t.dMax));
          why += ` [ds ${(t.s - self.s).toFixed(1)} over ${over.toFixed(2)} dv ${(self.vLong - t.v).toFixed(1)} vD ${(self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw)).toFixed(2)} plan vD ${rate.toFixed(2)} d ${self.d.toFixed(2)} t ${t.dMin.toFixed(2)}..${t.dMax.toFixed(2)}${t.phantom ? ' phantom' : ''}]`;
        }
      }
      const hw = self.halfWidth ?? 0.93, hl = self.halfLength ?? 2.2;
      let best: TrafficBox | null = null, gap = Infinity;
      for (const t of traffic) {
        if (t.phantom || Math.abs(t.s - self.s) > t.length / 2 + hl) continue;
        const g = Math.max(t.dMin - (self.d + hw), self.d - hw - t.dMax);
        if (g < gap) { gap = g; best = t; }
      }
      const beside = best !== null && gap < BESIDE_GAP;
      const k = beside ? tally.beside : tally.clear;
      k.steps++;
      const braking = (out.brake ?? 0) > 0.02;
      if (braking) k.brake[cause] = (k.brake[cause] ?? 0) + 1;
      else if ((out.throttle ?? 0) < 0.05 && self.vLong > 5) k.lift++;
      if (braking && !wasBraking) k.onsets++;
      wasBraking = braking;
      const plan = driver.plan;
      const row: Row = {
        t: clock, gap: beside ? gap : NaN, ds: best ? best.s - self.s : NaN, dv: best ? self.vLong - best.v : NaN, v: self.vLong,
        planV: plan ? planAt(plan, driver.planAge).v : NaN, planV1: plan ? planAt(plan, driver.planAge + 1).v : NaN,
        throttle: out.throttle ?? 0, brake: out.brake ?? 0, cause, rubbing: beside && gap < 0, why,
      };
      // DUMP=<seed>:<from s>:<to s>:<file.json>: every step of that stretch, for a picture of it.
      if (dump && seed === dump.seed && clock >= dump.from && clock <= dump.to && plan) {
        const trig = new Set<number>();
        if (cause === 'emergency') {
          const rate = planAt(plan, driver.planAge).dRate;
          traffic.forEach((t, i) => { if (emergencyBrake(self, [t], rate, [{ plan: driver.plan, age: driver.planAge }, { plan: driver.plan, age: driver.planAge }]) > 0) trig.add(t.id ?? -i); });
        }
        frames.push({
          t: +clock.toFixed(3), s: +self.s.toFixed(2), d: +self.d.toFixed(3), yaw: +self.yaw.toFixed(4), v: +self.vLong.toFixed(2),
          hw: self.halfWidth ?? 0.93, hl: self.halfLength ?? 2.2,
          cars: traffic.filter((t) => !t.phantom && t.s > self.s - 30 && t.s < self.s + 80).map((t, i) => ({
            id: t.id ?? -i, s: +t.s.toFixed(2), dMin: +t.dMin.toFixed(3), dMax: +t.dMax.toFixed(3), len: t.length, v: +t.v.toFixed(2), trig: trig.has(t.id ?? -i),
          })),
          plan: Array.from({ length: 41 }, (_, j) => { const p = planAt(plan, driver.planAge + j * 0.1); return [+p.s.toFixed(2), +p.d.toFixed(3)]; }),
          thr: +(out.throttle ?? 0).toFixed(3), brk: +(out.brake ?? 0).toFixed(3), cause,
        });
      }
      if (beside) { ep ??= []; ep.push(row); quiet = 0; }
      else if (ep && ++quiet > 60) { if (ep.some((r) => r.brake > 0.02)) episodes.push(ep); ep = null; }
      else if (ep) ep.push(row);
      return out;
    };
    const sim = new TrainingSim([driver], seed, { spec, speedCap: 300 / 3.6, trafficSeesCars: true, resetOnCrash: 60 / 3.6 });
    let crashCount = 0;
    while (!sim.done) {
      sim.step();
      const log = sim.ghosts[0].result.crashLog ?? [];
      if (crashes && log.length > crashCount) {
        crashCount = log.length;
        crashLines.push(`=== seed ${seed} crash at ${clock.toFixed(2)} s (${Math.round(log[log.length - 1].kmh)} km/h)`);
        for (let i = Math.max(0, ring.length - 240); i < ring.length; i += 12) crashLines.push('  ' + ring[i]);
        crashLines.push('  ' + ring[ring.length - 1]);
        ring.length = 0;
      }
    }
    sim.dispose();
  }
  const show = (n: string, k: typeof tally.beside) =>
    `${n}: ${k.steps} steps (${(k.steps / 120).toFixed(0)} s), braking ${Object.entries(k.brake).map(([c, x]) => `${c} ${(x / 120).toFixed(1)} s`).join(', ') || 'none'}, brake onsets ${k.onsets}, lifted (no pedal) ${(k.lift / 120).toFixed(1)} s`;
  if (dump) writeFileSync(dump.file, JSON.stringify(frames));
  clearMargin.sort((a, b) => a - b);
  const share = (m: number) => ((100 * offsetMargin.filter((x) => x > m).length) / Math.max(1, offsetMargin.length)).toFixed(0) + '%';
  const lines = [`with its offset from the plan carried along, clear by > 0 / 0.3 / 0.45 / 0.6 m: ${share(0)} / ${share(0.3)} / ${share(0.45)} / ${share(0.6)} of ${offsetMargin.length}`, `emergency-braked boxes: the plan's own path clears them by the time it gets there ${planClears[1]} of ${planClears[0] + planClears[1]} (margin p10 / p50 ${clearMargin[Math.floor(clearMargin.length * 0.1)]?.toFixed(2)} / ${clearMargin[Math.floor(clearMargin.length * 0.5)]?.toFixed(2)} m)`, show(`alongside (gap < ${BESIDE_GAP} m)`, tally.beside), show('otherwise', tally.clear), `episodes alongside with braking: ${episodes.length}`];
  // Per episode: onsets, causes, closest gap.
  for (const e of episodes.slice(0, 40)) {
    const on = e.filter((r, i) => r.brake > 0.02 && !(e[i - 1]?.brake > 0.02));
    const causes = [...new Set(e.filter((r) => r.brake > 0.02).map((r) => r.cause))].join('/');
    const g = Math.min(...e.filter((r) => !Number.isNaN(r.gap)).map((r) => r.gap));
    lines.push(`  t ${e[0].t.toFixed(1)}: ${(e.length / 120).toFixed(1)} s, brake onsets ${on.length} (${causes}), min gap ${g.toFixed(2)} m, v ${(e[0].v * 3.6).toFixed(0)} -> min ${(Math.min(...e.map((r) => r.v)) * 3.6).toFixed(0)} km/h`);
  }
  if (trace) for (const e of episodes.slice(0, Number(process.env.TRACE))) {
    lines.push(`--- episode t ${e[0].t.toFixed(1)}`);
    for (let i = 0; i < e.length; i += 6) {
      const r = e[i];
      lines.push(`  ${r.t.toFixed(2)} gap ${Number.isNaN(r.gap) ? '  -  ' : r.gap.toFixed(2)} ds ${r.ds.toFixed(1)} dv ${r.dv.toFixed(1)} v ${(r.v * 3.6).toFixed(0)} plan ${(r.planV * 3.6).toFixed(0)}>${(r.planV1 * 3.6).toFixed(0)} thr ${r.throttle.toFixed(2)} brk ${r.brake.toFixed(2)} ${r.brake > 0.02 ? r.cause : ''}${r.why}`);
    }
  }
  process.stdout.write(lines.join('\n') + '\n' + crashLines.join('\n') + '\n');
}, 3_600_000);
