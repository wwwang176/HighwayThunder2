import type { CarParams } from './handling';
import type { AccelTable } from '../ai/planner';

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
  /**
   * Its AI's cornering (CarSpec.ai.latAccel) times this: as much as the grip where the car corners as much harder
   * (mountainAi); less where it doesn't.
   */
  aiGrip: number;
}

export const MOUNTAIN_SETUP: MountainSetup = {
  arbFront: 0.5,
  arbRear: 1.5,
  lsdTurnFree: 0.6,
  brakeBias: -0.05,
  esc: 0.6,
  steerRise: 1.3,
  // (x1.25: at 45 km/h full lock R 13.6 -> 11.7 m, at 60 22.7 -> 17.6 m - the supercar; training/mountainSetup.train.ts)
  grip: 1.25,
  aiGrip: 1.25,
};

/**
 * Each car's own (by its id) over MOUNTAIN_SETUP. The muscle car: its limit is its tail (its power, its light
 * stability control), not its tyres' grip - x1.25 grip, at 45 km/h it turns no tighter (R 12.9 -> 13.2 m), and its AI
 * planning for x1.25 slid it wide at 150 km/h. Its rear as built, its AI planning x1.15 (30 mountain races: none put
 * back; its mean 121.7 -> 114.2 s, the others' ~114.6 -> ~104.4 s).
 */
export const MOUNTAIN_SETUP_BY_CAR: Record<string, Partial<MountainSetup>> = {
  'muscle-car': { arbRear: 1, brakeBias: 0, esc: 1, aiGrip: 1.15 },
};

/** A car's mountain setup (by its id: MOUNTAIN_SETUP_BY_CAR over MOUNTAIN_SETUP). */
export function mountainSetupOf(id: string): MountainSetup {
  return { ...MOUNTAIN_SETUP, ...MOUNTAIN_SETUP_BY_CAR[id] };
}

/** A car's AI tables (CarSpec.ai) for its mountain setup: its cornering times `aiGrip`; speeding up and braking as they were. */
export function mountainAi<T extends { latAccel: AccelTable }>(ai: T, s: MountainSetup = MOUNTAIN_SETUP): T {
  return { ...ai, latAccel: ai.latAccel.map(([kmh, a]) => [kmh, a * s.aiGrip] as [number, number]) };
}

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
    // (gripping harder it leans no more: the body gets as much less of the tyres' rolling torque - as the car's own
    // rollInfluence does for aero grip, rollInfluenceAt; at x1.25 it tipped the muscle car over)
    rollInfluence: p.rollInfluence / s.grip,
  };
}
