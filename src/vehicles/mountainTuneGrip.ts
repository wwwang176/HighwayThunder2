import type { AccelTable } from '../ai/planner';
import { MOUNTAIN_TUNE_GRIP } from './mountainTuneGripData';
import type { TuneKey, Tuning } from './tuning';

/**
 * A tuned car's cornering and brakes on the mountain road over as built: what its AI's line is planned with (its
 * mountain tables, CarSpec.ai.mountain, scaled - a rival is tuned at random each race: a knob 2-5 % either way on its
 * cornering at the mountain's speeds, the four together up to ~8 %). Measured knob by knob at each level
 * (training/mountainGrip.train.ts TUNE=1), the knobs together their product (6 tunings at random measured whole: off by
 * 0.2-0.7 % on average).
 */
export type MountainTuneGrip = Record<string, Partial<Record<TuneKey, Record<string, { lat: number[]; brake: number[] }>>>>;

/** The speeds (km/h) the tuning's change is measured at: below the first as at it, past the last as at it. */
export const MOUNTAIN_TUNE_MARKS = [50, 75, 100, 125, 150, 175, 200, 250];

/** The perf knobs that change its grip (the gearing and the nitro: not). */
export const MOUNTAIN_GRIP_KNOBS: TuneKey[] = ['pressure', 'width', 'camber', 'wing'];

/** Its cornering and brakes as tuned over as built at each of MOUNTAIN_TUNE_MARKS (1: as built, or unmeasured). */
export function mountainTuneFactors(carId: string, tuning: Tuning, data: MountainTuneGrip = MOUNTAIN_TUNE_GRIP): { lat: number[]; brake: number[] } {
  const lat = MOUNTAIN_TUNE_MARKS.map(() => 1);
  const brake = MOUNTAIN_TUNE_MARKS.map(() => 1);
  for (const key of MOUNTAIN_GRIP_KNOBS) {
    const level = Math.max(-2, Math.min(2, Math.round(tuning[key] ?? 0)));
    const m = level ? data[carId]?.[key]?.[String(level)] : undefined;
    if (!m) continue;
    MOUNTAIN_TUNE_MARKS.forEach((_, i) => {
      lat[i] *= m.lat[i];
      brake[i] *= m.brake[i];
    });
  }
  return { lat, brake };
}

/** f (at MOUNTAIN_TUNE_MARKS) at `kmh`, between them linearly. */
function at(f: number[], kmh: number): number {
  const M = MOUNTAIN_TUNE_MARKS;
  if (kmh <= M[0]) return f[0];
  for (let i = 1; i < M.length; i++) if (kmh <= M[i]) return f[i - 1] + ((kmh - M[i - 1]) / (M[i] - M[i - 1])) * (f[i] - f[i - 1]);
  return f[M.length - 1];
}

/** Its mountain AI tables (mountainAi's) for the car tuned so: its cornering and braking scaled by the tuning's. */
export function tunedMountainAi<T extends { brake: AccelTable; latAccel: AccelTable }>(ai: T, carId: string, tuning: Tuning | undefined): T {
  if (!tuning) return ai;
  const f = mountainTuneFactors(carId, tuning);
  return {
    ...ai,
    latAccel: ai.latAccel.map(([kmh, a]) => [kmh, a * at(f.lat, kmh)] as [number, number]),
    brake: ai.brake.map(([kmh, a]) => [kmh, a * at(f.brake, kmh)] as [number, number]),
  };
}
