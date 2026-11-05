import { describe, expect, it } from 'vitest';
import { FINISH_SLOW, finishTimeScale } from '../src/game/finishShow';

describe('finishTimeScale', () => {
  it('holds the slow motion past the line, then is back to full speed', () => {
    expect(finishTimeScale(0)).toBeCloseTo(FINISH_SLOW.scale);
    expect(finishTimeScale(FINISH_SLOW.hold)).toBeCloseTo(FINISH_SLOW.scale);
    expect(finishTimeScale(FINISH_SLOW.back)).toBeCloseTo(1);
    expect(finishTimeScale(100)).toBeCloseTo(1);
  });

  it('only ever speeds up', () => {
    let last = 0;
    for (let t = 0; t <= 5; t += 0.05) {
      const k = finishTimeScale(t);
      expect(k).toBeGreaterThanOrEqual(last - 1e-9);
      last = k;
    }
  });
});
