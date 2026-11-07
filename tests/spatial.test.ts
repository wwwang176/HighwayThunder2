import { describe, expect, it } from 'vitest';
import { SOUND_SPEED, dopplerFactor, trafficEngine } from '../src/audio/spatial';

const O = [0, 0, 0];

describe('Doppler', () => {
  it('raises the pitch of a source closing in, lowers it parting', () => {
    // source 100 m away along x, coming at 30 m/s
    expect(dopplerFactor([100, 0, 0], [-30, 0, 0], O, O)).toBeCloseTo(SOUND_SPEED / (SOUND_SPEED - 30));
    expect(dopplerFactor([100, 0, 0], [30, 0, 0], O, O)).toBeCloseTo(SOUND_SPEED / (SOUND_SPEED + 30));
  });

  it('counts the ear moving as well', () => {
    // ear moving toward a still source
    expect(dopplerFactor([100, 0, 0], O, O, [20, 0, 0])).toBeCloseTo((SOUND_SPEED + 20) / SOUND_SPEED);
  });

  it('is 1 for the same velocity, and for motion across the line', () => {
    expect(dopplerFactor([0, 0, -50], [0, 0, -40], O, [0, 0, -40])).toBeCloseTo(1);
    expect(dopplerFactor([100, 0, 0], [0, 0, 30], O, O)).toBeCloseTo(1);
  });
});

describe('traffic engine', () => {
  const g = { gears: 5, top: 50 };

  it('idles standing, pulls up first gear, then saws between shifts', () => {
    expect(trafficEngine(0, 0, g).rpm).toBe(0);
    expect(trafficEngine(5, 0, g).rpm).toBeCloseTo(0.4); // half of first gear
    expect(trafficEngine(10, 0, g).rpm).toBeCloseTo(0.3); // just shifted to second
    expect(trafficEngine(19.9, 0, g).rpm).toBeCloseTo(0.8, 1); // about to shift
  });

  it('reaches the redline at its top speed, and no further', () => {
    expect(trafficEngine(50, 0, g).rpm).toBeCloseTo(1);
    expect(trafficEngine(80, 0, g).rpm).toBe(1);
  });

  it('opens the throttle with the acceleration', () => {
    expect(trafficEngine(20, 0, g).throttle).toBeCloseTo(0.4);
    expect(trafficEngine(20, 2, g).throttle).toBe(1);
    expect(trafficEngine(20, -2, g).throttle).toBe(0);
  });
});
