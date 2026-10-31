import type * as THREE from 'three';
import { KMH } from '../config';
import type { WheelInstances } from '../vehicles/wheelInstances';
import { Brain, cloneBrain, createBrain } from './brain';
import { BRAIN_LAYERS, DEFAULT_EVO, EvoParams, nextGeneration } from './evolution';
import { FITNESS, fitness } from './fitness';
import { hashSeed, mulberry32 } from './rng';
import { TrainingSim } from './trainingSim';

/** Traffic the generation's best are checked on: never used for training itself. */
export const VALIDATION_SEEDS = [9101, 9202, 9303];
/** How many of each generation's best are validated. */
export const VALIDATE_TOP = 3;
/** Training draws each generation's speed cap from this range (km/h). */
export const SPEED_CAP_RANGE_KMH: [number, number] = [150, 300];
const VALIDATION_SPEED_CAP = 300 * KMH;
const STORAGE_KEY = 'highwayThunder2.trainer.v1';

export interface HistoryEntry {
  gen: number;
  /** Best fitness in the generation's own run. */
  best: number;
  /** Cars that reached the finish in that run. */
  finishes: number;
  speedCapKmh: number;
  /** Mean fitness of its best brain on the validation traffic, once checked. */
  validated?: { mean: number; finishes: number; runs: number };
}

export interface BestDriver {
  brain: Brain;
  /** Mean fitness on the validation traffic. */
  score: number;
  finishes: number;
  runs: number;
  gen: number;
}

export interface TrainerOptions {
  seed: number;
  evo?: EvoParams;
  population?: number;
  timeLimit?: number;
  storage?: Storage | null;
  /** Where to draw the visible generation's traffic (training page). */
  scene?: THREE.Scene;
  wheelPool?: WheelInstances;
}

interface Validation {
  gen: number;
  brains: Brain[];
  seedIdx: number;
  sim: TrainingSim | null;
  scores: number[];
  finishes: number[];
}

/**
 * Runs neuroevolution generation after generation. The visible generation is
 * `sim`; each finished generation's best few are checked on unseen traffic
 * (`validateTick`, time-sliced) and the best validated network is kept and saved.
 */
export class Trainer {
  seed: number;
  readonly evo: EvoParams;
  readonly timeLimit: number;
  generation = 1;
  population: Brain[];
  history: HistoryEntry[] = [];
  best: BestDriver | null = null;
  sim!: TrainingSim;
  speedCapKmh = 300;
  private validation: Validation | null = null;
  private readonly storage: Storage | null;
  private readonly scene?: THREE.Scene;
  private readonly wheelPool?: WheelInstances;

  constructor(opts: TrainerOptions) {
    this.seed = opts.seed;
    this.evo = { ...(opts.evo ?? DEFAULT_EVO) };
    if (opts.population) this.evo.population = opts.population;
    this.timeLimit = opts.timeLimit ?? FITNESS.timeLimit;
    this.storage = opts.storage ?? null;
    this.scene = opts.scene;
    this.wheelPool = opts.wheelPool;
    const rng = mulberry32(this.seed);
    this.population = Array.from({ length: this.evo.population }, () => createBrain(BRAIN_LAYERS, rng));
    this.startGeneration();
  }

  get validating(): boolean {
    return this.validation !== null;
  }

  /** Advance the visible generation by up to `steps` physics steps; start the next one when it ends. */
  tick(steps: number): void {
    for (let i = 0; i < steps; i++) {
      if (this.sim.done) {
        this.endGeneration();
        return;
      }
      this.sim.step();
    }
    if (this.sim.done) this.endGeneration();
  }

  /** Advance the pending validation by up to `steps` physics steps (headless). */
  validateTick(steps: number): void {
    const v = this.validation;
    if (!v) return;
    let left = steps;
    while (left > 0 && this.validation) {
      if (!v.sim) v.sim = new TrainingSim(v.brains, VALIDATION_SEEDS[v.seedIdx], { speedCap: VALIDATION_SPEED_CAP, timeLimit: this.timeLimit });
      while (left > 0 && !v.sim.done) {
        v.sim.step();
        left--;
      }
      if (!v.sim.done) return;
      v.sim.ghosts.forEach((g, i) => {
        v.scores[i] += fitness(g.result);
        if (g.result.finishTime !== null) v.finishes[i]++;
      });
      v.sim.dispose();
      v.sim = null;
      v.seedIdx++;
      if (v.seedIdx >= VALIDATION_SEEDS.length) this.finishValidation(v);
    }
  }

