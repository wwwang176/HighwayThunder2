import { describe, expect, it } from 'vitest';
import { MOUNTAIN_TUNE_MARKS, mountainTuneFactors, tunedMountainAi } from '../src/vehicles/mountainTuneGrip';
import { MOUNTAIN_TUNE_GRIP } from '../src/vehicles/mountainTuneGripData';

const AI = { accel: [[0, 8]] as [number, number][], latAccel: [[0, 10], [100, 20], [300, 30]] as [number, number][], brake: [[0, 12], [150, 15]] as [number, number][] };

describe('mountainTuneGrip', () => {
  it('as built, or tuned in knobs not its grip: its tables as they were', () => {
    expect(tunedMountainAi(AI, 'muscle-car', undefined)).toBe(AI);
    const t = tunedMountainAi(AI, 'muscle-car', { finalDrive: 2, nitro: -1 });
    expect(t.latAccel).toEqual(AI.latAccel);
    expect(t.brake).toEqual(AI.brake);
  });

  it("tuned: each knob's measured change multiplied, at each table speed (between the marks linearly)", () => {
    const g = MOUNTAIN_TUNE_GRIP['muscle-car'];
    const f = mountainTuneFactors('muscle-car', { camber: 2, wing: -1 });
    MOUNTAIN_TUNE_MARKS.forEach((_, i) => expect(f.lat[i]).toBeCloseTo(g.camber!['2'].lat[i] * g.wing!['-1'].lat[i], 9));
    const t = tunedMountainAi(AI, 'muscle-car', { camber: 2, wing: -1 });
    expect(t.latAccel[0][1]).toBeCloseTo(10 * f.lat[0], 9); // (under the first mark: as at it)
    expect(t.latAccel[1][1]).toBeCloseTo(20 * f.lat[2], 9); // (100 km/h: the third mark)
    expect(t.latAccel[2][1]).toBeCloseTo(30 * f.lat[MOUNTAIN_TUNE_MARKS.length - 1], 9); // (past the last: as at it)
    expect(t.brake[1][1]).toBeCloseTo(15 * f.brake[4], 9);
    expect(t.accel).toBe(AI.accel);
  });
});
