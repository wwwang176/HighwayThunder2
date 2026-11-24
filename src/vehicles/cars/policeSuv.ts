import type { CarSpec } from './types';
import { MUSCLE_CAR } from './muscleCar';
import { withMass } from './mass';
import { POLICE_SUV_COLLIDER } from './policeSuvCollider';

/**
 * The police SUV (src/game/police.ts): very heavy, sure-footed, and slower than every sports car - away and flat out
 * (it gets them by being in their way, not by running them down) - it shoves a car out of its way. Not a car to pick
 * (not in CARS: the garage, the tuning, the benches' "every car"); specById finds it. Built on the muscle car's
 * chassis (launch control, automatic), every force scaled to its weight, then a smaller engine, more grip and a body
 * an SUV's size.
 */
export const POLICE_SUV: CarSpec = {
  id: 'police-suv',
  color: 0x1b1f2a, // dark navy, white doors and the light bar (public/models/police-suv.glb; models.ts 'suv' before it loads)
  style: 'suv',
  collider: POLICE_SUV_COLLIDER, // its model's body to the belt line, push bar to tail, and its cabin
  params: withMass({
    ...MUSCLE_CAR.params,
    // Slower than the slowest sports car (the JDM: 0-100 4.28 s, 0-200 11.72 s, top 245 km/h): away it is grip-bound,
    // only less torque slows it there.
    power: MUSCLE_CAR.params.power * 0.72,
    engineTorque: MUSCLE_CAR.params.engineTorque * 0.38,
    maxSpeed: 65, // ~235 km/h
    gearTops: [90, 140, 190, 250],
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
    // Its body down onto its wheels: its model has the wheels' centres 0.142 under its origin; on the muscle car's 0.42
    // the springs held them 0.21-0.23 under (its tyres bigger), the body 8 cm up off them, gaps over the tyres.
    suspensionRest: 0.34,
  }, 2800),
  // training/measureCar.train.ts (CAR=police-suv; the 0 km/h point is the 50 one: from standstill it measures the
  // throttle ramp; no 250 or 300: past its top speed), 2026-11-25.
  // training/cornering.train.ts: 0-100 4.48 s, 0-200 16.43 s, top 234 km/h; power on in a turn 1 / 1 / 2 deg at
  // 60 / 100 / 150 km/h; full lock at 200 km/h 1.76 g, tilting 4 deg, a lane change's most 3.9 deg (comY -0.1, the
  // muscle car's: it rolled over there on the model's big wheels and short wheelbase).
  ai: {
    accel: [
      [0, 6.9],
      [50, 6.9],
      [100, 4.2],
      [150, 2.7],
      [200, 1.4],
    ],
    brake: [
      [0, 8.4],
      [50, 8.4],
      [100, 8.5],
      [150, 9.5],
      [200, 10.8],
      [250, 11.7],
      [300, 12.8],
    ],
    latAccel: [
      [0, 11.1],
      [50, 11.1],
      [100, 12.8],
      [150, 15],
      [200, 17.2],
      [250, 18.4],
      [300, 19.6],
    ],
  },
};
