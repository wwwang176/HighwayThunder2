import { describe, it, expect } from 'vitest';
import { BODY_FRICTION, bodyFriction } from '../src/vehicles/playerCar';

describe('bodyFriction', () => {
  it('upright, and leaning up to fromDeg: the low friction (grounding under a hard brake hardly slows it)', () => {
    expect(bodyFriction(1)).toBe(BODY_FRICTION.upright);
    expect(bodyFriction(Math.cos((BODY_FRICTION.fromDeg * Math.PI) / 180) + 1e-9)).toBeCloseTo(BODY_FRICTION.upright, 9);
  });

  it('on its side and on its roof: metal on asphalt', () => {
    expect(bodyFriction(0)).toBeCloseTo(BODY_FRICTION.rolled, 9);
    expect(bodyFriction(-1)).toBe(BODY_FRICTION.rolled);
  });

  it('between, rising the further over', () => {
    let last = -1;
    for (let deg = 0; deg <= 180; deg += 5) {
      const f = bodyFriction(Math.cos((deg * Math.PI) / 180));
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
  });
});
