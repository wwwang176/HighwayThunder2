import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createBrain } from '../src/ai/brain';
import { BRAIN_LAYERS } from '../src/ai/evolution';
import { mulberry32 } from '../src/ai/rng';
import { TrainingSim } from '../src/ai/trainingSim';
function constant(steer: number, throttle: number) {
  const b = createBrain(BRAIN_LAYERS, mulberry32(1)); b.weights.fill(0);
  const n = b.weights.length, row = 17;
  b.weights[n - 3 * row + 16] = Math.atanh(steer); b.weights[n - 2 * row + 16] = Math.atanh(throttle * 2 - 1); b.weights[n - row + 16] = -3;
  return b;
}
it('probe', async () => {
  await RAPIER.init();
  const sim = new TrainingSim([constant(0, 0.999), constant(0, 0.7), constant(0, 0.4), constant(0.02, 0.7), constant(0.1, 0.7)], 1, { speedCap: 83 });
  const marks = [2, 5, 10, 20, 40];
  for (const m of marks) {
    while (sim.time < m && !sim.done) sim.step();
    process.stdout.write(`t=${m} ` + sim.ghosts.map((g) => `${g.alive ? 'A' : g.result.crashed ? 'X' : 'S'}${Math.round(g.result.distance)}/${Math.round(g.car.speed * 3.6)}kmh/d${g.car.d.toFixed(1)}`).join('  ') + '\n');
  }
  // random population stats
  const r = mulberry32(5);
  const pop = Array.from({ length: 80 }, () => createBrain(BRAIN_LAYERS, r));
  const s2 = new TrainingSim(pop, 2, { speedCap: 83 });
  while (!s2.done && s2.time < 30) s2.step();
  const ds = s2.ghosts.map((g) => g.result.distance).sort((a, b) => b - a);
  const crashed = s2.ghosts.filter((g) => g.result.crashed).length;
  process.stdout.write(`random pop: top ${ds.slice(0, 5).map(Math.round)} crashed ${crashed} stalled ${80 - crashed - s2.aliveCount} alive ${s2.aliveCount}\n`);
});
