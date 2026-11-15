import type { CarParams, DriftAssist } from './handling';
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
  /**
   * Traction control: the drive eased to hold the rear tyres' slip at this (m/s, CarParams.tractionSlip), sliding or not:
   * full throttle (the keys') spun the rear tyres, their sideways grip gone with it, and the car slid on along its old
   * line, not the nose's.
   */
  tractionSlip: number;
  /**
   * Drift assist (CarParams.drift; the player's): sliding, the car the driver's - the traction control (which
   * straightened every slide on the throttle) and the stability control let it be till the slide is over.
   */
  drift: DriftAssist;
}

export const MOUNTAIN_SETUP: MountainSetup = {
  comDrop: 0.15,
  arbRear: 1.5,
  lsdTurnFree: 0.6,
  brakeBias: -0.05,
  esc: 0.6,
  steerRise: 1.3,
  longGrip: 1.25,
  // (the player's: x1.25 - x1.5 / x1.25 halved, the nose too quick at low speed. Alone, x1.4 and up the supercar and
  // the jdm spin on full lock (their rear 50-90° out); x1.2 flung to full lock: the nose round 36 -> 43° in 1 s at
  // 60 km/h (the supercar))
  frontGrip: 1.25,
  // (the player's: x1.125, with the front's. The rear 5-6° out on full lock, as on the highway; full lock at 45 km/h
  // R 15 -> 12 m (the supercar), at 150 km/h R 103 -> 78 m; the lean no more than on the highway)
  rearGrip: 1.125,
  // (full lock, steady at 80-150 km/h: x1.28-1.31 the sideways g of all three cars, x1.19-1.28 at 45 - a little under it)
  aiLat: 1.25,
  // (the rear tyres spinning 1 m/s at most: a 30° slide at 60 km/h, counter-steered 0.5 on full throttle, 19 -> 4° at
  // 1.2 s (the supercar), 27 -> 3° (the muscle car); out of a 45 km/h full-lock turn on full throttle the slide 33 -> 4°,
  // 58 -> 3°, 2 s on 75 -> 93 km/h, 37 -> 101. The jdm alike before (9°: its rear not spinning but its grip spent
  // driving; counting a tyre over its grip in, it choked the drive in every tight bend: 83 -> 64 km/h). The muscle
  // car's 0-100 2.07 -> 2.45 s, its launch control's smoke held in.)
  tractionSlip: 1,
  // (60 km/h, the handbrake tapped 0.1 s on full lock, then full throttle 3 s: the steering held at full lock the slide
  // held at 26-28° (all three cars, 33° at most; before the limit 35-47° let go, past 80° held - a spin), let go it
  // eases off; the steering and the throttle tapped (the keys) 26-28° held 4 s. The drive eased from 20° (as before
  // the limit) and the rear x0.85: tapped, the slide was gone in a second. Halving the drive's easing instead (10-20°)
  // the slide was gone in a second too; the stability control 6x from 20° held nothing (it holds the turning to what
  // the steering asks, and full lock asks for the spin). The player's next: it still straightened, and slid on its old
  // line with the nose turned - the rear's sideways grip only x0.65 (its drive as it was), the drive eased from 40°
  // (the limit holds it under), and on the throttle a push toward the nose (carve 5 m/s² from 25°; not measured: the
  // player tries it). Then: the throttle straightened it (the push, the rear hooked up) - the player wants it the other
  // way: the rear sideways x0.85 off the throttle, x0.55 on full throttle, the push only off it. Then: on the throttle
  // too little slide - x0.45 on full throttle, straight on too (driftRearLong: the tyres spin up), the limit 25 -> 32°
  // (not measured))
  drift: {
    minSpeed: 25 / 3.6,
    enter: (12 * Math.PI) / 180,
    exit: (6 * Math.PI) / 180,
    exitTime: 0.3,
    grace: 0.5,
    escFrom: (55 * Math.PI) / 180,
    escFull: (75 * Math.PI) / 180,
    rearGrip: 0.85,
    rearGripOn: 0.45,
    limit: (32 * Math.PI) / 180,
    hold: 120_000,
    damp: 25_000,
    holdMax: 40_000,
    powerFrom: (40 * Math.PI) / 180,
    powerTo: (55 * Math.PI) / 180,
    least: 0.3,
    carve: 5,
    carveFull: (25 * Math.PI) / 180,
  },
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
    tractionSlip: s.tractionSlip,
    drift: s.drift,
  };
}
