import { Brain, cloneBrain, mutate } from './brain';
import type { Rng } from './rng';
import { SENSOR_COUNT } from './sensors';

/** Inputs → two hidden layers → lane (left / keep / right), target speed. */
export const BRAIN_LAYERS = [SENSOR_COUNT, 16, 16, 2];

export interface EvoParams {
  population: number;
  /** Best ones copied unchanged into the next generation. */
  elite: number;
  /** Parents are drawn from this top fraction. */
  parentPool: number;
  /** Mutation size (std dev added to a weight). */
  sigma: number;
  /** Chance that a weight is mutated. */
  rate: number;
}

export const DEFAULT_EVO: EvoParams = { population: 80, elite: 4, parentPool: 0.25, sigma: 0.15, rate: 0.1 };

/** Rank by score; keep the elites as they are, fill the rest with mutated copies of good parents. */
export function nextGeneration(pop: Brain[], scores: number[], rng: Rng, p: EvoParams): Brain[] {
  const ranked = pop.map((b, i) => ({ b, s: scores[i] })).sort((x, y) => y.s - x.s);
  const out: Brain[] = [];
  for (let i = 0; i < Math.min(p.elite, ranked.length, p.population); i++) out.push(cloneBrain(ranked[i].b));
  const pool = Math.max(1, Math.round(ranked.length * p.parentPool));
  while (out.length < p.population) {
    const parent = ranked[Math.floor(rng() * pool)].b;
    out.push(mutate(parent, rng, p.sigma, p.rate));
  }
  return out;
}
