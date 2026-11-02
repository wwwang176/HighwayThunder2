import { describe, it, expect } from 'vitest';
import { aiTopSpeed, trackerFile } from '../src/ai/aiTopSpeed';
import { MUSCLE_CAR, STREET_RACER } from '../src/vehicles/cars';
import { KMH } from '../src/config';

describe('aiTopSpeed', () => {
  it("the AI's cap, or the car's own top speed when that is lower", () => {
    expect(aiTopSpeed(300 * KMH, MUSCLE_CAR)).toBe(MUSCLE_CAR.params.maxSpeed);
    expect(aiTopSpeed(200 * KMH, MUSCLE_CAR)).toBe(200 * KMH);
  });
});

describe('trackerFile', () => {
  it("each car's steering network has its own file", () => {
    expect(trackerFile(MUSCLE_CAR)).toEqual({ path: 'src/vehicles/cars/muscleCarTracker.ts', exportName: 'MUSCLE_CAR_TRACKER' });
    expect(trackerFile(STREET_RACER)).toEqual({ path: 'src/vehicles/cars/streetRacerTracker.ts', exportName: 'STREET_RACER_TRACKER' });
  });
});
