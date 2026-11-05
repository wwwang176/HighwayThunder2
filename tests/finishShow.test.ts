import { describe, expect, it } from 'vitest';
import { FINISH_SLOW, finishTimeScale } from '../src/game/finishShow';

const PANEL = 5;

describe('finishTimeScale', () => {
  it('holds the slow motion past the line, then is back to full speed', () => {
    expect(finishTimeScale(0, PANEL)).toBeCloseTo(FINISH_SLOW.scale);
    expect(finishTimeScale(FINISH_SLOW.hold, PANEL)).toBeCloseTo(FINISH_SLOW.scale);
    expect(finishTimeScale(FINISH_SLOW.back, PANEL)).toBeCloseTo(1);
    expect(finishTimeScale(PANEL, PANEL)).toBeCloseTo(1);
  });

  it('only ever speeds up before the panel', () => {
    let last = 0;
    for (let t = 0; t <= PANEL; t += 0.05) {
      const k = finishTimeScale(t, PANEL);
      expect(k).toBeGreaterThanOrEqual(last - 1e-9);
      last = k;
    }
  });

  it('slows to the slow motion behind the panel once it is in, and stays there', () => {
    expect(finishTimeScale(PANEL + FINISH_SLOW.settle, PANEL)).toBeCloseTo(FINISH_SLOW.panel);
    expect(finishTimeScale(PANEL + 60, PANEL)).toBeCloseTo(FINISH_SLOW.panel);
    const mid = finishTimeScale(PANEL + FINISH_SLOW.settle / 2, PANEL);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(FINISH_SLOW.panel);
  });

  it('skipped, slows to it from the speed it was skipped at', () => {
    expect(finishTimeScale(PANEL, PANEL, FINISH_SLOW.scale)).toBeCloseTo(FINISH_SLOW.scale);
    expect(finishTimeScale(PANEL + FINISH_SLOW.settle, PANEL, FINISH_SLOW.scale)).toBeCloseTo(FINISH_SLOW.panel);
  });
});
