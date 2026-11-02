import { STREET_RACER } from './streetRacer';
import { MUSCLE_CAR } from './muscleCar';
import { JDM_CAR } from './jdm';
import type { CarSpec } from './types';

export type { CarPerformance, CarSpec, CarStyle } from './types';
export { JDM_CAR, MUSCLE_CAR, STREET_RACER };

/** Every car type, by id. */
export const CARS: Record<string, CarSpec> = {
  [STREET_RACER.id]: STREET_RACER,
  [MUSCLE_CAR.id]: MUSCLE_CAR,
  [JDM_CAR.id]: JDM_CAR,
};
