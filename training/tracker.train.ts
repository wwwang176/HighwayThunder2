import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { trackerFile } from '../src/ai/aiTopSpeed';
import type { Brain } from '../src/ai/brain';
import { DEFAULT_EVO, nextGeneration } from '../src/ai/evolution';
import { quietTracker, trackerFrom } from '../src/ai/netTracker';
import { mulberry32 } from '../src/ai/rng';
import {
  DRIVE_EPS, DRIVE_GUARD, PER_GEN, RACE_KEEP, RACE_RESETS, RACE_SEEDS, RACE_TRAIN, RACE_VALIDATION_SEED, RACE_WEIGHT,
  RECOVERY, RECOVERY_VALIDATION, RECOVERY_VALIDATION_X, RECOVERY_WEIGHT, RecoveryStart, recoveryStart, Scenario, scenario, SPEC, VALIDATION,
} from './trackerEval';
import { chunks, ExamPool } from './trackerPool';

/**
 * Trains a car type's steering network (src/ai/netTracker.ts) by neuroevolution: a population of
 * cars on open ground, each following plans shaped like the planner's (physics-limited sideways
 * moves to random targets - lane centres and gaps between - replanned every 0.25 s from where the
 * car is, as in a race). Every car of a generation gets the same targets; the plain tracker drives
 * them too, for comparison. Score: squared distance off the plan, a little for jerking the wheel,
 * and spinning out is the end. Then RECOVERY a generation of a crash's aftermath: the car standing across the road
 * (30-150 deg off its heading, either way, rails each side; RECOVERY_X_FROM.._TO m across, the median's grass at
 * -10..-20), the game's own planner telling it to drive on - scored
 * by how soon it is away (straight, 40 km/h, held 1 s), how far it turned past its start, how far it swung past
 * straight (a donut: far over 2 turns, the end), weighed RECOVERY_WEIGHT against the driving.
 * The driving also pays for where it is LAG_AFTER s after each plan against that plan (the benchmark's measure: a
 * car slow to move sideways pays nothing against the plan just replanned from where it is), and a brain driving
 * worse than the network it started from (CONTINUE=1) on the same scenarios pays DRIVE_GUARD times the difference.
 * Then RACE_TRAIN a generation of the real thing: the whole population (and the start, and the plain tracker) as
 * ghosts racing RACE_TRAIN_S s from the start on a fresh seed with traffic, the game's planner making the plans - the
 * dodges, the braking, the emergency brake the open-ground plans never have - scored as the scenarios (the lag
 * against each plan 0.75 s on, the way it got) plus RESET_COST a crash (it is put back at 60 km/h and races on),
 * weighed RACE_WEIGHT; it counts as driving (the guard holds it too). The validation's driving has one such race too.
 * A checkpoint is saved only if it also races (RACE_SEEDS, RACE_S s each, traffic, a crash putting it back at
 * 60 km/h) about as far with about as few resets as the start; every validated one is archived in training/out/tracker.
 *   CAR=muscle-car GENS=40 POP=60 SCENARIOS=8 SAVE=1 npx vitest run --config training/vitest.config.ts training/tracker.train.ts
 * (CAR: the car type, default the supercar; PLANNER_JSON as the benchmark; SAVE=1 writes the car's own
 * weights file, trackerFile(): e.g. src/vehicles/cars/muscleCarTracker.ts.)
 * The exams (trackerEval.ts) run in THREADS worker threads (default 6), the population shared out among them; the
 * race exam has each brain race alone with traffic that gives way to it, as the benchmark.
 */

const THREADS = Number(process.env.THREADS ?? 6);
type Net = Brain | null;
type Drive = { cost: number[]; errs: number[][]; lags: number[][] };

const pct = (xs: number[], p: number) => {
  const a = xs.map(Math.abs).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? NaN;
};
const describe = (errs: number[]) =>
  `rms ${Math.sqrt(errs.reduce((s, x) => s + x * x, 0) / errs.length).toFixed(3)} m, p95 ${pct(errs, 0.95).toFixed(2)}, max ${pct(errs, 1).toFixed(2)}`;

