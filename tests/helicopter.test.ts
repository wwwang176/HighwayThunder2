import { describe, expect, it } from 'vitest';
import { arrivalAhead, arrivalRise, searchlight, beamGlare, beamReach, BEAM, HELI, heliAttitude, heliHeading, heliHeight, heliOrbit, nextPickIn, pickHeliTarget, repositionTime, shadowSpan, switchFade } from '../src/game/helicopter';

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

  it('flies in high, coming down to its height as it comes', () => {
    expect(HELI.arriveRise).toBeGreaterThanOrEqual(60); // (high over the city at first)
    expect(arrivalRise(0)).toBeCloseTo(HELI.arriveRise);
    expect(arrivalRise(HELI.arrive)).toBe(0);
    expect(arrivalRise(HELI.arrive + 3)).toBe(0);
    for (let t = 0; t < HELI.arrive; t += 0.1) expect(arrivalRise(t + 0.1)).toBeLessThanOrEqual(arrivalRise(t));
  });

  it('its searchlight off coming in, on once at its height (over HELI.lightOn s): seen and heard before the light', () => {
    for (let t = 0; t <= HELI.arrive; t += 0.5) expect(searchlight(t)).toBe(0);
    expect(searchlight(HELI.arrive + HELI.lightOn / 2)).toBeGreaterThan(0);
    expect(searchlight(HELI.arrive + HELI.lightOn / 2)).toBeLessThan(1);
    expect(searchlight(HELI.arrive + HELI.lightOn)).toBe(1);
    expect(searchlight(HELI.arrive + 60)).toBe(1);
  });

  it('picks any racer but the one it lights, each as likely', () => {
    const rolls = Array.from({ length: 400 }, (_, i) => (i + 0.5) / 400);
    for (const lit of [0, 2]) {
      const counts = [0, 0, 0, 0];
      for (const r of rolls) counts[pickHeliTarget(4, lit, r)]++;
      expect(counts[lit]).toBe(0); // (never the car it lights already)
      for (let i = 0; i < 4; i++) if (i !== lit) expect(counts[i]).toBeCloseTo(400 / 3, -1);
    }
    expect(pickHeliTarget(1, 0, 0.7)).toBe(0); // (the player alone: the player)
    expect(pickHeliTarget(3, 1, 0.9999)).toBeLessThan(3);
  });

  it('a new car every HELI.targetEvery s or so: more often than the 20 s it was', () => {
    expect(HELI.targetEvery).toBeLessThan(20);
    expect(HELI.targetEvery).toBeGreaterThanOrEqual(HELI.retarget * 3); // (the light settled on a car a while)
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

  it('stays over a new car its while once there: the flight over it not counted', () => {
    expect(nextPickIn(12, 0)).toBeCloseTo(12 + HELI.targetEvery * 0.75);
    expect(nextPickIn(12, 1)).toBeCloseTo(12 + HELI.targetEvery * 1.25);
    expect(nextPickIn(0, 0.5)).toBeCloseTo(HELI.targetEvery);
    // (the longest flight over, still its least while there after it)
    const far = repositionTime(500);
    expect(nextPickIn(far, 0) - far).toBeCloseTo(HELI.targetEvery * 0.75);
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

  it('its light never past maxTilt off straight down: a car further off, lit short of it, the way to it', () => {
    // (30 m up, 60 degrees: within 52 m across all of the way; 120 m off, 52 m of it)
    expect(BEAM.maxTilt).toBeCloseTo(Math.PI / 3);
    expect(beamReach(40, 0, 30)).toBeCloseTo(1);
    expect(beamReach(0, 120, 30)).toBeCloseTo((30 * Math.sqrt(3)) / 120);
    expect(beamReach(60, 80, 30)).toBeCloseTo((30 * Math.tan(BEAM.maxTilt)) / 100);
    expect(beamReach(0, 0, 30)).toBe(1); // (right under it)
    expect(beamReach(10, 0, 0)).toBe(0); // (no lower than it: straight down)
  });

  it('flying sideways: leaning that way, not nose down; backwards: nose up', () => {
    const right = heliAttitude(0, 0, 0, 15);
    expect(right.roll).toBeLessThan(0); // (to its right: its right side down)
    expect(right.pitch).toBeCloseTo(0);
    expect(heliAttitude(0, 0, 0, -15).roll).toBeGreaterThan(0);
    expect(heliAttitude(0, 0, -15).pitch).toBeGreaterThan(0);
  });

  it('its nose: toward its car when slow, along its way when fast, between the two in between', () => {
    const path = 0.3, face = 1.3;
    expect(heliHeading(path, face, 5)).toBeCloseTo(face);
    expect(heliHeading(path, face, HELI.faceBelow)).toBeCloseTo(face);
    expect(heliHeading(path, face, HELI.pathAbove)).toBeCloseTo(path);
    expect(heliHeading(path, face, 80)).toBeCloseTo(path);
    const mid = heliHeading(path, face, (HELI.faceBelow + HELI.pathAbove) / 2);
    expect(mid).toBeCloseTo((path + face) / 2);
    // (the short way round: across the +-PI seam, not the long way)
    const across = heliHeading(3, -3, (HELI.faceBelow + HELI.pathAbove) / 2);
    expect(Math.cos(across)).toBeLessThan(-0.95);
  });

  it('its light\'s shadow: all of the light on the road (its cone\'s low edge too), nothing above traffic', () => {
    for (const [len, drop] of [[35, 28], [50, 30], [120, 32], [260, 30]] as const) {
      const half = Math.atan((BEAM.groundRadius * 1.1) / len);
      const { near, far } = shadowSpan(len, drop, half);
      expect(near).toBeGreaterThan(0.5);
      expect(far).toBeGreaterThan(len + BEAM.shadowAfter - 1e-9); // (the car's own shadow under it)
      // (the cone's low edge on the road, 0.5 m under the lit point: in it - the shadows long at a low beam, not cut)
      const e = Math.asin(drop / len);
      if (e - half > 0.02) expect(far).toBeGreaterThanOrEqual(((drop + 0.5) / Math.sin(e - half)) * Math.cos(half) - 1e-6);
      // (its high edge BEAM.shadowAbove m over the lit point: in it - traffic on the near side of the light)
      expect(near).toBeLessThanOrEqual(((drop - BEAM.shadowAbove) / Math.sin(e + half)) * Math.cos(half) + 1e-6);
    }
    expect(shadowSpan(10, BEAM.shadowAbove - 1, 0.2).near).toBe(0.5); // (a lamp that low: all of it)
    // (a beam so low its cone's low edge never meets the road: as far as BEAM.shadowFarthest times the car's)
    expect(shadowSpan(250, 10, 0.05).far).toBeCloseTo(250 * BEAM.shadowFarthest);
    // (the near plane far out: 2 cm of bias 2 cm there - not the half metre and more it was, the near plane at 0.5 m)
    expect(shadowSpan(40, 30, Math.atan(4 / 40)).near).toBeGreaterThan(25);
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
