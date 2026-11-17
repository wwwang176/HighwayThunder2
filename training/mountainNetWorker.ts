import { parentPort } from 'node:worker_threads';
import type { Brain } from '../src/ai/brain';
import { CARS } from '../src/vehicles/cars';
import { examine, initEval, type NetMode } from './mountainNetEval';

/**
 * A worker thread of the mountain driving network's training (mountainNet.train.ts, through trackerPool.ts): examines
 * the brains it is sent (mountainNetEval.ts) and answers with their results. Bundled to training/out/ first.
 */
export interface MountainExam {
  brains: (Brain | null)[];
  car: string;
  seeds: number[];
  soloS: number;
  raceSeeds: number[];
  raceS: number;
  /** Which network the brains are (none: the driving network on its line). */
  mode?: NetMode;
}

const ready = initEval();

parentPort!.on('message', async ({ id, task }: { id: number; task: MountainExam }) => {
  await ready;
  try {
    const spec = CARS[task.car];
    parentPort!.postMessage({ id, result: task.brains.map((b) => examine(b, spec, task.seeds, task.soloS, task.raceSeeds, task.raceS, task.mode)) });
  } catch (e) {
    parentPort!.postMessage({ id, error: String((e as Error)?.stack ?? e) });
  }
});
