import type { CarSpec } from './types';
import { SUPERCAR_TUNE } from './streetRacer';
import { withMass } from './mass';
import { JDM_TRACKER } from './jdmTracker';
import { JDM_RECOVERY } from './jdmRecovery';
import { JDM_COLLIDER } from './jdmCollider';

/**
 * The tuned JDM car: the best in a corner - the most grip, the quickest and
 * most exact answer to the wheel, a stiff low body that hardly leans and a
 * tail that stays put. Its price is the straight: the lowest top speed.
 * A four-door sedan, a little smaller than the other two (its model's size).
 */
export const JDM_CAR: CarSpec = {
  id: 'jdm',
  name: '改裝車',
  color: 0x3a8dde,
  style: 'jdm',
  collider: JDM_COLLIDER, // its model's body up to the hood (sloping down to the nose; the wing at the tail), and its cabin
  // Tuned at 1200 kg; it drives at 1400, a real tuned sedan's weight, every force as much heavier (withMass): the same.
  params: withMass({
    ...SUPERCAR_TUNE,
    shiftTime: 0.2, // a quick manual box: a short drop in drive each gear
    // training/cornering.train.ts against the supercar (muscle car): 0-100 4.04 s (4.20 / 4.01), 0-200 10.9 s
    // (9.4 / 8.5), top 245 km/h (300 / 259), full-lock grip 1.55 / 2.38 g at 100 / 200 km/h (1.37 / 2.09),
    // a lane in 0.67 s (0.71), lean 1.9-2.3 deg (3.1-3.7), power on in a turn 2 deg (3). No rollover, also
    // with +25 % grip. 0-100 hardly answers to the engine (the launch); 0-200 does.
    mass: 1200,
    comY: -0.3,
    comFwd: 0, // half the weight on each axle
    power: 340_000,
    engineTorque: 450,
    maxDriveForce: 11_000,
    maxSpeed: 68, // ~245 km/h
    nitroBurn: 1.5, // a bigger tank than the others': 6 s of nitro (NITRO.burn's 4)
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
    wheelRadius: 0.302, // its model's tyres: 245/30 R18
    wheelbase: 2.42, // its model's
    width: 1.92, // its model's size
    length: 4.4,
  }, 1400),
  // training/measureCar.train.ts (the 0 km/h point is the 50 one: from standstill it measures the throttle ramp).
  // Measured 2026-11-03 on its model's size.
  ai: {
    accel: [
      [0, 7.1],
      [50, 7.1],
      [100, 6.1],
      [150, 4.2],
      [200, 2.7],
    ],
    brake: [
      [0, 9],
      [50, 9],
      [100, 9.5],
      [150, 11.5],
      [200, 13.6],
      [250, 15],
      [300, 17],
    ],
    latAccel: [
      [0, 12.3],
      [50, 12.3],
      [100, 15],
      [150, 19.7],
      [200, 23.1],
      [250, 25.3],
      [300, 27.1],
    ],
    tracker: JDM_TRACKER,
    recovery: JDM_RECOVERY,
  },
};
