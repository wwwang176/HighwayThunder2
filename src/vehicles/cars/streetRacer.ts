import type { CarSpec } from './types';
import { STREET_RACER_TRACKER } from './streetRacerTracker';
import { SUPERCAR_COLLIDER } from './supercarCollider';

/** The supercar (id `street-racer`: the player's car since the start; engine 1.5x, see git log). Quick, the highest top speed. */
export const STREET_RACER: CarSpec = {
  id: 'street-racer',
  name: '超跑',
  color: 0xd62828,
  style: 'super',
  collider: SUPERCAR_COLLIDER, // its model's body up to the hood (and the wing at the tail), and its cabin
  params: {
    mass: 1300,
    comY: -0.25, // centre of mass 0.3 m up: at 0.5 m it rolled over turning hard at 280 km/h
    comFwd: 0, // mid-engined: half the weight on each axle
    power: 435_000, // 1.5x (was 290 kW): a street racer, not a road car
    maxDriveForce: 14_250,
    engineTorque: 600,
    redline: 7500,
    idleRpm: 900,
    driveEfficiency: 0.9,
    wheelRadius: 0.33, // its model's tyres: 305/25 R20
    width: 2.0, // its model's size
    length: 4.5,
    maxSpeed: 83.3,
    reverseMax: 8,
    reverseForce: 4_000,
    brakeForceMax: 26_000,
    // Hard braking and steering (training/cornering.train.ts brakeSteer): at 0.75 the rears locked and it spun
    // below ~150 km/h; at 0.82 the tail steps out 7-9°. More to the front brakes a little less in all.
    brakeFrontBias: 0.82,
    frontBrakeApart: true,
    dragK: 0.4,
    downforceK: 0.4, // the real part (presses the springs); most of the aero grip is aeroGrip
    wheelbase: 2.5, // its model's
    maxSteer: 0.55,
    latAccelLimit: 55,
    steerRise: 6,
    steerFall: 9,
    throttleRise: 20,
    suspensionRest: 0.3,
    suspensionTravel: 0.2,
    springProgressFrom: 1, // linear springs
    springProgressMult: 1,
    springK: 35_000,
    damperBump: 3_000,
    damperRebound: 4_500,
    antiRollFront: 9_000, // half of what it was (18k / 8k): the body leans 2-4 deg changing lanes, not 1-1.5
    antiRollRear: 4_000,
    wheelInertia: 1.2,
    muPeak: 1.3,
    muSlide: 0.85,
    slipAnglePeak: 0.105, // ~6 deg, performance street tyre
    rearGrip: 1.12,
    rollInfluence: 1, // real up to rollRefKmh; less past it as aero adds grip (rollInfluenceAt)
    aeroGrip: 0.78, // S-curve 50 -> 220 km/h: grip at 100 / 200 km/h as before (with half the real downforce), 280 km/h 15 % less
    aeroGripFrom: 50,
    aeroGripTo: 220,
    rollRefKmh: 150,
    slipFalloff: 18,
    lsd: 150,
    counterSteer: 0.8,
    steerSlowdownSpeed: Infinity,
    escGain: 9000,
    escMaxTorque: 12000,
  },
  ai: {
    // training/measureCar.train.ts (the 0 km/h point is the 50 one: from standstill it measures the throttle ramp).
    // Re-measured with the low centre of mass: within 0.6 m/s² (50: 6.2, brake 10.7) - kept, the benchmark did
    // better with these (105.2 s, no crash vs 106.4 s, one crash in 15).
    accel: [
      [0, 6.8],
      [50, 6.8],
      [100, 7.6],
      [150, 5.4],
      [200, 3.8],
      [250, 2.5],
      [300, 1.2],
    ],
    brake: 11.2,
    // Steady full-lock cornering (open ground, aero grip as of ead083d).
    latAccel: [
      [0, 10.9],
      [50, 10.9],
      [100, 13.5],
      [150, 17.7],
      [200, 20.5],
      [250, 22.2],
      [300, 23.8],
    ],
    tracker: STREET_RACER_TRACKER,
  },
};
