import { STREET_RACER } from './streetRacer';
import type { CarSpec } from './types';

export type { CarPerformance, CarSpec } from './types';
export { STREET_RACER };

/** Every car type, by id. */
export const CARS: Record<string, CarSpec> = {
  [STREET_RACER.id]: STREET_RACER,
};
