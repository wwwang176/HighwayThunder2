import type { CarParams } from './handling';
import type { AccelTable } from '../ai/planner';

/**
 * The mountain road's setup (on top of each car's own, as tuned). The cars are set up for the highway: a diff that
 * holds the rear wheels together, a firm stability control. Here: their centre of mass lower (they lean and tip less),
 * the rear anti-roll bar stiffer, the rear wheels free to roll round a tight bend at their own speeds, the brakes a
 * little more to the rear (the tail helps the nose in), the stability control lighter, the steering quicker - and
 * their grip straight on harder (braking and driving: stopping shorter for the bends, no more cornering grip, so no
 * more lean). Mutable: tuned with training/mountainSetup.train.ts.
 *
 * Tried and dropped: the front bar halved (with the rear stiffer, it hardly turned the cars tighter: at 45-60 km/h
 * the tightest turn is the tyres' grip, ~1.1 g, reached at 60 % steering), and cornering grip x1.25 (turned them
 * 15-22 % tighter, but the muscle car tipped over in the player's hands). The mountain road's bends are banked instead
 * (road/mountain MOUNTAIN.bank).
 */
export interface MountainSetup {
  /** The centre of mass this much lower (m: CarParams.comY). */
  comDrop: number;
  /** The rear anti-roll bar times this. */
  arbRear: number;
  /** The diff lets at least this share of the rear wheels' rolling round a bend be (CarParams.lsdTurnFree). */
  lsdTurnFree: number;
  /** The brakes' front share plus this (- rearward). */
  brakeBias: number;
  /** The stability control's gain times this. */
  esc: number;
  /** The steering's turn-in rate times this. */
  steerRise: number;
  /** The tyres' grip straight on (braking, driving) times this (CarParams.longGrip: on top of the car's own camber). */
  longGrip: number;
  /**
   * The front tyres' grip times this (muPeak and muSlide up, rearGrip as much down: the rear's own `rearGrip`): the
   * cars are set up to understeer (steady at 250 km/h) - their noses wouldn't turn in a tight bend.
   */
  frontGrip: number;
  /** The rear tyres' grip times this (CarParams.rearGrip, over the front's: below frontGrip the tail lighter than built). */
  rearGrip: number;
  /** Its AI's cornering (CarSpec.ai.latAccel) times this: as much as the front grip turns the car harder (measured). */
  aiLat: number;
}

export const MOUNTAIN_SETUP: MountainSetup = {
  comDrop: 0.15,
  arbRear: 1.5,
  lsdTurnFree: 0.6,
  brakeBias: -0.05,
  esc: 0.6,
  steerRise: 1.3,
  longGrip: 1.25,
  // (the player's: x1.5. x1.2 flung to full lock: the nose round 36 -> 43° in 1 s at 60 km/h (the supercar), the
  // others alike; x1.4 and up the supercar and the jdm spin on full lock (their rear 50-90° out), the muscle car from
  // x1.4 braking at full lock, at 100 km/h from x1.5)
  frontGrip: 1.5,
  // (the player's: with the front x1.5, none spins on full lock - the rear 4-7° out, as on the highway; the lean
  // 1-2° more, the muscle car's 6° at 100 km/h)
  rearGrip: 1.25,
  // (full lock, steady at 45-100 km/h: x1.35-1.47 the sideways g of all three cars, x1.45 mostly - a little under it)
  aiLat: 1.4,
};

/**
 * Each car's own (by its id) over MOUNTAIN_SETUP. The muscle car: its tail is loose already (its power, its light
 * stability control) - with the rear bar stiffer, the brakes rearward and less stability control it slid wide and
 * spun; those as built.
 */
export const MOUNTAIN_SETUP_BY_CAR: Record<string, Partial<MountainSetup>> = {
  'muscle-car': { arbRear: 1, brakeBias: 0, esc: 1 },
};

/** A car's mountain setup (by its id: MOUNTAIN_SETUP_BY_CAR over MOUNTAIN_SETUP). */
export function mountainSetupOf(id: string): MountainSetup {
  return { ...MOUNTAIN_SETUP, ...MOUNTAIN_SETUP_BY_CAR[id] };
}

/** A car's AI tables (CarSpec.ai) for its mountain setup: its braking times `longGrip`, its cornering times `aiLat`; speeding up as it was (the engine's, mostly). */
export function mountainAi<T extends { brake: AccelTable; latAccel: AccelTable }>(ai: T, s: MountainSetup = MOUNTAIN_SETUP): T {
  return {
    ...ai,
    brake: ai.brake.map(([kmh, a]) => [kmh, a * s.longGrip] as [number, number]),
    latAccel: ai.latAccel.map(([kmh, a]) => [kmh, a * s.aiLat] as [number, number]),
  };
}

/** The car `p` set up for the mountain road (a copy; `p` as it was). */
export function mountainSetup(p: CarParams, s: MountainSetup = MOUNTAIN_SETUP): CarParams {
  return {
    ...p,
    comY: p.comY - s.comDrop,
    antiRollRear: p.antiRollRear * s.arbRear,
    lsdTurnFree: Math.max(p.lsdTurnFree ?? 1, s.lsdTurnFree),
    brakeFrontBias: p.brakeFrontBias + s.brakeBias,
    escGain: p.escGain * s.esc,
    steerRise: p.steerRise * s.steerRise,
    longGrip: (p.longGrip ?? 1) * s.longGrip,
    muPeak: p.muPeak * s.frontGrip,
    muSlide: p.muSlide * s.frontGrip,
    rearGrip: (p.rearGrip * s.rearGrip) / s.frontGrip,
  };
}
