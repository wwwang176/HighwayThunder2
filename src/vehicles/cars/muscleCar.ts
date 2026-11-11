import type { CarSpec } from './types';
import { SUPERCAR_TUNE } from './streetRacer';
import { withMass } from './mass';
import { MUSCLE_CAR_TRACKER } from './muscleCarTracker';
import { MUSCLE_CAR_RECOVERY } from './muscleCarRecovery';
import { MUSCLE_CAR_COLLIDER } from './muscleCarCollider';

/**
 * The muscle car: the hardest pull off the line (big torque - the nose comes up
 * under full throttle), soft springs that lean and pitch, a tail that steps out
 * under power, less grip in a corner and a lower top speed than the supercar.
 * A little bigger than the supercar (its model's size: params.width, length).
 */
export const MUSCLE_CAR: CarSpec = {
  id: 'muscle-car',
  name: '肌肉車',
  color: 0xf2780c, // the concept's orange (docs/art/muscle-car): the dark paint was lost at night
  style: 'muscle',
  collider: MUSCLE_CAR_COLLIDER, // its model's body up to the hood (and deck), and its cabin
  // Tuned at 1450 kg; it drives at 1800, a real muscle car's weight, every force as much heavier (withMass): the same.
  params: withMass({
    ...SUPERCAR_TUNE,
    shiftTime: 0.35, // an old automatic: a slow, lazy shift, the drive gone a moment each gear
    // training/cornering.train.ts (launch, powerOn, cornering, turnIn, maneuvers) against the supercar:
    // 0-100 4.0 s (4.2), 0-200 8.4 s (9.4), top 259 km/h (300), nose up ~2 deg at launch (0.7),
    // full-lock grip 1.06 / 1.4 g at 100 / 200 km/h (1.4 / 2.1), lean changing lanes 4.3-6 deg (3-4),
    // power on in a gentle turn at 60 km/h: the tail swings out 17 deg (3). No rollover, also with the
    // rubber band's +25 % grip (lean up to 10 deg).
    mass: 1450,
    comY: -0.1, // higher than the supercar's: more weight onto the rear tyres off the line (traction, nose up)
    comFwd: 0.127, // the big engine up front: 55 % of the weight on the front tyres (0.05 x the 2.54 m wheelbase)
    power: 520_000,
    engineTorque: 900,
    maxDriveForce: 20_000,
    maxSpeed: 72, // ~260 km/h
    brakeFrontBias: 0.88, // braking and steering hard the tail swings out 11-12° and comes back (0.82: it spun at 120 km/h)
    dragK: 0.5,
    // Soft springs need the travel: at 20 cm they bottomed out in a turn and the car rolled over.
    suspensionRest: 0.42,
    suspensionTravel: 0.38,
    // Soft in everyday motion, firm when it dives deep: from 60 % of the travel (it sits at ~55 %) the springs
    // stiffen, 8x at full travel. Linear, a hard brake dived the nose 3.8° and the body scraped the road.
    springProgressFrom: 0.6,
    springProgressMult: 8,
    springK: 18_000,
    damperBump: 1_800,
    damperRebound: 2_600,
    antiRollFront: 12_000,
    antiRollRear: 5_000,
    rollRefKmh: 100, // the tyres' rolling moment eases off from here: with +25 % grip it rolled over at 200 km/h
    muPeak: 1.15,
    // Wide rear tyres for the light tail (45 % of the weight): at 1.22 it launched in 4.4 s and spun with power
    // on in a turn; at 1.35 it launched in 3.8 s and barely slid (50 / 50: 1.22; 1.3 no power slide, 1.15 no launch).
    rearGrip: 1.3,
    aeroGrip: 0.4,
    lsd: 600,
    escGain: 1_500, // 0: it spins whenever the throttle goes down in a turn
    // Its model's (public/models/muscle-car.glb, tools/models/muscle_car.py): the wheels in its arches, its body.
    wheelRadius: 0.324,
    wheelbase: 2.54,
    width: 1.99,
    length: 4.52,
  }, 1800),
  // training/measureCar.train.ts (the 0 km/h point is the 50 one: from standstill it measures the throttle ramp).
  ai: {
    accel: [
      [0, 7],
      [50, 7],
      [100, 9.1], // (the 1-2 shift's cut lets the spinning rears hook up: was 8.1)
      [150, 6.3],
      [200, 4.3],
      [250, 2.7],
    ],
    brake: [
      [0, 8.6],
      [50, 8.6],
      [100, 9],
      [150, 10.2],
      [200, 11.6],
      [250, 12.6],
      [300, 13.8],
    ],
    latAccel: [
      [0, 9.3],
      [50, 9.3],
      [100, 10.3],
      [150, 12.4],
      [200, 14.4],
      [250, 15.4],
      [300, 16.2],
    ],
    tracker: MUSCLE_CAR_TRACKER,
    recovery: MUSCLE_CAR_RECOVERY,
  },
};
