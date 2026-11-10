import { describe, expect, it } from 'vitest';
import { TUNE_ITEMS, tuned } from '../src/vehicles/tuning';
import { TUNE_CAL } from '../src/vehicles/tuneCalibration';
import { CARS } from '../src/vehicles/cars';
import { pressureGripScale } from '../src/vehicles/handling';

describe('tuning', () => {
  it('as built at 0, the base never touched', () => {
    for (const spec of Object.values(CARS)) {
      const base = { ...spec.params };
      expect(tuned(spec.params, {}, TUNE_CAL[spec.id])).toEqual(base);
      tuned(spec.params, { springs: 2, wing: -2 }, TUNE_CAL[spec.id]);
      expect(spec.params).toEqual(base);
    }
  });

  it('every knob changes something at either end, on every car', () => {
    for (const spec of Object.values(CARS)) {
      for (const item of TUNE_ITEMS) {
        for (const level of [-2, -1, 1, 2]) expect(tuned(spec.params, { [item.key]: level }, TUNE_CAL[spec.id])).not.toEqual(spec.params);
      }
    }
  });

  it('levels past the ends are the ends', () => {
    const p = CARS['street-racer'].params;
    expect(tuned(p, { wing: 5 })).toEqual(tuned(p, { wing: 2 }));
  });

  it("tyre pressure: soft grips more slow and less fast, hard the other way; unset, nothing", () => {
    const p = CARS['street-racer'].params;
    const soft = tuned(p, { pressure: -2 }), hard = tuned(p, { pressure: 2 });
    const kmh = (v: number) => v / 3.6;
    expect(pressureGripScale(kmh(100), soft)).toBeGreaterThan(1);
    expect(pressureGripScale(kmh(280), soft)).toBeLessThan(1);
    expect(pressureGripScale(kmh(100), hard)).toBeLessThan(1);
    expect(pressureGripScale(kmh(280), hard)).toBeGreaterThan(1);
    expect(pressureGripScale(kmh(280), p)).toBe(1);
  });
});
