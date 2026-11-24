import type { CarSpec } from './types';
import { MUSCLE_CAR } from './muscleCar';
import { withMass } from './mass';
import { POLICE_SUV_COLLIDER } from './policeSuvCollider';

/**
 * The police SUV (src/game/police.ts): very heavy, a big engine, sure-footed - it runs the supercar down and shoves a
 * car out of its way. Not a car to pick (not in CARS: the garage, the tuning, the benches' "every car"); specById
 * finds it. Built on the muscle car's chassis (its big torque, launch control, automatic), every force scaled to its
 * weight, then more engine, more gears, more grip and a body an SUV's size.
 */
export const POLICE_SUV: CarSpec = {
  id: 'police-suv',
  color: 0x1b1f2a, // dark navy, white doors and the light bar (public/models/police-suv.glb; models.ts 'suv' before it loads)
  style: 'suv',
  collider: POLICE_SUV_COLLIDER, // its model's body to the belt line, push bar to tail, and its cabin
  params: withMass({
    ...MUSCLE_CAR.params,
    power: MUSCLE_CAR.params.power * 1.6,
    engineTorque: MUSCLE_CAR.params.engineTorque * 1.4,
    maxSpeed: 86, // ~310 km/h: past the supercar's 300
    gearTops: [110, 170, 240, 320],
    muPeak: 1.3,
    rearGrip: 1.9, // (with its low centre of mass: less weight on the rear tyres pulling away; 1.75 slid 16 deg on power at 100 km/h)
    rearLongGrip: 1,
    escGain: MUSCLE_CAR.params.escGain * 3,
    comY: -0.4, // low: on its model's size and big wheels it rolled over at full lock at 200 km/h (the muscle car's -0.1); -0.3 leant 5 deg
    // Its model's (tools/models/police_suv.py): its body (not the mirrors), its axles, its 285/45 R22 tyres.
    width: 1.98,
    length: 4.96,
    wheelbase: 2.868, // (its front wheels in the middle of their arches: the generated ones sat back)
    wheelRadius: 0.408,
  }, 2800),
  // training/measureCar.train.ts (CAR=police-suv; the 0 km/h point is the 50 one: from standstill it measures the
  // throttle ramp), 2026-11-24, on its model's size (at wheelbase 2.83, comY -0.3, rearGrip 1.75: since, the
  // wheelbase 1 % longer and the centre of mass lower, the cornering below near the same - left alone).
  // training/cornering.train.ts (2.868, comY -0.4, rearGrip 1.9): 0-100 2.94 s, 0-200 5.99 s, top 310 km/h; power on
  // in a turn 11 / 5 / 2 deg at 60 / 100 / 150 km/h; full lock at 200 km/h 1.79 g, tilting 4 deg, a lane change's
  // most 3.9 deg (comY -0.1, the muscle car's: it rolled over there on the model's big wheels and short wheelbase).
  ai: {
    accel: [
      [0, 9.5],
      [50, 9.5],
      [100, 5.6],
      [150, 6.9],
      [200, 8.5],
      [250, 5.5],
      [300, 2.7],
    ],
    brake: [
      [0, 8.6],
      [50, 8.6],
      [100, 8.7],
      [150, 9.8],
      [200, 11.1],
      [250, 12],
      [300, 13.1],
    ],
    latAccel: [
      [0, 11],
      [50, 11],
      [100, 12.8],
      [150, 15.3],
      [200, 17.5],
      [250, 17.3],
      [300, 18.4],
    ],
  },
};