it('tracker', async () => {
  const pool = await ExamPool.start(THREADS);
  const share = <T>(xs: T[]) => chunks(xs, THREADS * 3); // (finer than the threads: they finish unevenly)
  /** The exams over the population shared out: the results in the brains' order. */
  const drive = async (brains: Net[], scenarios: Scenario[], keepErrors = false): Promise<Drive> => {
    const parts = await Promise.all(share(brains).map((b) => pool.run<Drive>({ op: 'drive', brains: b, scenarios, keepErrors })));
    return { cost: parts.flatMap((p) => p.cost), errs: parts.flatMap((p) => p.errs), lags: parts.flatMap((p) => p.lags) };
  };
  const recovery = async (brains: Net[], starts: RecoveryStart[]) =>
    (await Promise.all(share(brains).map((b) => pool.run<number[]>({ op: 'recovery', brains: b, starts })))).flat();
  const raceCost = async (brains: Net[], seed: number) =>
    (await Promise.all(share(brains).map((b) => pool.run<number[]>({ op: 'raceCost', brains: b, seed })))).flat();
  /** The gate's race: its seeds side by side. */
  const race = async (b: Net) => {
    const parts = await Promise.all(RACE_SEEDS.map((seed) => pool.run<{ distance: number; resets: number }>({ op: 'race', brain: b, seeds: [seed] })));
    return { distance: parts.reduce((a, p) => a + p.distance, 0), resets: parts.reduce((a, p) => a + p.resets, 0) };
  };
  const gens = Number(process.env.GENS ?? 40);
  const evo = { ...DEFAULT_EVO, population: Number(process.env.POP ?? 40), sigma: Number(process.env.SIGMA ?? 0.1) };
  const rng = mulberry32(Number(process.env.SEED ?? 1));
  const valRng = mulberry32(99);
  const validation = Array.from({ length: VALIDATION }, () => scenario(valRng));
  // From the car's current network if it has one (CONTINUE=1), else quiet ones (the plain tracker).
  const start = process.env.CONTINUE ? trackerFrom(SPEC.ai.tracker) : null;
  let pop: Brain[] = Array.from({ length: evo.population }, (_, i) => (start && i === 0 ? start : quietTracker(rng)));
  const validRecovery = RECOVERY_VALIDATION.flatMap((deg) => RECOVERY_VALIDATION_X.map((x) => ({ yaw: (deg * Math.PI) / 180, x })));
  /** One brain's validation: the driving's cost (and its errors), the recovery's, the two weighed together. */
  let startDrive = NaN; // the start's driving on validation (the guard)
  const validate = async (b: Net) => {
    // (each scenario and heading a task of its own: one brain's validation side by side)
    const [vs, raced, recs] = await Promise.all([
      Promise.all(validation.map((sc) => pool.run<Drive>({ op: 'drive', brains: [b], scenarios: [sc], keepErrors: true }))),
      RACE_TRAIN > 0 ? raceCost([b], RACE_VALIDATION_SEED).then((c) => c[0]) : 0,
      RECOVERY_WEIGHT > 0 ? Promise.all(validRecovery.map((st) => pool.run<number[]>({ op: 'recovery', brains: [b], starts: [st] }))) : [],
    ]);
    const driving = vs.reduce((a, v) => a + v.cost[0], 0) / vs.length + RACE_WEIGHT * raced;
    const rec = recs.length ? recs.reduce((a, r) => a + r[0], 0) / recs.length : 0;
    const guard = Number.isNaN(startDrive) ? 0 : DRIVE_GUARD * Math.max(0, driving - startDrive - DRIVE_EPS);
    return { cost: driving + guard + RECOVERY_WEIGHT * rec, drive: driving, raced, rec, errs: vs.flatMap((v) => v.errs[0]), lags: vs.flatMap((v) => v.lags[0]) };
  };
  const show = (v: Awaited<ReturnType<typeof validate>>) =>
    `${v.cost.toFixed(4)} (driving ${v.drive.toFixed(4)} of it racing ${v.raced.toFixed(4)}, ${describe(v.errs)}, lag p50 ${pct(v.lags, 0.5).toFixed(2)} p95 ${pct(v.lags, 0.95).toFixed(2)}; recovery ${v.rec.toFixed(2)})`;
  const showRace = (r: { distance: number; resets: number }) => `race ${Math.round(r.distance)} m, ${r.resets} resets`;
  const base = await validate(null);
  process.stdout.write(`plain tracker on validation: ${show(base)}\n`);
  let best: { brain: Brain; cost: number } | null = null;
  let startRace = await race(null);
  process.stdout.write(`plain tracker ${showRace(startRace)}\n`);
  if (start) {
    const v = await validate(start);
    startDrive = v.drive;
    startRace = await race(start);
    best = { brain: start, cost: v.cost }; // saved only when a brain beats the start
    process.stdout.write(`its network now on validation: ${show(v)}, ${showRace(startRace)}\n`);
  }
  const archive = new URL('./out/tracker/', import.meta.url);
  mkdirSync(archive, { recursive: true });
  const t0 = performance.now();
  for (let g = 0; g < gens; g++) {
    const scenarios = Array.from({ length: PER_GEN }, () => scenario(rng));
    const everyone = start ? [...pop, null, start] : [...pop, null];
    const seeds = Array.from({ length: RACE_TRAIN }, () => 10_000 + Math.floor(rng() * 1e6)); // (none the benchmark's or the gate's)
    const starts = Array.from({ length: RECOVERY }, () => recoveryStart(rng));
    const [{ cost }, raced, rec] = await Promise.all([
      drive(everyone, scenarios),
      Promise.all(seeds.map((seed) => raceCost(everyone, seed))),
      RECOVERY > 0 && RECOVERY_WEIGHT > 0 ? recovery([...pop, null], starts) : null,
    ]);
    for (const r of raced) r.forEach((c, i) => (cost[i] += (RACE_WEIGHT * c) / RACE_TRAIN));
    if (start) {
      const ref = cost.pop()!; // the start on the same scenarios: no brain may drive much worse
      for (let i = 0; i < pop.length; i++) cost[i] += DRIVE_GUARD * Math.max(0, cost[i] - ref - DRIVE_EPS);
    }
    if (rec) rec.forEach((c, i) => (cost[i] += RECOVERY_WEIGHT * c));
    const plain = cost.pop()!;
    const order = cost.map((c, i) => i).sort((a, b) => cost[a] - cost[b]);
    let line = `gen ${g}: best ${cost[order[0]].toFixed(4)}, median ${cost[order[Math.floor(order.length / 2)]].toFixed(4)}, plain ${plain.toFixed(4)}`;
    if (g % 5 === 4 || g === gens - 1) {
      const v = await validate(pop[order[0]]);
      line += ` | validation ${show(v)}`;
      let races = true;
      if (!best || v.cost < best.cost) {
        const r = await race(pop[order[0]]);
        races = r.distance >= RACE_KEEP * startRace.distance && r.resets <= RACE_RESETS * startRace.resets + 2;
        line += ` | ${showRace(r)}${races ? '' : ' (races worse: not saved)'}`;
      }
      writeFileSync(new URL(`${SPEC.id}-g${g}.json`, archive), JSON.stringify({ gen: g, line, weights: Array.from(pop[order[0]].weights) }));
      if (races && (!best || v.cost < best.cost)) {
        best = { brain: pop[order[0]], cost: v.cost };
        if (process.env.SAVE) {
          save(best.brain, best.cost, base.cost); // stopping it any time keeps the best so far
          line += ' saved';
        }
      }
    }
    process.stdout.write(`${line}  [${((performance.now() - t0) / 1000).toFixed(0)} s]\n`);
    pop = nextGeneration(pop, cost.map((c) => -c), rng, evo);
  }
  if (best) process.stdout.write(`best on validation: ${best.cost.toFixed(4)} (plain ${base.cost.toFixed(4)})\n`);
  await pool.close();
});

function save(b: Brain, cost: number, plain: number): void {
  const w = Array.from(b.weights, (x) => Math.round(x * 1e5) / 1e5);
  const file = trackerFile(SPEC);
  writeFileSync(
    new URL(`../${file.path}`, import.meta.url),
    `// Trained by training/tracker.train.ts (validation cost ${cost.toFixed(4)}, plain tracker ${plain.toFixed(4)}).\n` +
      `export const ${file.exportName}: number[] = ${JSON.stringify(w)};\n`,
  );
}
