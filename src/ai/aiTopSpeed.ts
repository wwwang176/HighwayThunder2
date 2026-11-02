import type { CarSpec } from '../vehicles/cars/types';

/** Top speed (m/s) an AI car runs to: the AI's cap (its strength setting), or the car's own when lower. */
export function aiTopSpeed(cap: number, spec: CarSpec): number {
  return Math.min(cap, spec.params.maxSpeed);
}

/**
 * Where a car type's trained steering network lives (training/tracker.train.ts writes it):
 * `muscle-car` → src/vehicles/cars/muscleCarTracker.ts exporting MUSCLE_CAR_TRACKER.
 */
export function trackerFile(spec: CarSpec): { path: string; exportName: string } {
  const camel = spec.id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
  return { path: `src/vehicles/cars/${camel}Tracker.ts`, exportName: `${spec.id.replace(/-/g, '_').toUpperCase()}_TRACKER` };
}
