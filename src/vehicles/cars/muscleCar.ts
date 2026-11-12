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
 * Its acceleration is its strength: quicker than the supercar to 220 km/h (launch control, a four-speed automatic),
 * level with it past that, and then its top speed runs out.
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
    // EXPERIMENT (weight, tyres, springs as before - the lean the same): against the supercar (training/dragRace) 0-100
    // 3.60 s (3.73; it took 4.47), 0-140 5.13 s (5.42; 6.21), 0-200 8.12 s (9.16; 9.70), 0-240 10.99 s (12.86;
    // 13.32), and it runs out at 259 km/h (300); side by side 16 m ahead at 10 s, 29 m at 12.5 s. Power on in a gentle
    // turn (cornering.train powerOn) it spins at 60 and 100 km/h (62 / 50 deg; 29 / 41 before, spins too), 6 deg at
    // 150 (6). 10 % more torque and power (743 kW; 646 before): 20 % more (808 kW) 0-200 7.83 s, but 16 deg at 150.
    // An automatic: the drive gone a moment each gear (0.35 s before: the shift into second, at 88 km/h then, alone
    // kept it behind the supercar to 100).
    shiftTime: 0.2,
    // Four gears, long (the others' six: 95 / 140 / 185 / 230 / 270 / 310 km/h): first to 110, past 100 km/h.
    gearTops: [110, 155, 230, 280],
    // Launch control: the tail following the nose the rears held at 2.5 m/s of slip, let go as it steps out (the power
    // slide as it was: 45 / 27 / 5 deg at 60 / 100 / 150 km/h; by the steering, 45 / 30 / 5).
    // Without it they spin 20+ m/s off the line, far past their grip's peak: 0-60 2.23 s (2.62; the supercar 2.35).
    launchSlip: 2.5,
    // Rear tyres with a drag compound: 15 % more grip straight on (1.3 x 1.15 = 1.5), sideways as before (1.3). Off the
    // line the tyres are its limit, not the engine (more power did nothing below 100 km/h): 0-100 2.96 s (3.60 without;
    // the supercar 3.73), 0-140 4.42 s (5.13), 0-200 7.41 s (8.12); a tap of the keys every 0.6 s to hold the line
    // 3.12 s. Power on in a turn (powerOn, steering 0.6) it still spins at 60 / 100 km/h (45 / 30 deg; 29 / 41 before,
    // spins too), 5 deg at 150 (6); full lock at 100 km/h 1.04 g (1.05); braking and steering hard (brakeSteer) the body
    // 10 / 10 / 8 deg off at 120 / 200 / 280 km/h (12 / 11 / 10: steadier); the lean as before. Real drag tyres grip
    // less sideways too (1.1 x 1.4: as quick, but braking and steering it slid 15 deg - hard to hold); tried too, as an
    // arcade aid, 15 % more straight on only while driving straight - as quick, but not a real tyre.
    rearLongGrip: 1.15,
    // training/cornering.train.ts (launch, powerOn, cornering, turnIn, maneuvers) against the supercar:
    // 0-100 4.0 s (4.2), 0-200 8.4 s (9.4), top 259 km/h (300), nose up ~2 deg at launch (0.7),
    // full-lock grip 1.06 / 1.4 g at 100 / 200 km/h (1.4 / 2.1), lean changing lanes 4.3-6 deg (3-4),
    // power on in a gentle turn at 60 km/h: the tail swings out 17 deg (3). No rollover, also with the
    // rubber band's +25 % grip (lean up to 10 deg).
    mass: 1450,
    comY: -0.1, // higher than the supercar's: more weight onto the rear tyres off the line (traction, nose up)
    comFwd: 0.127, // the big engine up front: 55 % of the weight on the front tyres (0.05 x the 2.54 m wheelbase)
    power: 598_500, // 743 kW at 1800 kg (520_000 before: 646 kW)
    engineTorque: 990, // 900 before
    maxDriveForce: 22_000, // 20_000 before
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
    // EXPERIMENT, measured on its drag tyres / four-speed / 743 kW (before: 7 / 7 / 9.1 / 6.3 / 4.3 / 2.7).
    accel: [
      [0, 9.4],
      [50, 9.4],
      [100, 5.1], // (the 1-2 shift, at 102 km/h, in its half second)
      [150, 6.4],
      [200, 5.1],
      [250, 3.3],
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
      [0, 8.9],
      [50, 8.9],
      [100, 10.2],
      [150, 12.3],
      [200, 14.5],
      [250, 15.3],
      [300, 15.4],
    ],
    tracker: MUSCLE_CAR_TRACKER,
    recovery: MUSCLE_CAR_RECOVERY,
  },
};
