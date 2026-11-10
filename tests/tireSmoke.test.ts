import { describe, it, expect } from 'vitest';
import { puffLook, smokeKick, SMOKE_LIFE } from '../src/world/tireSmoke';

describe('puffLook', () => {
  it('grows and fades over its life', () => {
    const young = puffLook(0.1);
    const old = puffLook(SMOKE_LIFE * 0.9);
    expect(old.size).toBeGreaterThan(young.size);
    expect(old.alpha).toBeLessThan(young.alpha);
  });

  it('gone once its life is over: no size, so the GPU draws nothing for it (a transparent 4 m sprite still cost every pixel)', () => {
    expect(puffLook(SMOKE_LIFE)).toEqual({ size: 0, alpha: 0 });
    expect(puffLook(SMOKE_LIFE + 5)).toEqual({ size: 0, alpha: 0 });
  });
});

describe('smokeKick', () => {
  it("throws a spinning tyre's smoke back along it, by how much faster its tread goes, up to a cap", () => {
    // heading -z (the road's forward), the car standing, the tread at 20 m/s: back is +z
    const k = smokeKick(0, -1, 20 / 0.33, 0.33, 0, 0);
    expect(k.x).toBeCloseTo(0);
    expect(k.z).toBeGreaterThan(5);
    expect(smokeKick(0, -1, 100 / 0.33, 0.33, 0, 0).z).toBeLessThanOrEqual(9); // (capped)
  });
  it('none for a tyre rolling with the road or locked', () => {
    expect(smokeKick(0, -1, 30 / 0.33, 0.33, 0, -30)).toEqual({ x: 0, z: 0 }); // rolling at 30 m/s
    expect(smokeKick(0, -1, 0, 0.33, 0, -30)).toEqual({ x: 0, z: 0 }); // locked
  });
});
