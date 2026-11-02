import { describe, it, expect } from 'vitest';
import { gaussian, mulberry32 } from '../src/ai/rng';
import { cloneBrain, createBrain, forward, mutate, weightCount } from '../src/ai/brain';

describe('mulberry32', () => {
  it('is repeatable for a seed and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 5; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it('gaussian has roughly zero mean and unit spread', () => {
    const r = mulberry32(7);
    let sum = 0;
    let sq = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const g = gaussian(r);
      sum += g;
      sq += g * g;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.08);
    expect(Math.sqrt(sq / n)).toBeGreaterThan(0.9);
    expect(Math.sqrt(sq / n)).toBeLessThan(1.1);
  });
});

describe('brain', () => {
  it('counts weights including biases', () => {
    expect(weightCount([3, 4, 2])).toBe((3 + 1) * 4 + (4 + 1) * 2);
  });

  it('forward gives one tanh output per last-layer neuron', () => {
    const b = createBrain([3, 4, 2], mulberry32(1));
    const out = forward(b, [0.5, -0.2, 0.9]);
    expect(out.length).toBe(2);
    for (const v of out) {
      expect(v).toBeGreaterThan(-1);
      expect(v).toBeLessThan(1);
    }
  });

  it('all-zero weights give all-zero outputs', () => {
    const b = createBrain([3, 4, 2], mulberry32(1));
    b.weights.fill(0);
    expect([...forward(b, [1, 2, 3])]).toEqual([0, 0]);
  });

  it('computes tanh(w*x + bias)', () => {
    const b = { layers: [1, 1], weights: new Float32Array([2, 0.5]) };
    expect(forward(b, [1])[0]).toBeCloseTo(Math.tanh(2.5), 6);
  });

  it('mutate returns a new brain and leaves the original alone', () => {
    const b = createBrain([3, 4, 2], mulberry32(1));
    const before = Float32Array.from(b.weights);
    const m = mutate(b, mulberry32(2), 0.5, 1);
    expect([...b.weights]).toEqual([...before]);
    expect([...m.weights]).not.toEqual([...before]);
    expect([...mutate(b, mulberry32(2), 0.5, 0).weights]).toEqual([...before]);
    expect([...mutate(b, mulberry32(9), 0.5, 0.3).weights]).toEqual([...mutate(b, mulberry32(9), 0.5, 0.3).weights]);
  });

  it('cloneBrain copies the weights', () => {
    const b = createBrain([2, 2], mulberry32(3));
    const c = cloneBrain(b);
    c.weights[0] += 1;
    expect(c.weights[0]).not.toBe(b.weights[0]);
    expect(c.layers).toEqual(b.layers);
  });
});
