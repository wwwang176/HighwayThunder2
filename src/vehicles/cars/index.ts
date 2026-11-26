import { STREET_RACER } from './streetRacer';
import { MUSCLE_CAR } from './muscleCar';
import { JDM_CAR } from './jdm';
import { POLICE_SUV } from './policeSuv';
import type { CarSpec } from './types';

export type { CarPerformance, CarSpec, CarStyle } from './types';
export { JDM_CAR, MUSCLE_CAR, POLICE_SUV, STREET_RACER };

/** Every car type a racer drives, by id (not the police SUV: specById). */
export const CARS: Record<string, CarSpec> = {
  [STREET_RACER.id]: STREET_RACER,
  [MUSCLE_CAR.id]: MUSCLE_CAR,
  [JDM_CAR.id]: JDM_CAR,
};

/** Any car type by id, the police SUV too (the measuring scripts'). */
export function specById(id: string): CarSpec | undefined {
  return CARS[id] ?? (id === POLICE_SUV.id ? POLICE_SUV : undefined);
}
