import { describe, expect, it } from 'vitest';
import { HANDOVER, TOP, handovers, mixAt, soundRpm } from '../src/audio/engineMix';
import { ENGINE_CLIPS, ENGINE_SETS } from '../src/audio/engineCatalog';

const RPMS = [1000, 1500, 1560, 2400];

function mix(s: number, rpms = RPMS, pitch = 1) {
  const gains: number[] = [], rates: number[] = [];
  mixAt(s, rpms, pitch, handovers(rpms), gains, rates);
  return { gains, rates };
}

describe('engine handovers', () => {
  it('lie around each pair\'s geometric mean, within the two', () => {
    const h = handovers(RPMS);
    const m = Math.sqrt(1000 * 1500);
    expect(h[0][0]).toBeCloseTo(m / HANDOVER);
    expect(h[0][1]).toBeCloseTo(m * HANDOVER);
    // 1500 and 1560 too close for the full band: clamped to the two clips' own rpms
    expect(h[1]).toEqual([1500, 1560]);
  });

  it('never overlap', () => {
    const h = handovers(RPMS);
    for (let i = 1; i < h.length; i++) expect(h[i][0]).toBeGreaterThanOrEqual(h[i - 1][1]);
  });
});

describe('engine mix', () => {
  it('plays a clip alone, at its own speed, at its own rpm', () => {
    const { gains, rates } = mix(1000);
    expect(gains).toEqual([1, 0, 0, 0]);
    expect(rates[0]).toBeCloseTo(1);
    const top = mix(2400);
    expect(top.gains).toEqual([0, 0, 0, 1]);
  });

  it('crossfades two neighbours at equal power, and no more than two', () => {
    for (let s = 1000; s <= 2600; s += 7) {
      const { gains } = mix(s);
      expect(gains.filter((g) => g > 0).length).toBeLessThanOrEqual(2);
      expect(gains.reduce((a, g) => a + g * g, 0)).toBeCloseTo(1, 6);
    }
  });

  it('moves smoothly with the rpm (no jump in any gain)', () => {
    let prev = mix(1000).gains;
    for (let s = 1001; s <= 2600; s += 1) {
      const { gains } = mix(s);
      for (let i = 0; i < gains.length; i++) expect(Math.abs(gains[i] - prev[i])).toBeLessThan(0.08);
      prev = gains;
    }
  });

  it('plays every clip faster by its set\'s pitch', () => {
    expect(mix(1000, RPMS, 1.2).rates[0]).toBeCloseTo(1.2);
  });
});

describe('game rpm to the sound\'s', () => {
  it('lays idle..redline onto the lowest clip..TOP x the highest', () => {
    expect(soundRpm(900, 900, 7500, RPMS)).toBe(1000);
    expect(soundRpm(7500, 900, 7500, RPMS)).toBeCloseTo(2400 * TOP);
    expect(soundRpm(500, 900, 7500, RPMS)).toBe(1000); // (below the idle: held)
  });
});

describe('the catalog', () => {
  it('has each set\'s clips in rising rpm', () => {
    for (const set of Object.values(ENGINE_SETS)) {
      const rpms = set.clips.map((id) => ENGINE_CLIPS[id].rpm);
      for (let i = 1; i < rpms.length; i++) expect(rpms[i]).toBeGreaterThan(rpms[i - 1]);
    }
  });
});
