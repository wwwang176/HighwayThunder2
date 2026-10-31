import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDriver } from '../src/ai/driverFile';
import { hitsTraffic, isOffRoad } from '../src/ai/fitness';
import { TrainingSim } from '../src/ai/trainingSim';

/** How each saved best driver ends its runs on unseen traffic. */
it('inspect', async () => {
  await RAPIER.init();
  const dir = resolve(import.meta.dirname, 'out');
  const lines: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let brain;
    try {
      brain = parseDriver(JSON.parse(readFileSync(resolve(dir, f), 'utf8')));
    } catch (e) {
      lines.push(`${f}: skipped (${e instanceof Error ? e.message : e})`);
      continue;
    }
    for (const seed of [7001, 7002, 7003]) {
      const sim = new TrainingSim([brain], seed, { speedCap: Number(process.env.CAP_KMH ?? 300) / 3.6 });
      let maxV = 0;
      while (!sim.done) {
        sim.step();
        maxV = Math.max(maxV, sim.ghosts[0].car.speed);
      }
      const g = sim.ghosts[0];
      const c = g.car;
      const why = g.result.finishTime !== null ? 'FINISH' : g.result.crashed ? (isOffRoad(c.s, c.d, c.yaw) ? 'offroad' : hitsTraffic(c.s, c.d, c.yaw, sim.traffic.ourBoxes()) ? 'traffic' : 'crash?') : sim.time >= sim.timeLimit ? 'timeout' : 'stall';
      lines.push(`${f} seed ${seed}: ${why} at ${Math.round(g.result.distance)} m t=${sim.time.toFixed(0)}s v=${Math.round(c.speed * 3.6)} max=${Math.round(maxV * 3.6)} d=${c.d.toFixed(1)} yaw=${c.yaw.toFixed(2)}`);
      sim.dispose();
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
});
