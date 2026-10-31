import { describe, it, expect } from 'vitest';
import { createBrain } from '../src/ai/brain';
import { parseDriver, serializeDriver } from '../src/ai/driverFile';
import { BRAIN_LAYERS } from '../src/ai/evolution';
import { mulberry32 } from '../src/ai/rng';

describe('driver file', () => {
  const b = createBrain(BRAIN_LAYERS, mulberry32(3));

  it('round-trips through JSON', () => {
    const json = JSON.parse(JSON.stringify(serializeDriver(b, { gen: 12 })));
    const back = parseDriver(json);
    expect(back.layers).toEqual(BRAIN_LAYERS);
    expect([...back.weights]).toEqual([...b.weights]);
  });

  it('rejects files that do not match the current inputs or network', () => {
    const ok = serializeDriver(b);
    expect(() => parseDriver(null)).toThrow();
    expect(() => parseDriver({ ...ok, format: 'other' })).toThrow();
    expect(() => parseDriver({ ...ok, version: 2 })).toThrow();
    expect(() => parseDriver({ ...ok, sensors: 'old-layout' })).toThrow(/感測/);
    expect(() => parseDriver({ ...ok, layers: [24, 8, 3] })).toThrow();
    expect(() => parseDriver({ ...ok, weights: ok.weights.slice(1) })).toThrow();
  });
});
