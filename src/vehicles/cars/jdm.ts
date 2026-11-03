import type { CarSpec } from './types';
import { STREET_RACER } from './streetRacer';
import { JDM_TRACKER } from './jdmTracker';

/**
 * The tuned JDM car: the best in a corner - the most grip, the quickest and
 * most exact answer to the wheel, a stiff low body that hardly leans and a
 * tail that stays put. Its price is the straight: the lowest top speed.
 * Same size as the supercar (the AI's room-keeping assumes it).
 */
export const JDM_CAR: CarSpec = {
  id: 'jdm',
  name: '改裝車',
  color: 0x3a8dde,
  style: 'jdm',
  params: {
    ...STREET_RACER.params,
    // training/cornering.train.ts against the supercar (muscle car): 0-100 4.04 s (4.20 / 4.01), 0-200 10.9 s
    // (9.4 / 8.5), top 245 km/h (300 / 259), full-lock grip 1.55 / 2.38 g at 100 / 200 km/h (1.37 / 2.09),
    // a lane in 0.67 s (0.71), lean 1.9-2.3 deg (3.1-3.7), power on in a turn 2 deg (3). No rollover, also
    // with +25 % grip. 0-100 hardly answers to the engine (the launch); 0-200 does.
    mass: 1200,
    comY: -0.3,
    power: 340_000,
    engineTorque: 450,
    maxDriveForce: 11_000,
    maxSpeed: 68, // ~245 km/h
    brakeFrontBias: 0.88, // braking and steering hard the tail barely moves (3-4°): the most precise of the three
    dragK: 0.45,
    steerRise: 8,
    springK: 45_000,
    damperBump: 3_600,
    damperRebound: 5_200,
    antiRollFront: 14_000,
    antiRollRear: 7_000,
    rollRefKmh: 120,
    muPeak: 1.45,
    slipAnglePeak: 0.09,
    lsd: 200,
    escGain: 12_000,
  },
  // training/measureCar.train.ts (the 0 km/h point is the 50 one: from standstill it measures the throttle ramp).
  ai: {
    accel: [
      [0, 7.3],
      [50, 7.3],
      [100, 6.1],
      [150, 4.2],
      [200, 2.8],
    ],
    brake: 12.3,
    latAccel: [
      [0, 12.3],
      [50, 12.3],
      [100, 15.2],
      [150, 20],
      [200, 23.4],
      [250, 25.5],
      [300, 27.3],
    ],
    tracker: JDM_TRACKER,
  },
};
