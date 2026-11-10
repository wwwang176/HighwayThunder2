import { describe, expect, it } from 'vitest';
import { loadingPercent, segmentsLit, shareDone } from '../src/ui/loading';

describe('loading screen', () => {
  it('turns a share into a percent, clamped', () => {
    expect(loadingPercent(0.426)).toBe(43);
    expect(loadingPercent(-1)).toBe(0);
    expect(loadingPercent(2)).toBe(100);
    expect(loadingPercent(NaN)).toBe(0);
  });

  it('lights the bar segment by segment, all at the end', () => {
    expect(segmentsLit(0, 24)).toBe(0);
    expect(segmentsLit(0.5, 24)).toBe(12);
    expect(segmentsLit(1, 24)).toBe(24);
  });

  it('counts files done, nothing to do as done', () => {
    expect(shareDone(1, 4)).toBe(0.25);
    expect(shareDone(0, 0)).toBe(1);
  });
});
