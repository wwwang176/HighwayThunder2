import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { type Brain, mutate } from '../src/ai/brain';
import { DEFAULT_EVO, nextGeneration } from '../src/ai/evolution';
import { mountainNetFrom, quietMountainNet } from '../src/ai/mountainNet';
import { driftNetFrom, quietDriftNet } from '../src/ai/mountainDriftNet';
import { mulberry32 } from '../src/ai/rng';
import { CARS } from '../src/vehicles/cars';
import { type NetMode, type RunResult, slideScore } from './mountainNetEval';
import type { MountainExam } from './mountainNetWorker';
import { chunks, ExamPool } from './trackerPool';

/**
 * Trains a car's mountain driving network (src/ai/mountainNet.ts) by neuroevolution (docs/superpowers/plans/
 * 2026-11-16-mountain-planner-net.md Task 6): the population drives the mountain planner driver with it, each brain
 * on the same fresh roads a generation - SOLO_SEEDS alone for SOLO_S s, RACE_SEEDS from the grid with three rivals
 * for RACE_S s - scored by mountainNetEval.ts (lagging its plan, the walls, put-backs, the way it got). The start
 * brain (CONTINUE=1: the car's own weights; else a quiet one - its output layer 0: the driver's own control) runs the
 * same roads; a brain worse than it pays GUARD times the difference. Every VALID_EVERY generations the best is
 * examined on VALID_SEEDS whole roads alone; it is archived (training/out/mountainNet/), and kept (SAVE=1 writes the
 * car's weights file) only if, against the start's, its cost was no more (WALL_COST, METRE_GAIN, LAG_GAIN:
 * mountainNetEval.ts), it was put back no more and it got home.
 * NET=drift: its drift network instead (src/ai/mountainDriftNet.ts; the car's own driving network on its line), scored
 * by its slide (mountainNetEval.ts), kept only if it touched the walls no more, was put back no more, slid more (its
 * slideScore: through its hairpins, and into them) and was no more than DRIFT_SLOWER slower; its weights file
 * <camel>DriftNet.ts. Every generation's best is archived (picked from on many roads after).
 *   CAR=street-racer GENS=30 POP=40 THREADS=12 SAVE=1 npx vitest run --config training/vitest.config.ts training/mountainNet.train.ts
 */
const MODE: NetMode = process.env.NET === 'drift' ? 'drift' : 'line'; // (not MODE: vitest's own)
const DRIFT_SLOWER = 0.05;
const CAR = process.env.CAR ?? 'street-racer';
const SPEC = CARS[CAR];
const GENS = Number(process.env.GENS ?? 30);
const THREADS = Number(process.env.THREADS ?? 12);
const SOLO_SEEDS = Number(process.env.SOLO_SEEDS ?? 2);
const SOLO_S = Number(process.env.SOLO_S ?? 60);
const RACE_SEEDS = Number(process.env.RACE_SEEDS ?? 1);
const RACE_S = Number(process.env.RACE_S ?? 40);
const GUARD = Number(process.env.GUARD ?? 20);
const GUARD_EPS = 0.05;
const WALL_GUARD = Number(process.env.WALL_GUARD ?? 30);
const VALID_EVERY = Number(process.env.VALID_EVERY ?? 5);
const VALID_SEEDS = (process.env.VALID_SEEDS ?? '9001,9002,9003,9004,9005').split(',').map(Number);
const VALID_S = 160;

