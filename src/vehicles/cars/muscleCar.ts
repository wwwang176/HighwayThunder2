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
    // training/cornering.train.ts (launch, powerOn, cornering, turnIn, maneuvers) against the supercar:
    // 0-100 4.0 s (4.2), 0-200 8.5 s (9.4), top 259 km/h (300), nose up ~3 deg at launch (0.7),
    // full-lock grip 1.0 / 1.4 g at 100 / 200 km/h (1.4 / 2.1), lean changing lanes 4.6-6 deg (3-4),
    // power on in a gentle turn at 60 km/h: the tail swings out 10 deg (3). No rollover, also with the
    // rubber band's +25 % grip.
    mass: 1450,
    comY: -0.1, // higher than the supercar's: more weight onto the rear tyres off the line (traction, nose up)
    power: 520_000,
    engineTorque: 900,
    maxDriveForce: 20_000,
    maxSpeed: 72, // ~260 km/h
    dragK: 0.5,
    // Soft springs need the travel: at 20 cm they bottomed out in a turn and the car rolled over.
    suspensionRest: 0.42,
    suspensionTravel: 0.38,
    springK: 18_000,
    damperBump: 1_800,
    damperRebound: 2_600,
    antiRollFront: 12_000,
    antiRollRear: 5_000,
    rollRefKmh: 100, // the tyres' rolling moment eases off from here: with +25 % grip it rolled over at 200 km/h
    muPeak: 1.15,
    rearGrip: 1.22, // 1.3: no power slide; 1.15: no launch
    aeroGrip: 0.4,
    lsd: 600,
    escGain: 1_500, // 0: it spins whenever the throttle goes down in a turn
  },
  // training/measureCar.train.ts (the 0 km/h point is the 50 one: from standstill it measures the throttle ramp).
  ai: {
    accel: [
      [0, 7.1],
      [50, 7.1],
      [100, 8.3],
      [150, 6.4],
      [200, 4.3],
      [250, 2.7],
    ],
    brake: 10.2,
    latAccel: [
      [0, 8.9],
      [50, 8.9],
      [100, 9.6],
      [150, 12],
      [200, 13.5],
      [250, 14.5],
      [300, 15.4],
    ],
    tracker: MUSCLE_CAR_TRACKER,
  },
};
