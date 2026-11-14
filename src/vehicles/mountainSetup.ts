import type { CarParams } from './handling';

/**
 * The mountain road's setup (on top of each car's own, as tuned): the cars are set up for the highway - a stiff
 * front anti-roll bar (understeer: steady at 250 km/h), a diff that holds the rear wheels together, a firm stability
 * control. In a hairpin at 50 km/h that made the front tyres slide past their grip with the wheel half turned (full
 * lock turned no tighter: pushing on). Here: the front's bar softer and the rear's stiffer, the rear wheels free to
 * roll round a tight bend at their own speeds, the brakes a little more to the rear (the tail helps the nose in),
 * the stability control lighter, the steering quicker. Mutable: tuned with training/mountainSetup.train.ts.
 */
export interface MountainSetup {
  /** The anti-roll bars, front and rear, times these. */
  arbFront: number;
  arbRear: number;
  /** The diff lets at least this share of the rear wheels' rolling round a bend be (CarParams.lsdTurnFree). */
  lsdTurnFree: number;
  /** The brakes' front share plus this (- rearward). */
  brakeBias: number;
  /** The stability control's gain times this. */
  esc: number;
  /** The steering's turn-in rate times this. */
  steerRise: number;
  /** The tyres' grip cornering times this (CarParams.latGrip: on top of the car's own camber). */
  grip: number;
}

export const MOUNTAIN_SETUP: MountainSetup = {
  arbFront: 0.5,
  arbRear: 1.5,
  lsdTurnFree: 0.6,
  brakeBias: -0.05,
  esc: 0.6,
  steerRise: 1.3,
  grip: 1,
};

/** The car `p` set up for the mountain road (a copy; `p` as it was). */
export function mountainSetup(p: CarParams, s: MountainSetup = MOUNTAIN_SETUP): CarParams {
  return {
    ...p,
    antiRollFront: p.antiRollFront * s.arbFront,
    antiRollRear: p.antiRollRear * s.arbRear,
    lsdTurnFree: Math.max(p.lsdTurnFree ?? 1, s.lsdTurnFree),
    brakeFrontBias: p.brakeFrontBias + s.brakeBias,
    escGain: p.escGain * s.esc,
    steerRise: p.steerRise * s.steerRise,
    latGrip: (p.latGrip ?? 1) * s.grip,
  };
}
