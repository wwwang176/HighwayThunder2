import { describe, expect, it } from 'vitest';
import { arrivalAhead, beamGlare, BEAM, HELI, heliAttitude, heliHeight, heliOrbit, pickHeliTarget, repositionTime, switchFade } from '../src/game/helicopter';

describe('police helicopter', () => {
  const times = Array.from({ length: 2000 }, (_, i) => i * 0.1);

  it('circles its car loosely: sometimes behind it, sometimes ahead, to both sides', () => {
    const at = times.map(heliOrbit);
    const aheads = at.map((o) => o.ahead), sides = at.map((o) => o.side);
    expect(Math.min(...aheads)).toBeLessThan(-20); // (behind)
    expect(Math.max(...aheads)).toBeGreaterThan(60); // (ahead)
    expect(Math.min(...aheads)).toBeGreaterThanOrEqual(HELI.orbitAhead - HELI.orbitLong - 1e-9);
    expect(Math.max(...aheads)).toBeLessThanOrEqual(HELI.orbitAhead + HELI.orbitLong + 1e-9);
    expect(Math.min(...sides)).toBeLessThan(-HELI.orbitSide * 0.9);
    expect(Math.max(...sides)).toBeGreaterThan(HELI.orbitSide * 0.9);
    expect(aheads.filter((a) => a < 0).length / aheads.length).toBeGreaterThan(0.15); // (not just a moment)
    // (smoothly: no jump)
    for (let i = 1; i < at.length; i++) expect(Math.hypot(at[i].ahead - at[i - 1].ahead, at[i].side - at[i - 1].side)).toBeLessThan(3);
  });

  it('its height wanders a little around HELI.height', () => {
    const hs = times.map(heliHeight);
    expect(Math.min(...hs)).toBeGreaterThanOrEqual(HELI.height - HELI.rise - 1e-9);
    expect(Math.max(...hs)).toBeLessThanOrEqual(HELI.height + HELI.rise + 1e-9);
    expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(HELI.rise); // (it does change)
  });

  it('flies in from far behind (HELI.arriveFrom m) over HELI.arrive s', () => {
    expect(HELI.arriveFrom).toBeLessThan(-200); // (from behind, out of the chase camera's view)
    expect(arrivalAhead(0)).toBeCloseTo(HELI.arriveFrom);
    expect(arrivalAhead(HELI.arrive)).toBeCloseTo(0);
    expect(arrivalAhead(HELI.arrive + 5)).toBe(0);
    for (let t = 0; t < HELI.arrive; t += 0.1) expect(arrivalAhead(t + 0.1)).toBeGreaterThanOrEqual(arrivalAhead(t));
  });

  it('picks the player (0) on a roll under HELI.playerShare, else a rival near the player', () => {
    const gaps = [0, 40, 400, 120]; // (how far each is from the player: 0 the player)
    expect(pickHeliTarget(gaps, 0)).toBe(0);
    expect(pickHeliTarget(gaps, HELI.playerShare - 0.01)).toBe(0);
    const picked = new Set(Array.from({ length: 50 }, (_, i) => pickHeliTarget(gaps, HELI.playerShare + ((1 - HELI.playerShare) * i) / 50)));
    expect([...picked].sort()).toEqual([1, 3]); // (not the one 400 m off: out of the player's sight)
    expect(pickHeliTarget([0, 400], 0.99)).toBe(0); // (none near: the player)
    expect(pickHeliTarget([0], 0.99)).toBe(0);
  });

  it('to a new car: the light (its operator) swings over fast, the helicopter (its pilot) follows slowly', () => {
    expect(switchFade(0, HELI.retarget)).toBeCloseTo(1); // (all the old car's offset, at first)
    expect(switchFade(HELI.retarget, HELI.retarget)).toBe(0); // (the light on the new car)
    expect(switchFade(HELI.retarget + 1, HELI.retarget)).toBe(0);
    for (let t = 0; t < HELI.reposition; t += 0.1) expect(switchFade(t + 0.1, HELI.reposition)).toBeLessThanOrEqual(switchFade(t, HELI.reposition));
    expect(switchFade(HELI.retarget, HELI.reposition)).toBeGreaterThan(0.7); // (the light there, the helicopter mostly not yet)
    expect(switchFade(HELI.reposition, HELI.reposition)).toBe(0);
  });

  it('its pilot takes longer to a car further off: never pulling harder than HELI.repositionAcc', () => {
    expect(repositionTime(0)).toBe(HELI.reposition);
    expect(repositionTime(30)).toBe(HELI.reposition); // (near: the least)
    for (const d of [100, 250, 500]) {
      const t = repositionTime(d);
      expect(t).toBeGreaterThanOrEqual(HELI.reposition);
      expect((6 * d) / (t * t)).toBeLessThanOrEqual(HELI.repositionAcc + 1e-9); // (a smoothstep's hardest pull)
    }
    expect(repositionTime(250)).toBeGreaterThan(repositionTime(100));
  });

  it('pitches nose down speeding up, up slowing; banks into a turn; never past its limits', () => {
    const cruise = heliAttitude(0, 0, 50);
    expect(cruise.pitch).toBeLessThan(0); // (flying forward: nose a little down)
    expect(cruise.pitch).toBeLessThan(heliAttitude(0, 0, 0).pitch + 1e-9);
    expect(heliAttitude(5, 0, 50).pitch).toBeLessThan(cruise.pitch); // (speeding up: further down)
    expect(heliAttitude(-5, 0, 50).pitch).toBeGreaterThan(cruise.pitch); // (braking: nose up)
    expect(heliAttitude(0, 5, 50).roll).toBeLessThan(0); // (pulled right: its right side down)
    expect(heliAttitude(0, -5, 50).roll).toBeGreaterThan(0);
    const wild = heliAttitude(-100, 100, 50);
    expect(Math.abs(wild.pitch)).toBeLessThanOrEqual(HELI.maxPitch + 1e-9);
    expect(Math.abs(wild.roll)).toBeLessThanOrEqual(HELI.maxRoll + 1e-9);
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
