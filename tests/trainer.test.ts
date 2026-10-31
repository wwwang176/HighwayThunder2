import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Trainer } from '../src/ai/trainer';

beforeAll(async () => {
  await RAPIER.init();
});

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('Trainer', () => {
  it('moves to the next generation when one ends', () => {
    const t = new Trainer({ seed: 1, population: 4, timeLimit: 1 });
    t.tick(200);
    expect(t.generation).toBe(2);
    expect(t.history.length).toBe(1);
    expect(t.population.length).toBe(4);
    t.dispose();
  });

  it('can start from already trained networks (copies plus mutated copies)', () => {
    const base = new Trainer({ seed: 9, population: 2, timeLimit: 1 });
    const seedBrain = base.population[0];
    base.dispose();
    const t = new Trainer({ seed: 10, population: 5, timeLimit: 1, seedBrains: [seedBrain] });
    expect([...t.population[0].weights]).toEqual([...seedBrain.weights]);
    for (const b of t.population.slice(1)) expect([...b.weights]).not.toEqual([...seedBrain.weights]);
    t.dispose();
  });

  it('validates the best of a generation on unseen traffic and keeps the best', () => {
    const t = new Trainer({ seed: 2, population: 4, timeLimit: 1 });
    t.tick(200);
    for (let i = 0; i < 20 && t.validating; i++) t.validateTick(1000);
    expect(t.validating).toBe(false);
    expect(t.best).not.toBeNull();
    expect(t.best!.runs).toBe(3);
    expect(t.history[0].validated).toBeDefined();
    t.dispose();
  });

  it('saves and restores its progress', () => {
    const storage = new MemoryStorage() as unknown as Storage;
    const t = new Trainer({ seed: 3, population: 4, timeLimit: 1, storage });
    t.tick(200);
    for (let i = 0; i < 20 && t.validating; i++) t.validateTick(1000);
    t.save();
    const u = Trainer.load(storage, { timeLimit: 1 })!;
    expect(u).not.toBeNull();
    expect(u.generation).toBe(t.generation);
    expect(u.best!.score).toBe(t.best!.score);
    expect([...u.population[0].weights]).toEqual([...t.population[0].weights]);
    t.dispose();
    u.dispose();
  });

  it('refuses saved progress trained on different sensor inputs', () => {
    const storage = new MemoryStorage() as unknown as Storage;
    const t = new Trainer({ seed: 4, population: 4, timeLimit: 1, storage });
    t.save();
    t.dispose();
    const key = 'highwayThunder2.trainer.v1';
    const saved = JSON.parse(storage.getItem(key)!);
    storage.setItem(key, JSON.stringify({ ...saved, sensors: 'lane-radar-v1' }));
    expect(Trainer.load(storage, { timeLimit: 1 })).toBeNull();
    const { sensors: _drop, ...noLayout } = saved;
    storage.setItem(key, JSON.stringify(noLayout));
    expect(Trainer.load(storage, { timeLimit: 1 })).toBeNull();
  });

  it('load returns null when nothing (or garbage) is stored', () => {
    const storage = new MemoryStorage() as unknown as Storage;
    expect(Trainer.load(storage)).toBeNull();
    storage.setItem('highwayThunder2.trainer.v1', '{not json');
    expect(Trainer.load(storage)).toBeNull();
  });
});
