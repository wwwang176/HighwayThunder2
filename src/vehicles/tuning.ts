import type { CarParams } from './handling';

/**
 * The player's tuning: each knob a trade-off, from -2 to +2 (0: as built), on the car's own CarParams.
 *
 * Two kinds, both calibrated per car (TuneCal, training/tuneCalibrate.train.ts) so that the ends are alike - +2 as
 * far one way as -2 the other on the item's own measure (`metric`, training/tuneMetrics.ts):
 * - 'feel': how it drives, not how fast - the body's lean, the response, how it holds braking turning. Its pace
 *   (braking, launching, cornering grip) is put back as it was: `neutral` (a little more or less grip, or brake).
 * - 'perf': each end better somewhere, worse elsewhere, by as much: `balance` - time measures (s), what the end gains
 *   in some it loses in the others (e.g. low tyre pressure: off the line and braking vs the top end).
 * A knob whose ends don't go two ways on a car (the muscle car's springs on their bump stops) stays as written there:
 * whatever it does.
 */
export type TuneKey =
  | 'finalDrive' | 'nitro'
  | 'springs' | 'dampers' | 'antiRoll'
  | 'pressure' | 'width' | 'camber'
  | 'wing'
  | 'brakeBias' | 'steering'
  | 'esc';

export interface TuneItem {
  key: TuneKey;
  kind: 'feel' | 'perf';
  /** What -2 and +2 are (for the panel and the measurements). */
  left: string;
  right: string;
  /** Its own measure, made the same either way. */
  metric: string;
  /**
   * The change at `x` (-1..1 at the ends, more scaled by the calibration); `b` (perf, with `balance`): the share of
   * its other side's change (1 as written), the calibration's to even out what each end gains and loses.
   */
  apply(p: CarParams, x: number, b: number): void;
  /** perf: the time measures (s) whose changes come to nothing at each end. */
  balance?: string[];
  /** feel: what is held as it was (brake200 by the grip straight on, or by the brakes; lat250 by the cornering grip). */
  neutral?: ('brake200' | 'lat250')[];
  /** feel: brake200 held by the tyres' grip braking only (brakeGrip; not their grip launching too). */
  neutralByBrakes?: boolean;
  /** feel: how far its compensation may go (a share either way; unset: the calibration's own). */
  neutralMax?: number;
  /** Not evened: each end as written (its pace still put back). */
  asWritten?: boolean;
}

/** 2^(k x): a multiplier any x keeps positive (x = 1: 2^k). */
const exp2 = (k: number, x: number) => 2 ** (k * x);