function camel(id: string): string {
  return id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

/** A car's mountain network weights file and its export (src/vehicles/cars/<camel>MountainNet.ts; its drift network's <camel>DriftNet.ts). */
export function mountainNetFile(id: string, mode: NetMode = 'line'): { path: string; exportName: string } {
  const [file, name] = mode === 'drift' ? ['DriftNet', 'DRIFT_NET'] : ['MountainNet', 'MOUNTAIN_NET'];
  return { path: `src/vehicles/cars/${camel(id)}${file}.ts`, exportName: `${id.replace(/-/g, '_').toUpperCase()}_${name}` };
}

const line = (r: RunResult) =>
  `cost ${r.cost.toFixed(2)} lag ${r.lag.toFixed(2)} walls ${r.walls} (line ${r.lineWalls}, exit ${r.exitWalls}, graded ${r.hit.toFixed(1)}) resets ${r.resets} metres ${r.metres.toFixed(0)}${r.time !== null ? ` time ${r.time.toFixed(2)}` : ''} slide most ${(r.angle / Math.max(1, r.pins)).toFixed(1)}° through ${(r.mean / Math.max(1, r.pins)).toFixed(1)}° into ${r.entered}/${r.pins} score ${slideScore(r).toFixed(1)}${r.nan ? ' NaN' : ''}`;

it('mountain driving network', async () => {
  if (!SPEC) throw new Error(`no car ${CAR}`);
  const rng = mulberry32(Number(process.env.SEED ?? 1));
  const evo = { ...DEFAULT_EVO, population: Number(process.env.POP ?? 40), sigma: Number(process.env.SIGMA ?? 0.1) };
  const start: Brain =
    MODE === 'drift'
      ? (process.env.CONTINUE && driftNetFrom(SPEC.ai.mountainDrift)) || quietDriftNet(rng)
      : (process.env.CONTINUE && mountainNetFrom(SPEC.ai.mountainTracker)) || quietMountainNet(rng);
  let pop: Brain[] = Array.from({ length: evo.population }, (_, i) => (i === 0 ? start : mutate(start, rng, evo.sigma, evo.rate)));
  const pool = await ExamPool.start(THREADS, 'mountainNetWorker');
  const archive = new URL(`./out/mountainNet/${process.env.ARCHIVE ? process.env.ARCHIVE + '/' : ''}`, import.meta.url);
  mkdirSync(archive, { recursive: true });
  const exam = async (brains: Brain[], seeds: number[], soloS: number, raceSeeds: number[], raceS: number): Promise<RunResult[]> => {
    const parts = chunks(brains, THREADS * 2);
    const out = await Promise.all(parts.map((b) => pool.run<RunResult[]>({ brains: b, car: CAR, seeds, soloS, raceSeeds, raceS, mode: MODE } satisfies MountainExam)));
    return out.flat();
  };
  const log = (s: string) => process.stdout.write(s + '\n');
  log(`${CAR} (${MODE}): ${GENS} generations of ${evo.population}, ${THREADS} threads, solo ${SOLO_SEEDS} x ${SOLO_S} s, race ${RACE_SEEDS} x ${RACE_S} s`);
  const startValid = (await exam([start], VALID_SEEDS, VALID_S, [], 0))[0];
  log(`start, validation: ${line(startValid)}`);
  let kept: Brain | null = null;
  try {
    for (let g = 0; g < GENS; g++) {
      const t0 = performance.now();
      const seeds = Array.from({ length: SOLO_SEEDS }, (_, i) => 20000 + g * 10 + i);
      const raceSeeds = Array.from({ length: RACE_SEEDS }, (_, i) => 30000 + g * 10 + i);
      const res = await exam([...pop, start], seeds, SOLO_S, raceSeeds, RACE_S);
      const startRes = res.pop()!;
      // (the drift network's: a wall more than the start's on the same roads WALL_GUARD more besides - its slide not
      // bought with walls: guarded on its cost alone, the first round's slid more on its few roads and hit more walls
      // on 30 others)
      const cost = res.map((r) => r.cost + GUARD * Math.max(0, r.cost - startRes.cost - GUARD_EPS) + (MODE === 'drift' ? WALL_GUARD * Math.max(0, r.walls - startRes.walls) : 0));
      const order = cost.map((_, i) => i).sort((a, b) => cost[a] - cost[b]);
      log(`gen ${String(g).padStart(2)} (${((performance.now() - t0) / 1000).toFixed(0)} s): best ${line(res[order[0]])} | start ${line(startRes)}`);
      const best = pop[order[0]];
      const file = new URL(`${CAR}-${MODE === 'drift' ? 'drift-' : ''}g${g}.json`, archive);
      // (every generation's best archived - to be picked from on many roads after: a good one between validations was lost)
      writeFileSync(file, JSON.stringify({ gen: g, exam: res[order[0]], weights: Array.from(best.weights) }));
      if ((g + 1) % VALID_EVERY === 0 || g === GENS - 1) {
        const v = (await exam([best], VALID_SEEDS, VALID_S, [], 0))[0];
        const ok =
          MODE === 'drift'
            ? v.walls <= startValid.walls && v.resets <= startValid.resets && !v.nan && slideScore(v) > slideScore(startValid) && (v.time ?? Infinity) <= (startValid.time ?? Infinity) * (1 + DRIFT_SLOWER)
            : // (its cost - walls against time as weighed there - no more than the start's: the driver alone now on full
              // throttle out of drifts, a good one trades a little time for many walls; on time within 1 % none was)
              v.cost <= startValid.cost && v.resets <= startValid.resets && !v.nan && v.time !== null;
        log(`  validation: ${line(v)}${ok ? '  KEPT' : ''}`);
        writeFileSync(file, JSON.stringify({ gen: g, exam: res[order[0]], valid: v, start: startValid, weights: Array.from(best.weights) }));
        if (ok) kept = best;
      }
      pop = nextGeneration(pop, cost.map((c) => -c), rng, evo);
    }
  } finally {
    await pool.close();
  }
  if (kept && process.env.SAVE) {
    const f = mountainNetFile(CAR, MODE);
    const what = MODE === 'drift' ? 'drift network (src/ai/mountainDriftNet.ts), trained by training/mountainNet.train.ts NET=drift' : 'driving network (src/ai/mountainNet.ts), trained by training/mountainNet.train.ts';
    writeFileSync(
      new URL(`../${f.path}`, import.meta.url),
      `/** The ${CAR}'s mountain ${what}. */\n` +
        `export const ${f.exportName}: number[] = ${JSON.stringify(Array.from(kept.weights, (w) => +w.toFixed(5)))};\n`,
    );
    log(`saved ${f.path}`);
  } else log(kept ? 'kept one (SAVE=1 to write it)' : 'none kept');
});
