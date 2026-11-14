import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { PLAN_STATS, PLANNER, planAt } from '../src/ai/planner';
import { COURSE, COURSE_STATS } from '../src/ai/coursePlanner';
import { DRIVER_TUNING, PlannerDriver } from '../src/ai/plannerDriver';
import { TrainingSim } from '../src/ai/trainingSim';
import { LANE_TUNING } from '../src/ai/laneController';
import { laneAt, laneCenter } from '../src/road/coords';
import { LANE_COUNT, ROAD_HALF_WIDTH } from '../src/config';
import { CARS } from '../src/vehicles/cars';
import { trackerFrom } from '../src/ai/netTracker';

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const a = xs.map(Math.abs).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
};
const f = (x: number) => x.toFixed(2);

/**
 * Benchmark: the planner with plain controllers on unseen traffic, and how
 * closely the car follows its plans (to size the planner's margins from).
 *   EVAL_SEEDS=7001,7002 CAP_KMH=300 npx vitest run --config training/vitest.config.ts training/planner.train.ts
 */
it('planner', async () => {
  // PLANNER_JSON='{"hardBrake":11}': try planner settings without editing the code.
  if (process.env.PLANNER_JSON) Object.assign(PLANNER, JSON.parse(process.env.PLANNER_JSON));
  // COURSE_JSON='{"beam":1000}': the course planner's settings changed without editing the code (investigation).
  if (process.env.COURSE_JSON) Object.assign(COURSE, JSON.parse(process.env.COURSE_JSON));
  if (process.env.EMERGENCY_FROM) DRIVER_TUNING.emergencyFrom = Number(process.env.EMERGENCY_FROM);
  // DRIVER_JSON='{"pathAgree":99}': the driver's settings changed without editing the code.
  if (process.env.DRIVER_JSON) Object.assign(DRIVER_TUNING, JSON.parse(process.env.DRIVER_JSON));
  if (process.env.LANE_K) LANE_TUNING.k = Number(process.env.LANE_K); // the tracker's pull back onto the plan (1/s)
  if (process.env.NET_TRACKER) DRIVER_TUNING.netTracker = process.env.NET_TRACKER !== '0'; // 0: the plain tracker, not the car's trained network
  await RAPIER.init();
  const out: string[] = [];
  const all = { lateralMoving: [] as number[], lateralHolding: [] as number[], along: [] as number[], speedAtOverride: [] as number[], nowMoving: [] as number[], nowHolding: [] as number[] };
  // CAR=muscle-car: that car type, with its own tables and steering network (CAR_JSON='{"rearGrip":1.35}':
  // its params changed, as in training/cornering.train.ts).
  const base = CARS[process.env.CAR ?? 'street-racer'];
  if (!base) throw new Error(`no car "${process.env.CAR}" (have: ${Object.keys(CARS).join(', ')})`);
  const spec = { ...base, params: { ...base.params, ...JSON.parse(process.env.CAR_JSON ?? '{}') } };
  for (const seed of (process.env.EVAL_SEEDS ?? '7001,7002,7003,7004,7005').split(',').map(Number)) {
    const driver = new PlannerDriver();
    driver.accel = spec.ai.accel;
    driver.latAccel = spec.ai.latAccel;
    driver.brake = spec.ai.brake;
    // TRACKER_JSON=<archive.json>: a candidate network (training/out/tracker) instead of the car's own.
    driver.tracker = trackerFrom(process.env.TRACKER_JSON ? JSON.parse(readFileSync(process.env.TRACKER_JSON, 'utf8')).weights : spec.ai.tracker);
    driver.recovery = trackerFrom(spec.ai.recovery);
    const st = driver.measure();
    // Traffic gives way to the AI car as it does the player in the game (TRAFFIC_BLIND=1: as in training).
    const sim = new TrainingSim([driver], seed, { spec, speedCap: Number(process.env.CAP_KMH ?? 300) / 3.6, trafficSeesCars: !process.env.TRAFFIC_BLIND,
      // RESET_ON_CRASH=60: a crash puts the car back on the road at 60 km/h, as a rival in the game, and it races on.
      resetOnCrash: process.env.RESET_ON_CRASH ? Number(process.env.RESET_ON_CRASH) / 3.6 : undefined,
      // GAME_CONTACT=1: as in the game - the car hits the traffic for real (a hard hit wrecks it), put back only once
      // stuck (under 5 km/h for 2 s, as a rival in the game); "light contacts" then counts the vehicles it wrecked.
      gameContact: process.env.GAME_CONTACT === '1',
    });
    // TRACE_CONTACT=1 (investigation): the last TRACE_S s before each wreck / reset, every 0.1 s.
    const trace = process.env.TRACE_CONTACT === '1';
    const ring: string[] = [];
    const traceKeep = Math.round(Number(process.env.TRACE_S ?? 3) * 10);
    let lastContacts = 0, lastResets = 0, stepN = 0, lastOver = 0, planKind = 'N';
    const planCount: Record<string, number> = { N: 0, R: 0, F: 0, U: 0, short: 0 };
    let lastEmerT = -99;
    const snaps: any[] = [], wreckTimes: number[] = [];
    if (trace) {
      const orig = driver.drive.bind(driver);
      driver.drive = (self, traffic, p) => {
        const c0 = { ...COURSE_STATS }, l0 = { ...PLAN_STATS }, was = driver.plan, ageBefore = driver.planAge;
        const out = orig(self, traffic, p);
        stepN++;
        if (driver.plan && driver.plan !== was) {
          planKind = COURSE_STATS.reused > c0.reused ? 'U' : COURSE_STATS.fallback > c0.fallback || PLAN_STATS.fallback > l0.fallback ? 'F' : COURSE_STATS.relaxed > c0.relaxed || PLAN_STATS.relaxed > l0.relaxed ? 'R' : 'N';
          const end = driver.plan.points[driver.plan.points.length - 1].t;
          planCount[planKind]++;
          if (planKind !== 'F' && end < 7.5) planCount.short++;
          // A collapse: a full plan followed by one ending within 1.5 s (not the fallback) - snapshot it for replay.
          const wasEnd = was ? was.points[was.points.length - 1].t : 0;
          if (was && planKind !== 'F' && end < 1.5 && wasEnd >= 7.5) {
            const age = ageBefore + 1 / 120;
            const at = planAt(was, age);
            const vD = self.vLong * Math.sin(self.yaw) + self.vLat * Math.cos(self.yaw);
            const ego = { s: self.s, d: self.d, v: self.vLong, speedCap: self.speedCap, vD, accel: driver.accel, latAccel: driver.latAccel, ...(driver.brake ? { brake: driver.brake } : {}),
              halfWidth: self.halfWidth, halfLength: self.halfLength, yaw: self.yaw, vLat: self.vLat, turnMax: Math.tan(p.maxSteer) / p.wheelbase };
            snaps.push({ seed, t: stepN / 120, kind: planKind, end, ego, traffic: traffic.map((b) => ({ ...b })), previous: { plan: was, age }, err: { d: self.d - at.d, s: self.s - at.s, v: self.vLong - at.v },
              emerRecent: stepN / 120 - lastEmerT < 0.5, yaw: self.yaw, vLat: self.vLat, wreckAfter: null as number | null });
          }
        }
        const emer = driver.overrides > lastOver;
        if (emer) lastEmerT = stepN / 120;
        lastOver = driver.overrides;
        if (stepN % 12 === 0 && driver.plan) {
          const a = driver.planAge, P = driver.plan;
          const pa = (x: number) => planAt(P, a + x);
          const n = traffic.filter((b) => b.s - self.s < 45 && b.s - self.s > -8 && Math.abs((b.dMin + b.dMax) / 2 - self.d) < 6)
            .map((b) => `${b.phantom ? 'p' : ''}#${b.id}[ds ${(b.s - b.length / 2 - self.s - (self.halfLength ?? 2.2)).toFixed(1)} d ${b.dMin.toFixed(1)}..${b.dMax.toFixed(1)} v ${(b.v * 3.6).toFixed(0)}]`).join(' ');
          ring.push(`  t ${(stepN / 120).toFixed(1)} s ${self.s.toFixed(0)} d ${self.d.toFixed(2)} yaw ${self.yaw.toFixed(3)} v ${(self.vLong * 3.6).toFixed(0)} vLat ${self.vLat.toFixed(2)} | in st ${out.steer.toFixed(2)} th ${out.throttle.toFixed(2)} br ${out.brake.toFixed(2)}${emer ? ' EMER' : ''} | plan d ${pa(0).d.toFixed(2)}/${pa(0.5).d.toFixed(2)}/${pa(1).d.toFixed(2)}/${pa(2).d.toFixed(2)} v ${(pa(0).v * 3.6).toFixed(0)}/${(pa(1).v * 3.6).toFixed(0)} dRate ${pa(0).dRate.toFixed(2)} ${planKind}${P.points[P.points.length - 1].t.toFixed(2)} | ${n}`);
          if (ring.length > traceKeep) ring.shift();
        }
        return out;
      };
    }
    let maxV = 0;
    let offCentre = 0;
    let outward = 0; // past an outer lane's centre (0.25 m+)
    let overEdge = 0; // part of the car past the paved road's edge
    let steps = 0;
    const t0 = performance.now();
    while (!sim.done) {
      sim.step();
      const c = sim.ghosts[0].car;
      if (trace) {
        const rr = sim.ghosts[0].result;
        if ((rr.contacts ?? 0) > lastContacts || (rr.resets ?? 0) > lastResets) {
          if ((rr.contacts ?? 0) > lastContacts) wreckTimes.push(sim.time);
          out.push(`${seed} ${(rr.contacts ?? 0) > lastContacts ? 'WRECK' : 'RESET'} at t ${sim.time.toFixed(2)} s ${c.s.toFixed(0)} d ${c.d.toFixed(2)} yaw ${c.yaw.toFixed(3)} v ${(c.speed * 3.6).toFixed(0)}`, ...ring);
          // Each vehicle wrecked this step: where it was against the car (ahead / behind / level, body to body), how fast.
          for (const w of sim.wrecks.splice(0)) {
            const b = w.box;
            if (!b) {
              out.push(`${seed} WRECKED ? closing ${(w.closing * 3.6).toFixed(0)}`);
              continue;
            }
            const hl = spec.params.length / 2, hw = spec.params.width / 2;
            const front = b.s - b.length / 2 - (w.s + hl), back = w.s - hl - (b.s + b.length / 2);
            const side = Math.max(b.dMin - (w.d + hw), w.d - hw - b.dMax);
            const where = front > -0.5 ? 'AHEAD' : back > -0.5 ? 'BEHIND' : 'LEVEL';
            out.push(`${seed} WRECKED ${where} gap along ${Math.max(front, back).toFixed(2)} across ${side.toFixed(2)} its v ${(b.v * 3.6).toFixed(0)} ours ${(w.speed * 3.6).toFixed(0)} closing ${(w.closing * 3.6).toFixed(0)} yaw ${w.yaw.toFixed(3)} n ${w.nx.toFixed(2)},${w.nz.toFixed(2)}`);
          }
          lastContacts = rr.contacts ?? 0;
          lastResets = rr.resets ?? 0;
        }
      }
      maxV = Math.max(maxV, c.speed);
      steps++;
      if (Math.abs(c.d - laneCenter(laneAt(c.d))) > 0.5) offCentre++;
      if (Math.abs(c.d) > laneCenter(LANE_COUNT - 1) + 0.25) outward++;
      if (Math.abs(c.d) + spec.params.width / 2 > ROAD_HALF_WIDTH) overEdge++;
    }
    const ms = performance.now() - t0;
    if (trace && process.env.SNAP_DIR) {
      for (const sn of snaps) sn.wreckAfter = wreckTimes.find((w) => w >= sn.t && w - sn.t < 3) ?? null;
      writeFileSync(`${process.env.SNAP_DIR}/${process.env.CAR ?? 'street-racer'}.${seed}.json`, JSON.stringify(snaps));
    }
    if (trace) out.push(`${seed} collapses ${snaps.length} (followed by a wreck within 3 s: ${snaps.filter((x) => wreckTimes.some((w) => w >= x.t && w - x.t < 3)).length}), wrecks ${wreckTimes.length} (a collapse within 3 s before: ${wreckTimes.filter((w) => snaps.some((x) => w >= x.t && w - x.t < 3)).length})`);
    if (trace) out.push(`${seed} plans normal ${planCount.N} relaxed ${planCount.R} fallback ${planCount.F} reused ${planCount.U}; non-fallback ending before 7.5 s: ${planCount.short}`);
    const g = sim.ghosts[0];
    const r = g.result;
    const end = r.finishTime !== null ? `FINISH ${r.finishTime.toFixed(0)}s` : r.crashed ? `CRASH at ${Math.round(r.distance)} m` : `timeout at ${Math.round(r.distance)} m`;
    out.push(
      `${seed}: ${end}, avg ${Math.round((r.distance / sim.time) * 3.6)} km/h, max ${Math.round(maxV * 3.6)}, lane changes ${g.laneChanges}, ` +
        `off lane centre ${Math.round((100 * offCentre) / steps)}%, past outer lane centre ${((100 * outward) / steps).toFixed(1)}% (over the edge ${((100 * overEdge) / steps).toFixed(1)}%), light contacts ${r.contacts}, resets ${r.resets ?? 0}, emergency brake ${Math.round((100 * driver.overrides) / steps)}% of steps, ${(ms / 1000).toFixed(1)} s cpu`,
    );
    // Each crash: off the road (O) or into traffic (T), sliding just before it (*), and the speed.
    if (r.crashLog?.length) out.push(`  crashes: ${r.crashLog.map((k) => `${k.offRoad ? 'O' : 'T'}${k.sliding ? '*' : ''}${Math.round(k.kmh)}`).join(' ')}`);
    for (const k of Object.keys(all) as (keyof typeof all)[]) all[k].push(...st[k]);
    sim.dispose();
  }
  out.push(
    `tracking 0.75 s after a plan (p50 / p95 / max, m): lateral while moving ${f(pct(all.lateralMoving, 0.5))} / ${f(pct(all.lateralMoving, 0.95))} / ${f(pct(all.lateralMoving, 1))}` +
      `, holding ${f(pct(all.lateralHolding, 0.5))} / ${f(pct(all.lateralHolding, 0.95))} / ${f(pct(all.lateralHolding, 1))}` +
      `, along ${f(pct(all.along, 0.5))} / ${f(pct(all.along, 0.95))} / ${f(pct(all.along, 1))} (ahead of plan ${Math.round((100 * all.along.filter((x) => x > 0).length) / Math.max(1, all.along.length))}%)`,
  );
  out.push(
    `tracker alone (off the plan it follows, now; p50 / p95 / max, m): moving ${f(pct(all.nowMoving, 0.5))} / ${f(pct(all.nowMoving, 0.95))} / ${f(pct(all.nowMoving, 1))}` +
      `, holding ${f(pct(all.nowHolding, 0.5))} / ${f(pct(all.nowHolding, 0.95))} / ${f(pct(all.nowHolding, 1))}`,
  );
  const plans = PLAN_STATS.normal + PLAN_STATS.relaxed + PLAN_STATS.fallback;
  out.push(`plans: ${plans}, relaxed ${Math.round((100 * PLAN_STATS.relaxed) / plans)}%, boxed-in fallback ${Math.round((100 * PLAN_STATS.fallback) / plans)}%, ${(PLAN_STATS.ms / plans).toFixed(1)} ms a plan (slowest ${PLAN_STATS.slowest.toFixed(0)})`);
  const cp = COURSE_STATS.normal + COURSE_STATS.relaxed + COURSE_STATS.fallback;
  if (cp) out.push(`course plans: ${cp}, reused ${COURSE_STATS.reused}, relaxed ${Math.round((100 * COURSE_STATS.relaxed) / cp)}%, fallback ${Math.round((100 * COURSE_STATS.fallback) / cp)}%, ${(COURSE_STATS.ms / cp).toFixed(1)} ms a plan`);
  const sa = all.speedAtOverride;
  out.push(`at emergency brake: speed over plan p50 ${f(pct(sa, 0.5))} m/s, faster than plan ${Math.round((100 * sa.filter((x) => x > 0).length) / Math.max(1, sa.length))}% of the time`);
  process.stdout.write(out.join('\n') + '\n');
});
