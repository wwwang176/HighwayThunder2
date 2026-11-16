import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { type Brain, mutate } from '../src/ai/brain';
import { DEFAULT_EVO, nextGeneration } from '../src/ai/evolution';
import { mountainNetFrom, quietMountainNet } from '../src/ai/mountainNet';
import { mulberry32 } from '../src/ai/rng';
import { CARS } from '../src/vehicles/cars';
import type { RunResult } from './mountainNetEval';
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
 * car's weights file) only if, against the start's, it touched the walls no more, lagged its plan no more, was put
 * back no more and was no more than 1 % slower.
 *   CAR=street-racer GENS=30 POP=40 THREADS=12 SAVE=1 npx vitest run --config training/vitest.config.ts training/mountainNet.train.ts
 */
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
const VALID_EVERY = Number(process.env.VALID_EVERY ?? 5);
const VALID_SEEDS = (process.env.VALID_SEEDS ?? '9001,9002,9003,9004,9005').split(',').map(Number);
const VALID_S = 160;

function camel(id: string): string {
  return id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

/** A car's mountain network weights file and its export (src/vehicles/cars/<camel>MountainNet.ts). */
export function mountainNetFile(id: string): { path: string; exportName: string } {
  return { path: `src/vehicles/cars/${camel(id)}MountainNet.ts`, exportName: `${id.replace(/-/g, '_').toUpperCase()}_MOUNTAIN_NET` };
}

const line = (r: RunResult) =>
  `cost ${r.cost.toFixed(2)} lag ${r.lag.toFixed(2)} walls ${r.walls} (line ${r.lineWalls}) resets ${r.resets} metres ${r.metres.toFixed(0)}${r.time !== null ? ` time ${r.time.toFixed(2)}` : ''}${r.nan ? ' NaN' : ''}`;

it('mountain driving network', async () => {
  if (!SPEC) throw new Error(`no car ${CAR}`);
  const rng = mulberry32(Number(process.env.SEED ?? 1));
  const evo = { ...DEFAULT_EVO, population: Number(process.env.POP ?? 40), sigma: Number(process.env.SIGMA ?? 0.1) };
  const start: Brain = (process.env.CONTINUE && mountainNetFrom(SPEC.ai.mountainTracker)) || quietMountainNet(rng);
  let pop: Brain[] = Array.from({ length: evo.population }, (_, i) => (i === 0 ? start : mutate(start, rng, evo.sigma, evo.rate)));
  const pool = await ExamPool.start(THREADS, 'mountainNetWorker');
  const archive = new URL(`./out/mountainNet/${process.env.ARCHIVE ? process.env.ARCHIVE + '/' : ''}`, import.meta.url);
  mkdirSync(archive, { recursive: true });
  const exam = async (brains: Brain[], seeds: number[], soloS: number, raceSeeds: number[], raceS: number): Promise<RunResult[]> => {
    const parts = chunks(brains, THREADS * 2);
    const out = await Promise.all(parts.map((b) => pool.run<RunResult[]>({ brains: b, car: CAR, seeds, soloS, raceSeeds, raceS } satisfies MountainExam)));
    return out.flat();
  };
  const log = (s: string) => process.stdout.write(s + '\n');
  log(`${CAR}: ${GENS} generations of ${evo.population}, ${THREADS} threads, solo ${SOLO_SEEDS} x ${SOLO_S} s, race ${RACE_SEEDS} x ${RACE_S} s`);
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
      const cost = res.map((r) => r.cost + GUARD * Math.max(0, r.cost - startRes.cost - GUARD_EPS));
      const order = cost.map((_, i) => i).sort((a, b) => cost[a] - cost[b]);
      log(`gen ${String(g).padStart(2)} (${((performance.now() - t0) / 1000).toFixed(0)} s): best ${line(res[order[0]])} | start ${line(startRes)}`);
      if ((g + 1) % VALID_EVERY === 0 || g === GENS - 1) {
        const best = pop[order[0]];
        const v = (await exam([best], VALID_SEEDS, VALID_S, [], 0))[0];
        const ok = v.walls <= startValid.walls && v.lag <= startValid.lag && v.resets <= startValid.resets && !v.nan && (v.time ?? Infinity) <= (startValid.time ?? Infinity) * 1.01;
        log(`  validation: ${line(v)}${ok ? '  KEPT' : ''}`);
        writeFileSync(new URL(`${CAR}-g${g}.json`, archive), JSON.stringify({ gen: g, valid: v, start: startValid, weights: Array.from(best.weights) }));
        if (ok) kept = best;
      }
      pop = nextGeneration(pop, cost.map((c) => -c), rng, evo);
    }
  } finally {
    await pool.close();
  }
  if (kept && process.env.SAVE) {
    const f = mountainNetFile(CAR);
    writeFileSync(
      new URL(`../${f.path}`, import.meta.url),
      `/** The ${CAR}'s mountain driving network (src/ai/mountainNet.ts), trained by training/mountainNet.train.ts. */\n` +
        `export const ${f.exportName}: number[] = ${JSON.stringify(Array.from(kept.weights, (w) => +w.toFixed(5)))};\n`,
    );
    log(`saved ${f.path}`);
  } else log(kept ? 'kept one (SAVE=1 to write it)' : 'none kept');
});
