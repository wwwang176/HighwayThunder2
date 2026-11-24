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
    rearGrip: 1.75,
    rearLongGrip: 1,
    escGain: MUSCLE_CAR.params.escGain * 3,
    comY: -0.3, // low: on its model's size and big wheels it rolled over at full lock at 200 km/h (the muscle car's -0.1)
    // Its model's (tools/models/police_suv.py): its body (not the mirrors), its axles, its 285/45 R22 tyres.
    width: 1.98,
    length: 4.96,
    wheelbase: 2.83,
    wheelRadius: 0.408,
  }, 2800),
  // training/measureCar.train.ts (CAR=police-suv; the 0 km/h point is the 50 one: from standstill it measures the
  // throttle ramp), 2026-11-24, on its model's size. training/cornering.train.ts: 0-100 3.02 s, 0-200 6.10 s, top
  // 310 km/h; power on in a turn 12 / 5 / 3 deg at 60 / 100 / 150 km/h; full lock at 200 km/h 1.78 g, tilting 5 deg
  // (comY -0.1, the muscle car's: it rolled over there on the model's big wheels and short wheelbase).
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
