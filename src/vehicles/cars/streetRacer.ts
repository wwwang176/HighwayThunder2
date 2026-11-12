import type { CarSpec } from './types';
import { STREET_RACER_TRACKER } from './streetRacerTracker';
import { STREET_RACER_RECOVERY } from './streetRacerRecovery';
import { SUPERCAR_COLLIDER } from './supercarCollider';
import { withMass } from './mass';

/** The supercar as tuned, at 1300 kg (it drives at 1500: STREET_RACER). */
const SUPERCAR: CarSpec = {
  id: 'street-racer',
  name: '超跑',
  color: 0xd62828,
  style: 'super',
  collider: SUPERCAR_COLLIDER, // its model's body up to the hood (and the wing at the tail), and its cabin
  params: {
    mass: 1300,
    comY: -0.25, // centre of mass 0.3 m up: at 0.5 m it rolled over turning hard at 280 km/h
    comFwd: -0.2, // mid-engined (behind the cabin): 42 % of the weight on the front tyres, 58 % on the rear (0.08 x the 2.5 m wheelbase)
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
    // Hard braking and steering (training/cornering.train.ts brakeSteer), its weight 42:58: at 0.78 the tail steps
    // out 7-9° and it stops as it did at 50:50 with 0.82; at 0.75 14° at 120 km/h, at 0.72 it spins; at 0.82 it
    // brakes less (the lighter front tyres lock first).
    brakeFrontBias: 0.78,
    frontBrakeApart: true,
    dragK: 0.4,
    downforceK: 0.4, // the real part (presses the springs); most of the aero grip is aeroGrip
    wheelbase: 2.5, // its model's
    maxSteer: 0.55,
    latAccelLimit: 55,
    steerRise: 6,
    steerFall: 9,
    throttleRise: 20,
    shiftTime: 0.08, // a dual-clutch: the drive hardly drops
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
    lsdMax: 1500,
    // Its diff lets half the rear wheels' rolling round a bend be (lsdTurnFree): its steering within 5 % of the diff
    // locking it all (steady steering, 60-200 km/h: up to 4.3 % quicker; all of it, 8.9 %).
    lsdTurnFree: 0.5,
    counterSteer: 0.8,
    steerSlowdownSpeed: Infinity,
    escGain: 9000,
    escMaxTorque: 12000,
  },
  ai: {
    // training/measureCar.train.ts (the 0 km/h point is the 50 one: from standstill it measures the throttle ramp).
    // Measured 2026-11-03 on its model's size, its weight 42:58 (the launch quicker: the rear tyres carry more).
    accel: [
      [0, 7.8],
      [50, 7.8],
      [100, 7.6],
      [150, 5.4],
      [200, 3.8],
      [250, 2.6],
      [300, 1.3],
    ],
    brake: [
      [0, 9.8],
      [50, 9.8],
      [100, 10.4],
      [150, 12.4],
      [200, 14.2],
      [250, 15.2],
      [300, 16.4],
    ],
    // Steady full-lock cornering (open ground).
    latAccel: [
      [0, 10.8],
      [50, 10.8],
      [100, 13.3],
      [150, 17.3],
      [200, 19.8],
      [250, 21.8],
      [300, 23.6],
    ],
    tracker: STREET_RACER_TRACKER,
    recovery: STREET_RACER_RECOVERY,
  },
};

/** Its handling as tuned, at 1300 kg: where the other cars' start from (muscleCar.ts, jdm.ts). */
export const SUPERCAR_TUNE = SUPERCAR.params;

/**
 * The supercar (id `street-racer`: the player's car since the start; engine 1.5x, see git log). Quick, the
 * highest top speed. 1500 kg, a real mid-engined car's weight: as tuned at 1300, every force as much heavier
 * (withMass), so it drives the same.
 */
export const STREET_RACER: CarSpec = { ...SUPERCAR, params: withMass(SUPERCAR_TUNE, 1500) };
