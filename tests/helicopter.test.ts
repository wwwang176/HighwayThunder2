import { describe, expect, it } from 'vitest';
import { arrivalAhead, beamGlare, BEAM, HELI, heliOffset } from '../src/game/helicopter';

describe('police helicopter', () => {
  it('slides fore and aft between HELI.ahead[0] and [1] m ahead of the player', () => {
    const aheads = Array.from({ length: 400 }, (_, i) => heliOffset(i * 0.1).ahead);
    expect(Math.min(...aheads)).toBeGreaterThanOrEqual(HELI.ahead[0] - 1e-9);
    expect(Math.max(...aheads)).toBeLessThanOrEqual(HELI.ahead[1] + 1e-9);
    expect(Math.min(...aheads)).toBeLessThan(HELI.ahead[0] + 1); // (it goes all the way, both ways)
    expect(Math.max(...aheads)).toBeGreaterThan(HELI.ahead[1] - 1);
  });

  it('holds a side HELI.sideEvery s, then crosses smoothly over HELI.sideTurn s to the other', () => {
    const e = HELI.sideEvery, turn = HELI.sideTurn;
    expect(heliOffset(e / 2).side).toBeCloseTo(-HELI.side); // (first on the left)
    expect(heliOffset(e + turn + 1).side).toBeCloseTo(HELI.side);
    expect(heliOffset(2 * e + turn + 1).side).toBeCloseTo(-HELI.side);
    expect(heliOffset(e).side).toBeCloseTo(-HELI.side); // (the crossing starts where it was)
    expect(heliOffset(e + turn / 2).side).toBeCloseTo(0); // (halfway over)
    // (no jump anywhere)
    for (let t = 0; t < 4 * e; t += 0.05) expect(Math.abs(heliOffset(t + 0.05).side - heliOffset(t).side)).toBeLessThan(1);
  });

  it('flies in from HELI.arriveFrom m further ahead over HELI.arrive s', () => {
    expect(arrivalAhead(0)).toBeCloseTo(HELI.arriveFrom);
    expect(arrivalAhead(HELI.arrive)).toBeCloseTo(0);
    expect(arrivalAhead(HELI.arrive + 5)).toBe(0);
    for (let t = 0; t < HELI.arrive; t += 0.1) expect(arrivalAhead(t + 0.1)).toBeLessThanOrEqual(arrivalAhead(t));
  });

  it('glare: only with the camera in the light (the cone widened, past the car) AND looking into the lamp', () => {
    const len = 45;
    expect(beamGlare(20, 0, len, 1)).toBeCloseTo(1); // (in the beam, on its axis, looking straight at the lamp)
    expect(beamGlare(20, 0, len, 0.3)).toBe(0); // (in the beam, looking away: the lit car, not the lamp)
    expect(beamGlare(20, 0, len, BEAM.faceFrom)).toBe(0);
    expect(beamGlare(-1, 0, len, 1)).toBe(0); // (behind the lamp)
    expect(beamGlare(len * BEAM.glareBeyond + 1, 0, len, 1)).toBe(0); // (too far past the car)
    expect(beamGlare(len + 6, 3, len, 1)).toBeGreaterThan(0); // (past the lit car, near its light: the flare)
    expect(beamGlare(len + 6, 3, len, 1, 1)).toBe(0); // (but not in the cone itself: no veil)
    expect(beamGlare(20, BEAM.groundRadius * BEAM.glareWiden, len, 1)).toBe(0); // (well outside the cone)
    expect(beamGlare(20, 0.5, len, 1)).toBeGreaterThan(beamGlare(20, 3, len, 1)); // (nearer its axis: brighter)
  });
});
