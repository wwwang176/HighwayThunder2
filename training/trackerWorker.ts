import { parentPort } from 'node:worker_threads';
import type { Brain } from '../src/ai/brain';
import { evaluate, initExams, race, raceCost, RecoveryStart, recoveryCost, Scenario } from './trackerEval';

/**
 * A worker thread of the tracker training (trackerPool.ts): runs the exams (trackerEval.ts) it is sent for a share
 * of the population and answers with their results. Bundled to training/out/ before it is started (it imports the
 * game's TypeScript).
 */

/** What the training asks of a worker. */
export type ExamTask =
  | { op: 'drive'; brains: (Brain | null)[]; scenarios: Scenario[]; keepErrors: boolean }
  | { op: 'recovery'; brains: (Brain | null)[]; starts: RecoveryStart[] }
  | { op: 'raceCost'; brains: (Brain | null)[]; seed: number }
  | { op: 'race'; brain: Brain | null; seeds: number[] };

const ready = initExams();

function run(t: ExamTask): unknown {
  switch (t.op) {
    case 'drive':
      return evaluate(t.brains, t.scenarios, t.keepErrors);
    case 'recovery':
      return recoveryCost(t.brains, t.starts);
    case 'raceCost':
      return raceCost(t.brains, t.seed);
    case 'race':
      return race(t.brain, t.seeds);
  }
}

parentPort!.on('message', async ({ id, task }: { id: number; task: ExamTask }) => {
  await ready;
  try {
    parentPort!.postMessage({ id, result: run(task) });
  } catch (e) {
    parentPort!.postMessage({ id, error: String((e as Error)?.stack ?? e) });
  }
});
