import type { CarSpec } from './types';
import { MUSCLE_CAR } from './muscleCar';
import { withMass } from './mass';

/**
 * The police SUV (src/game/police.ts): very heavy, a big engine, sure-footed - it runs the supercar down and shoves a
 * car out of its way. Not a car to pick (not in CARS: the garage, the tuning, the benches' "every car"); specById
 * finds it. Built on the muscle car's chassis (its big torque, launch control, automatic), every force scaled to its
 * weight, then more engine, more gears, more grip and a body an SUV's size.
 */
export const POLICE_SUV: CarSpec = {
  id: 'police-suv',
  color: 0x1b1f2a, // dark navy, white doors and the light bar (models.ts 'suv')
  style: 'suv',
  params: withMass({
    ...MUSCLE_CAR.params,
    power: MUSCLE_CAR.params.power * 1.6,
    engineTorque: MUSCLE_CAR.params.engineTorque * 1.4,
    maxSpeed: 86, // ~310 km/h: past the supercar's 300
    gearTops: [110, 170, 240, 320],
    muPeak: 1.3,
    rearGrip: 1.6,
    rearLongGrip: 1,
    escGain: MUSCLE_CAR.params.escGain * 3,
    width: 2.05,
    length: 5.0,
    wheelbase: 2.95,
    wheelRadius: 0.38,
  }, 2800),
  // training/measureCar.train.ts (CAR=police-suv; the 0 km/h point is the 50 one: from standstill it measures the
  // throttle ramp), 2026-11-24. training/cornering.train.ts: 0-100 2.96 s, 0-200 6.09 s, top 310 km/h; power on in a
  // turn 6 / 5 / 4 deg at 60 / 100 / 150 km/h (rearGrip 1.25 and the muscle car's ESC: it spun at all three).
  ai: {
    accel: [
      [0, 9.6],
      [50, 9.6],
      [100, 5.1],
      [150, 6.9],
      [200, 8.4],
      [250, 5.5],
      [300, 2.8],
    ],
    brake: [
      [0, 9],
      [50, 9],
      [100, 9.2],
      [150, 10.3],
      [200, 11.6],
      [250, 12.5],
      [300, 13.6],
    ],
    latAccel: [
      [0, 10.6],
      [50, 10.6],
      [100, 12.5],
      [150, 15],
      [200, 16.5],
      [250, 17.1],
      [300, 17.9],
    ],
  },
};
