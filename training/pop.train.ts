import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createBrain } from '../src/ai/brain';
import { BRAIN_LAYERS } from '../src/ai/evolution';
import { carCorners, fitness } from '../src/ai/fitness';
import { mulberry32 } from '../src/ai/rng';
import { TrainingSim } from '../src/ai/trainingSim';
import { laneAt, lanesOccupied } from '../src/road/coords';

/** One generation of random networks: who changes lanes, who crashes, and into what. */
it('pop', async () => {
  await RAPIER.init();
  const rng = mulberry32(Number(process.env.POP_SEED ?? 77));
  const brains = Array.from({ length: 80 }, () => createBrain(BRAIN_LAYERS, rng));
  const sim = new TrainingSim(brains, Number(process.env.SIM_SEED ?? 4242), { speedCap: Number(process.env.CAP_KMH ?? 220) / 3.6 });
  const n = sim.ghosts.length;
  const starts = new Array(n).fill(0);
  const lastTarget = sim.ghosts.map((g) => g.driver.targetLane);
  const info: string[] = new Array(n).fill('');
  const wasAlive = sim.ghosts.map(() => true);
  const changingBefore = new Array(n).fill(false);
  const origin = sim.ghosts.map((g) => laneAt(g.car.d));
  while (!sim.done) {
    sim.ghosts.forEach((g, i) => { changingBefore[i] = g.driver.changingLanes; if (!g.driver.changingLanes) origin[i] = g.driver.targetLane === -1 ? laneAt(g.car.d) : g.driver.targetLane; });
    sim.step();
    sim.ghosts.forEach((g, i) => {
      if (g.driver.targetLane !== lastTarget[i] && lastTarget[i] !== -1) starts[i]++;
      lastTarget[i] = g.driver.targetLane;
      if (wasAlive[i] && !g.alive) {
        wasAlive[i] = false;
        if (!g.result.crashed) { info[i] = 'stall'; return; }
        const c = g.car;
        const cs = carCorners(c.s, c.d, c.yaw);
        const sMin = Math.min(...cs.map((p) => p.s)), sMax = Math.max(...cs.map((p) => p.s));
        const hit = sim.traffic.ourBoxes().filter((t) => !t.phantom && t.s + t.length / 2 >= sMin && t.s - t.length / 2 <= sMax && t.dMax >= c.d - 1 && t.dMin <= c.d + 1);
        const h = hit[0];
        info[i] = h ? `at ${Math.round(c.s)}m t=${sim.time.toFixed(1)} crash ${changingBefore[i] ? 'CHANGING' : 'holding'} ${h.s < c.s ? 'behind' : 'ahead'} lanes[${lanesOccupied(h.dMin, h.dMax)}] origin ${origin[i]} target ${g.driver.targetLane} dv=${((h.v - c.speed) * 3.6).toFixed(0)}` : `crash other d=${c.d.toFixed(1)}`;
      }
    });
  }
  const scores = sim.ghosts.map((g) => fitness(g.result));
  const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  const out: string[] = [];
  out.push(`ever started a change: ${starts.filter((x) => x > 0).length}/${n}`);
  out.push(`crashed during a change: ${info.filter((x) => x.includes('CHANGING')).length}`);
  out.push(`  of those, hit from behind in origin lane: ${info.filter((x, i) => x.includes('CHANGING') && x.includes('behind') && x.includes(`lanes[${origin[i]}`)).length}`);
  out.push(`crashed holding lane: ${info.filter((x) => x.includes('holding')).length}`);
  out.push('top 10:');
  for (const i of order.slice(0, 10)) out.push(`  #${i} score ${Math.round(scores[i])} dist ${Math.round(sim.ghosts[i].result.distance)} changes ${starts[i]} ${info[i] || 'alive/timeout'}`);
  out.push('crash samples:');
  info.filter((x) => x.startsWith('crash')).slice(0, 25).forEach((x) => out.push('  ' + x));
  process.stdout.write(out.join('\n') + '\n');
  sim.dispose();
});