export const TUNE_ITEMS: TuneItem[] = [
  // --- perf ---
  {
    key: 'finalDrive', kind: 'perf', left: 'short gears: quicker off the line, lower top speed', right: 'long gears: higher top speed, slower off the line',
    // (Top speed against acceleration: no evening the two - its top speed only the same up as down.)
    metric: 'vTop',
    apply: (p, x, b) => {
      p.gearScale = exp2(0.11, x); // every gear's top speed
      p.maxSpeed *= exp2(0.11 * b, x); // the limiter with them (b: how much of it)
    },
  },

  {
    key: 'nitro', kind: 'perf', left: 'big jets: a harder push, sooner gone', right: 'small jets: gentler, lasts longer',
    metric: 'nitro3',
    apply: (p, x) => {
      const k = exp2(-0.45, x); // the push; the tank's seconds the other way (as much in all)
      p.nitroForce = k;
      p.nitroBurn = 1 / k;
    },
  },
  {
    key: 'pressure', kind: 'perf', left: 'low pressure: grips slow, squirms fast', right: 'high pressure: grips fast, slides slow; sharp',
    // Cornering grip slow against cornering grip fast, about PRESSURE_PIVOT_KMH (200): as much either way by its
    // making; driving and braking straight as they were. (Weighed against the top end by rolling resistance instead,
    // the soft tyres' drag braked them a third shorter too; their slower sliding falloff launched and braked them
    // better as well.)
    metric: 'lat250', balance: ['lat150', 'lat250'], // (b: where it turns - as much slow as fast)
    apply: (p, x, b) => {
      p.gripPivot = 150 + 50 * b;
      p.gripSpeed = 0.06 * x; // soft: more grip slow, less fast; hard the other way
      p.slipAnglePeak *= exp2(-0.23, x); // (hard: sharper)
    },
  },
  {
    key: 'width', kind: 'perf', left: 'narrow tyres: less drag at speed, less grip', right: 'wide tyres: grip, quick off the line; drag at speed',
    metric: 'lat250', balance: ['t150', 'brakeT', 'top'], // (off the line and braking, against the top end)
    apply: (p, x, b) => {
      p.muPeak *= exp2(0.07, x);
      p.muSlide *= exp2(0.07, x);
      p.dragK *= exp2(0.11 * b, x);
    },
  },
  {
    key: 'camber', kind: 'perf', left: 'little camber: grips straight on (launch, braking)', right: 'more negative camber: grips cornering, less braking / launch',
    metric: 'lat250',
    apply: (p, x) => {
      p.latGrip = (p.latGrip ?? 1) * exp2(0.085, x);
      p.longGrip = (p.longGrip ?? 1) * exp2(-0.085, x);
    },
  },
  {
    key: 'wing', kind: 'perf', left: 'low downforce: fast at the top end, light', right: 'high downforce: planted, brakes shorter; drag',
    metric: 'lat250', balance: ['brakeT', 'top'],
    apply: (p, x, b) => {
      p.downforceK *= exp2(0.5, x);
      p.aeroGrip *= exp2(0.32, x);
      p.dragK *= exp2(0.16 * b, x);
    },
  },
  // --- feel ---
  {
    key: 'springs', kind: 'feel', left: 'soft springs: leans and dives', right: 'stiff springs: flat and sharp',
    metric: 'laneRoll', neutral: ['brake200', 'lat250'],
    apply: (p, x) => {
      p.springK *= exp2(0.45, x);
    },
  },
  {
    key: 'dampers', kind: 'feel', left: 'soft dampers: floats', right: 'firm dampers: settles at once',
    metric: 'laneRoll', neutral: ['brake200', 'lat250'],
    apply: (p, x) => {
      p.damperBump *= exp2(1.3, x);
      p.damperRebound *= exp2(1.3, x);
    },
  },
  {
    key: 'antiRoll', kind: 'feel', left: 'soft anti-roll bars: leans more', right: 'stiff anti-roll bars: stays flat',
    metric: 'laneRoll', neutral: ['brake200', 'lat250'],
    apply: (p, x) => {
      p.antiRollFront *= exp2(1, x);
      p.antiRollRear *= exp2(1, x);
    },
  },
  {
    key: 'steering', kind: 'feel', left: 'slow steering: calm at speed', right: 'quick steering: darts, easy to overdo',
    metric: 'flick', neutral: ['lat250'],
    apply: (p, x) => {
      p.maxSteer *= exp2(0.2, x);
      p.steerRise *= exp2(0.38, x);
    },
  },
  {
    key: 'esc', kind: 'feel', left: 'strong stability control: holds it straight', right: 'little: slides, yours to hold',
    metric: 'laneSlip', neutral: ['lat250'],
    apply: (p, x) => {
      p.escGain *= exp2(-2, x);
      p.escMaxTorque *= exp2(-2, x);
    },
  },
  {
    key: 'brakeBias', kind: 'feel', left: 'forward: steady braking turning', right: 'rearward: the tail steps out braking turning',
    // (Friction moved front to rear braking, the brakes' split with it; its stopping distance kept by the tyres' grip
    // braking (cb: brakeGrip) - the stock split locks the fronts first, so moved rearward it stopped up to 18 m
    // shorter. What changes is how it holds braking turning. Moving the split alone: 18-25 m.)
    metric: 'brakeTurnSlip', neutral: ['brake200'], neutralByBrakes: true, neutralMax: 0.4, asWritten: true, // (evened, the street racer's rearward end spun at 29 deg)
    apply: (p, x) => {
      p.brakeShift = 0.25 * x;
    },
  },
];

/** A tuning: each knob's level (-2..2; missing: 0). */
export type Tuning = Partial<Record<TuneKey, number>>;

/**
 * One end of a knob as calibrated: `s` its scale; `b` (perf) its balance share; `cl`, `ct` (feel) the grip straight
 * on and cornering times these (its pace put back), `cb` the grip braking only (brakeBias).
 */
export interface TuneEnd {
  s: number;
  b?: number;
  cl?: number;
  ct?: number;
  cb?: number;
}

/** A car's calibration: each knob's two ends (missing: as written). */
export type TuneCal = Partial<Record<TuneKey, { lo: TuneEnd; hi: TuneEnd }>>;

/** One knob at `level` (with its end's calibration) onto `p`. */
export function applyKnob(p: CarParams, item: TuneItem, level: number, end: TuneEnd = { s: 1 }): void {
  if (level === 0) return;
  const x = level / 2;
  // (the compensations as far as the knob goes: half at ±1)
  const k = Math.abs(x);
  item.apply(p, x * end.s, end.b ?? 1);
  if (end.cl !== undefined) p.longGrip = (p.longGrip ?? 1) * end.cl ** k;
  if (end.ct !== undefined) p.latGrip = (p.latGrip ?? 1) * end.ct ** k;
  if (end.cb !== undefined) p.brakeGrip = (p.brakeGrip ?? 1) * end.cb ** k;
}

/** `base` as tuned (a copy; `base` untouched), each knob as calibrated by `cal`. */
export function tuned(base: CarParams, tuning: Tuning, cal: TuneCal = {}): CarParams {
  const p: CarParams = { ...base };
  for (const item of TUNE_ITEMS) {
    const level = Math.max(-2, Math.min(2, Math.round(tuning[item.key] ?? 0)));
    if (level === 0) continue;
    const c = cal[item.key];
    applyKnob(p, item, level, c ? (level < 0 ? c.lo : c.hi) : undefined);
  }
  return p;
}
