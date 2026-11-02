import { describe, it, expect } from 'vitest';
import { puffLook, SMOKE_LIFE } from '../src/world/tireSmoke';

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
