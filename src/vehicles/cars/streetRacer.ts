import type { CarSpec } from './types';

/** The street racer: the player's car since the start (engine 1.5x, see git log). */
export const STREET_RACER: CarSpec = {
  id: 'street-racer',
  name: '街頭跑車',
  color: 0xd62828,
  params: {
    mass: 1300,
    comY: -0.25, // centre of mass 0.3 m up: at 0.5 m it rolled over turning hard at 280 km/h
    power: 435_000, // 1.5x (was 290 kW): a street racer, not a road car
    maxDriveForce: 14_250,
    engineTorque: 600,
    redline: 7500,
    idleRpm: 900,
    driveEfficiency: 0.9,
    wheelRadius: 0.34,
    maxSpeed: 83.3,
    reverseMax: 8,
    reverseForce: 4_000,
    brakeForceMax: 26_000,
    brakeFrontBias: 0.75,
    dragK: 0.4,
    downforceK: 0.4, // the real part (presses the springs); most of the aero grip is aeroGrip
    wheelbase: 2.6,
    maxSteer: 0.55,
    latAccelLimit: 55,
    steerRise: 6,
    steerFall: 9,
    throttleRise: 20,
    suspensionRest: 0.3,
    suspensionTravel: 0.2,
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
  },
};
