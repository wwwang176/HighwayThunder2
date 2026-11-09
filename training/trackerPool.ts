import { Worker } from 'node:worker_threads';
import { constants, setPriority } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';
import type { ExamTask } from './trackerWorker';

/**
 * THREADS worker threads for the tracker training's exams (trackerWorker.ts, bundled with rolldown into
 * training/out/ first: a worker thread cannot load the game's TypeScript itself). Tasks queue and go to the next
 * idle worker; each answers with what trackerEval.ts's function returns.
 */
export class ExamPool {
  private readonly idle: Worker[] = [];
  private readonly queue: { task: ExamTask; resolve: (r: unknown) => void; reject: (e: Error) => void }[] = [];
  private readonly pending = new Map<number, { worker: Worker; resolve: (r: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 0;

  private constructor(readonly workers: Worker[]) {
    for (const w of workers) {
      w.on('message', ({ id, result, error }: { id: number; result?: unknown; error?: string }) => {
        const p = this.pending.get(id)!;
        this.pending.delete(id);
        if (error) p.reject(new Error(error));
        else p.resolve(result);
        this.idle.push(p.worker);
        this.pump();
      });
      w.on('error', (e) => {
        for (const p of this.pending.values()) if (p.worker === w) p.reject(e);
      });
      this.idle.push(w);
    }
  }

  /** The worker bundled and `threads` of them started (the environment - the training's settings - goes with them). */
  static async start(threads: number): Promise<ExamPool> {
    const out = fileURLToPath(new URL('./out/trackerWorker.mjs', import.meta.url));
    await build({
      input: fileURLToPath(new URL('./trackerWorker.ts', import.meta.url)),
      platform: 'node',
      logLevel: 'silent',
      transform: { define: { 'import.meta.env': '{"BASE_URL":"/"}' } }, // (Vite's, for the game modules that load assets)
      output: { file: out, format: 'esm' },
    });
    // Above normal: started from a background shell, Windows left its threads waiting for a CPU (2.3 of 6 busy).
    try {
      setPriority(constants.priority.PRIORITY_ABOVE_NORMAL);
    } catch {
      // (not allowed: as it is)
    }
    return new ExamPool(Array.from({ length: threads }, () => new Worker(out, { env: process.env })));
  }

  run<T>(task: ExamTask): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve: resolve as (r: unknown) => void, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const { task, resolve, reject } = this.queue.shift()!;
      const id = this.nextId++;
      this.pending.set(id, { worker: w, resolve, reject });
      w.postMessage({ id, task });
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

/** `xs` in `n` runs of nearly equal length, in order (fewer if there are fewer items). */
export function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  const size = Math.ceil(xs.length / Math.max(1, n));
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
