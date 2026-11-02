import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDriver, serializeDriver } from '../src/ai/driverFile';
import { Trainer } from '../src/ai/trainer';

/**
 * The training page's Trainer, run without drawing at full speed. Several can
 * run side by side (one per process) with different seeds; each writes its
 * best validated network to training/out/seed-<seed>.json as it improves.
 *
 *   TRAIN_SEED=1 TRAIN_GENERATIONS=200 npx vitest run --config training/vitest.config.ts
 */
it('train', async () => {
  await RAPIER.init();
  const seed = Number(process.env.TRAIN_SEED ?? 1);
  const generations = Number(process.env.TRAIN_GENERATIONS ?? 100);
  const outDir = resolve(import.meta.dirname, 'out');
  mkdirSync(outDir, { recursive: true });
  const out = resolve(outDir, `seed-${seed}.json`);
  const logFile = resolve(outDir, `seed-${seed}.log`);
  writeFileSync(logFile, '');
  // vitest holds console output until the test ends, so progress also goes to a file.
  const log = (s: string) => appendFileSync(logFile, `${s}\n`);

  // TRAIN_FROM: comma-separated driver files to continue from (the population starts as them + mutations).
  const from = (process.env.TRAIN_FROM ?? '').split(',').filter(Boolean);
  const seedBrains = from.map((p) => parseDriver(JSON.parse(readFileSync(resolve(p), 'utf8'))));
  if (seedBrains.length) log(`starting from ${from.join(', ')}`);
  const t = new Trainer({ seed, seedBrains });
  let bestSaved = -Infinity;
  const t0 = Date.now();
  while (t.generation <= generations) {
    const gen = t.generation;
    while (t.generation === gen) t.tick(2000);
    while (t.validating) t.validateTick(5000);
    const h = t.history[t.history.length - 1];
    const v = h.validated;
    log(
      `gen ${h.gen} best ${Math.round(h.best)} finishes ${h.finishes} cap ${h.speedCapKmh} top10 lanes ${h.topLaneChanges?.toFixed(1)}` +
        (v ? ` | validated ${Math.round(v.mean)} finishes ${v.finishes}/${v.runs}` : '') +
        ` | ${((Date.now() - t0) / 60000).toFixed(1)} min`,
    );
    if (t.best && t.best.score > bestSaved) {
      bestSaved = t.best.score;
      const b = t.best;
      writeFileSync(out, JSON.stringify(serializeDriver(b.brain, { seed, gen: b.gen, score: b.score, finishes: b.finishes, runs: b.runs })));
      log(`saved best: gen ${b.gen} score ${Math.round(b.score)} finishes ${b.finishes}/${b.runs}`);
    }
  }
  t.dispose();
});
