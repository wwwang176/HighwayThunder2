import type { CarSpec } from './types';
import { STREET_RACER } from './streetRacer';
import { MUSCLE_CAR_TRACKER } from './muscleCarTracker';

/**
 * The muscle car: the hardest pull off the line (big torque - the nose comes up
 * under full throttle), soft springs that lean and pitch, a tail that steps out
 * under power, less grip in a corner and a lower top speed than the supercar.
 * Same size as the supercar (the AI's room-keeping assumes it).
 */
export const MUSCLE_CAR: CarSpec = {
  id: 'muscle-car',
  name: '肌肉車',
  color: 0x2b2f3a,
  style: 'muscle',
  params: {
    ...STREET_RACER.params,
    mass: 1550,
    comY: -0.2,
    engineTorque: 850,
    maxDriveForce: 19_000,
    maxSpeed: 72, // ~260 km/h
    dragK: 0.5,
    springK: 24_000,
    damperBump: 2_200,
    damperRebound: 3_200,
    antiRollFront: 5_000,
    antiRollRear: 2_000,
    muPeak: 1.2,
    rearGrip: 0.98,
    aeroGrip: 0.4,
    lsd: 300,
    escGain: 4_000,
  },
  // To be measured (training/measureCar.train.ts): the supercar's until then.
  ai: { ...STREET_RACER.ai, tracker: MUSCLE_CAR_TRACKER },
};
