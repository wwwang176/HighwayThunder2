// Benchmark: a hand-written passing rule (lane with more room ahead, if the gap behind is safe) through the same
// sensors and controllers as the network - what a simple policy gets, for comparing trained drivers against.
//   BLOCKED=0.9 BEHIND=0.2 npx vitest run --config training/vitest.config.ts training/greedy.train.ts
import { it, vi } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';

// A hand-written policy in place of the network: same sensors, same controllers.
vi.mock('../src/ai/brain', async (orig) => {
  const m = await orig<typeof import('../src/ai/brain')>();
  return {
    ...m,
    forward: (_b: unknown, x: ArrayLike<number>, out = new Float32Array(2)) => {
      const ahead = (rel: number) => x[(rel + 2) * 4];
      const behindOk = (rel: number) => x[(rel + 2) * 4 + 2] > Number(process.env.BEHIND ?? 0.3);
      const own = ahead(0);
      out[0] = 0;
      if (own < Number(process.env.BLOCKED ?? 0.5) && Math.abs(x[29]) < 0.1) {
        if (ahead(-1) > own + 0.1 && behindOk(-1)) out[0] = -1;
        else if (ahead(1) > own + 0.1 && behindOk(1)) out[0] = 1;
      }
      out[1] = 1;
      return out;
    },
  };
});

it('greedy', async () => {
  await RAPIER.init();
  const { createBrain } = await import('../src/ai/brain');
  const { BRAIN_LAYERS } = await import('../src/ai/evolution');
  const { TrainingSim } = await import('../src/ai/trainingSim');
  const { mulberry32 } = await import('../src/ai/rng');
  const out: string[] = [];
  for (const seed of [7001, 7002, 7003]) {
    const sim = new TrainingSim([createBrain(BRAIN_LAYERS, mulberry32(1))], seed, { speedCap: 300 / 3.6 });
    while (!sim.done) sim.step();
    const g = sim.ghosts[0];
    out.push(`${seed}: ${g.result.finishTime !== null ? `FINISH ${g.result.finishTime.toFixed(0)}s` : g.result.crashed ? 'crash' : 'timeout'} at ${Math.round(g.result.distance)} m, avg ${Math.round((g.result.distance / sim.time) * 3.6)} km/h, lane changes ${g.laneChanges}`);
    sim.dispose();
  }
  process.stdout.write(out.join('\n') + '\n');
});