  private finishValidation(v: Validation): void {
    const runs = VALIDATION_SEEDS.length;
    let bi = 0;
    for (let i = 1; i < v.brains.length; i++) if (v.scores[i] > v.scores[bi]) bi = i;
    const mean = v.scores[bi] / runs;
    const entry = this.history.find((h) => h.gen === v.gen);
    if (entry) entry.validated = { mean, finishes: v.finishes[bi], runs };
    if (!this.best || mean > this.best.score) {
      this.best = { brain: cloneBrain(v.brains[bi]), score: mean, finishes: v.finishes[bi], runs, gen: v.gen };
    }
    this.validation = null;
    this.save();
  }

  private startGeneration(): void {
    const r = mulberry32(hashSeed(this.seed, this.generation * 2 + 1));
    const [lo, hi] = SPEED_CAP_RANGE_KMH;
    this.speedCapKmh = Math.round(lo + r() * (hi - lo));
    this.sim = new TrainingSim(this.population, hashSeed(this.seed, this.generation), {
      speedCap: this.speedCapKmh * KMH,
      timeLimit: this.timeLimit,
      scene: this.scene,
      wheelPool: this.wheelPool,
    });
  }

  private endGeneration(): void {
    const scores = this.sim.ghosts.map((g) => fitness(g.result));
    const finishes = this.sim.ghosts.filter((g) => g.result.finishTime !== null).length;
    this.history.push({ gen: this.generation, best: Math.max(...scores), finishes, speedCapKmh: this.speedCapKmh });
    if (!this.validation) {
      const top = scores
        .map((s, i) => ({ s, i }))
        .sort((a, b) => b.s - a.s)
        .slice(0, VALIDATE_TOP)
        .map((x) => cloneBrain(this.population[x.i]));
      this.validation = { gen: this.generation, brains: top, seedIdx: 0, sim: null, scores: top.map(() => 0), finishes: top.map(() => 0) };
    }
    this.population = nextGeneration(this.population, scores, mulberry32(hashSeed(this.seed, this.generation * 2)), this.evo);
    this.generation++;
    this.sim.dispose();
    this.startGeneration();
    this.save();
  }

  /** Start over from generation 1 (optionally with a new seed). */
  reset(seed = this.seed): void {
    this.dispose();
    this.seed = seed;
    this.generation = 1;
    this.history = [];
    this.best = null;
    const rng = mulberry32(this.seed);
    this.population = Array.from({ length: this.evo.population }, () => createBrain(BRAIN_LAYERS, rng));
    this.startGeneration();
    this.save();
  }

  save(): void {
    if (!this.storage) return;
    const data = {
      seed: this.seed,
      generation: this.generation,
      evo: this.evo,
      population: this.population.map((b) => Array.from(b.weights)),
      history: this.history,
      best: this.best && { ...this.best, brain: Array.from(this.best.brain.weights) },
    };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage full or unavailable: training goes on, it just won't survive a reload.
    }
  }

  /** Resume saved training; null when nothing usable is stored. The current generation restarts. */
  static load(storage: Storage, opts: Omit<TrainerOptions, 'seed' | 'storage'> = {}): Trainer | null {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      const toBrain = (w: number[]): Brain => {
        const b = createBrain(BRAIN_LAYERS, () => 0.5);
        if (w.length !== b.weights.length) throw new Error('size');
        b.weights.set(w);
        return b;
      };
      const t = new Trainer({ ...opts, seed: d.seed, evo: d.evo, population: d.population.length, storage });
      t.sim.dispose();
      t.generation = d.generation;
      t.population = d.population.map(toBrain);
      t.history = d.history ?? [];
      t.best = d.best ? { ...d.best, brain: toBrain(d.best.brain) } : null;
      t.startGeneration();
      return t;
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.sim.dispose();
    this.validation?.sim?.dispose();
    this.validation = null;
  }
}
