import type { AiDrift, CarParams, DriftAssist } from './handling';
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
  /** Its AI's drift (DriftAssist.ai; none: the driver's own). */
  ai?: AiDrift;
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
  // (not measured). Then the limit 45° (the player's), the drive eased past it (45-60°), the stability control from 55° as
  // it was. Then: past half of it the slide fell on to 45° (the rear's grip spent past its peak, nothing against it till
  // the wall) - the player's: the handbrake swings it to a spring, off the throttle 20° (the hold half as stiff: a
  // spring, not a wall), on full throttle 45°; the push toward the nose on the throttle or off it; the drift's grip
  // eased in over 0.3 s (not measured). Then (the player's: the player holds the throttle on - the steering should
  // set the slide): the rear x0.45 sideways and straight on, the throttle on or off (as it was on full throttle); the
  // slide held to 45° on full lock into the turn, 25° straight, 8° counter-steered (not measured). Then (the player's:
  // the steering too quick, the push too weak to take the bend): the steering's square, followed over 0.4 s; the push
  // 5 -> 8 m/s² (not measured). Then (the player's: the handbrake and the steering fell to 45° and stuck; 45° only for a
  // slide held into the turn, let go it comes back): the spring 60 000 -> 200 000 N·m/rad, at most 80 000 (the front
  // tyres, the rear light, turned it on some 10° past the spring - about 10 000 N·m), the damping 40 000; the angle held
  // from the spring as the drift starts, growing over 1.5 s, coming back over 0.3 s (not measured). Then (the player's:
  // a spring at any slide - at 15° on the throttle it slid on to 25°; let go of everything it comes back straight
  // slowly): pulled to none with the wheel straight or counter-steered (no 25° or 8° any more), to 45° on full lock
  // into the turn; the angle from the slide the drift starts at, back over 1 s; the handbrake's swing let be (not
  // measured). Then (the player's: smoother - no switch at 12°): as much drift as it slides, none to 2°, all of it from
  // 12° (smoothstep), none under 25 km/h to all of it from 35; the handbrake all of it, fading over 0.5 s after (the
  // on/off, its 6° for 0.3 s end and its 0.3 s ease-in dropped) (not measured). Then (the player's: the handbrake
  // turned it round at once - all of the drift, the rear's grip dropped and the throttle's turn at once): the handbrake
  // only by the slide it starts, and the stability control on it as without it, by the slide too. Then (still too
  // quick): the spring on the handbrake too - its swing as quick as the angle held grows to the steering's (1.5 s))
  drift: {
    minSpeed: 25 / 3.6,
    fullSpeed: 35 / 3.6,
    from: (1 * Math.PI) / 180, // (the player's: 2° at first, then from any slide, then 3°; now 1°)
    full: (6 * Math.PI) / 180, // (the player's: 12° at first, then 6°, then 10°; back to 6°)
    escFrom: (55 * Math.PI) / 180,
    escFull: (75 * Math.PI) / 180,
    rearGrip: 0.45,
    limit: (45 * Math.PI) / 180,
    steerUp: 1.5,
    steerDown: 1,
    hold: 200_000,
    damp: 40_000,
    holdMax: 80_000,
    powerFrom: (45 * Math.PI) / 180,
    powerTo: (60 * Math.PI) / 180,
    least: 0.3,
    // (the player's: on the throttle it took the bend wider - 8 m/s² turned it 27°/s at 60 km/h, 21 at 80; on full
    // throttle 6 m/s² more (14: 48°/s at 60, 36 at 80); a set turning whatever the speed was not what the player meant)
    carve: 8,
    carveOn: 6,
    // (the player's: on the throttle the slide more, the spring as it was - against its 200 000 N·m a rad; 35 000 at
    // first, some 10° past what the steering sets on full throttle: too much, a quarter of it - some 2.5°)
    spin: 8_750,
    carveFull: (15 * Math.PI) / 180, // (the player's: from 0°, by the slide only - 25° and times the drift's share at first)
    // (the player's car - the AI's drifting as it was tuned: the keyboard racers' way, Need for Speed's - the gas and the
    // steering into the turn the slide more, counter-steering and off the gas less, no ceiling (a ceiling held the gas
    // back: 22° to 45° took 3 s); its drive kept whole - it circles; past 65° the spring, from 70° the stability control)
    arcade: {
      steer: 8_000,
      gas: 15_000, // (the player's: 12 000 too little on the gas, 18 000 too much)
      counter: 8_000, // (15 000: full counter-lock with the gas swung it past straight in under a second)
      lift: 12_000, // (the player's: 6 000 let the slide down too slowly off the gas)
      align: 34_000, // (full lock and full throttle held at 46° with gas 15 000 - 30 000 let it on to 51°; 60 000 held it at 23°)
      damp: 30_000,
      dampMax: 60_000,
      safe: (65 * Math.PI) / 180,
      escFrom: (70 * Math.PI) / 180,
      escFull: (85 * Math.PI) / 180,
      // (in from 1° of slide on any: a lane change's slide turned it round on the straight - the keyboard's lane change,
      // 0.1-0.3 s taps, the wheel all the way over, 1.5-5° of slide on grip; on the wheel past half held 0.4 s: a long
      // bend held on grip slid out)
      enterSteer: 0.5,
      enterArm: 0.5,
      // (3° at any speed: still too easily in on the fast straights)
      enterFrom: (3 * Math.PI) / 180,
      enterFromFast: (6 * Math.PI) / 180,
      enterSlow: 50 / 3.6,
      enterFast: 150 / 3.6,
      enterFull: (10 * Math.PI) / 180,
      enterRate: 6,
    },
  },
};

/**
 * Each car's own (by its id) over MOUNTAIN_SETUP. The muscle car: its tail is loose already (its power, its light
 * stability control) - with the rear bar stiffer, the brakes rearward and less stability control it slid wide and
 * spun; those as built. Their AI's drift (ai): the throttle (solo on 10 roads, 0.6-0.85 tried) - the others on 0.62
 * slid 19-23°, hardly drifting. The muscle car's power slid it furthest: on 0.62 its handbrake as the others' it slid
 * 25°, looking all but on its grip; on more throttle it ran wide in the bend's second half (at the outside's edge as
 * its drift ended) and hit the wall - eased off the throttle there, held nose-in out of it, more throttle on it wide
 * of its line: 28° at most, or the walls. Its handbrake pulled sooner (looked for 1 s on, 0.6) and longer (0.15 s,
 * 0.1) caught it: on 0.9 35°, 2.6 s faster, 18 walls on 30 roads (15); the others on it more walls, less slide.
 */
export const MOUNTAIN_SETUP_BY_CAR: Record<string, Partial<MountainSetup>> = {
  'street-racer': { ai: { gas: 0.85 } },
  'muscle-car': { arbRear: 1, brakeBias: 0, esc: 1, ai: { gas: 0.9, pullLook: 1, hbPulse: 0.15 } },
  jdm: { ai: { gas: 0.8 } },
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
    drift: s.ai === undefined ? s.drift : { ...s.drift, ai: s.ai },
  };
}
