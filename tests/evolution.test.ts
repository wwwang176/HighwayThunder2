import { describe, it, expect } from 'vitest';
import { createBrain } from '../src/ai/brain';
import { BRAIN_LAYERS, DEFAULT_EVO, nextGeneration } from '../src/ai/evolution';
import { mulberry32 } from '../src/ai/rng';

const population = (n: number, seed = 1) => {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => createBrain(BRAIN_LAYERS, rng));
};

describe('nextGeneration', () => {
  const p = { ...DEFAULT_EVO, population: 20, elite: 4 };
  const pop = population(20);
  const scores = pop.map((_, i) => (i * 37) % 20); // a shuffled ranking

  it('keeps the population size', () => {
    expect(nextGeneration(pop, scores, mulberry32(5), p).length).toBe(20);
  });

  it('copies the elites unchanged, best first', () => {
    const next = nextGeneration(pop, scores, mulberry32(5), p);
    const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    for (let k = 0; k < 4; k++) expect([...next[k].weights]).toEqual([...pop[order[k]].weights]);
  });

  it('mutates the rest', () => {
    const next = nextGeneration(pop, scores, mulberry32(5), p);
    const same = (a: Float32Array, b: Float32Array) => a.every((v, i) => v === b[i]);
    const fresh = next.slice(4).filter((c) => !pop.some((q) => same(c.weights, q.weights)));
    expect(fresh.length).toBeGreaterThan(0);
  });

  it('is repeatable for a seed', () => {
    const a = nextGeneration(pop, scores, mulberry32(5), p);
    const b = nextGeneration(pop, scores, mulberry32(5), p);
    a.forEach((x, i) => expect([...x.weights]).toEqual([...b[i].weights]));
  });
});
