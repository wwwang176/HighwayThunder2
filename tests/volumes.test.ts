import { describe, expect, it } from 'vitest';
import { FULL_VOLUMES, loadVolumes, saveVolumes, tenths, VOLUMES_KEY } from '../src/audio/volumes';

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('volumes', () => {
  it('full and not muted when none are saved, or they are broken', () => {
    expect(loadVolumes(store())).toEqual(FULL_VOLUMES);
    expect(loadVolumes(store({ [VOLUMES_KEY]: '{oops' }))).toEqual(FULL_VOLUMES);
    expect(loadVolumes(store({ [VOLUMES_KEY]: '[1,2]' }))).toEqual(FULL_VOLUMES);
  });

  it('keeps what was saved, in tenths within 0..1', () => {
    const s = store();
    saveVolumes(s, { music: 0, sfx: 0.7, muted: true });
    expect(loadVolumes(s)).toEqual({ music: 0, sfx: 0.7, muted: true });
    expect(tenths(0.34)).toBe(0.3);
    expect(tenths(1.5)).toBe(1);
    expect(tenths(-1)).toBe(0);
    expect(tenths('x')).toBe(1);
  });
});
