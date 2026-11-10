import type { TuneKey } from './tuning';

/** A knob's change to the garage's three stats at one end: 0-100 (s), top speed (km/h), grip (g). */
export interface TuneEffect {
  t100: number;
  vTop: number;
  grip: number;
}

/**
 * What each knob does to the garage's stats, each car, at -2 and +2 as calibrated (training/tuneMeasure.train.ts:
 * 0-100, top speed, the sideways grip at 150 and 250 km/h): the garage shows the tuned car's stats by them.
 */
export const TUNE_EFFECTS: Record<string, Partial<Record<TuneKey, { lo: TuneEffect; hi: TuneEffect }>>> = { "street-racer": { "finalDrive": { "lo": { "t100": -0.058, "vTop": -22.8, "grip": 0.014 }, "hi": { "t100": 0.008, "vTop": 22.8, "grip": -0.005 } }, "nitro": { "lo": { "t100": 0, "vTop": 0, "grip": 0 }, "hi": { "t100": 0, "vTop": 0, "grip": 0 } }, "pressure": { "lo": { "t100": -0.008, "vTop": 0, "grip": 0 }, "hi": { "t100": 0, "vTop": 0, "grip": 0 } }, "width": { "lo": { "t100": 0.183, "vTop": 0, "grip": -0.092 }, "hi": { "t100": -0.192, "vTop": 0, "grip": 0.091 } }, "camber": { "lo": { "t100": -0.25, "vTop": 0, "grip": -0.108 }, "hi": { "t100": 0.225, "vTop": 0, "grip": 0.106 } }, "wing": { "lo": { "t100": 0.008, "vTop": 0, "grip": -0.233 }, "hi": { "t100": -0.017, "vTop": 0, "grip": 0.231 } }, "springs": { "lo": { "t100": -0.058, "vTop": 0, "grip": -0.02 }, "hi": { "t100": 0.025, "vTop": 0, "grip": 0.004 } }, "dampers": { "lo": { "t100": -0.025, "vTop": 0, "grip": 0.006 }, "hi": { "t100": -0.042, "vTop": 0, "grip": 0.005 } }, "antiRoll": { "lo": { "t100": 0, "vTop": 0, "grip": 0.001 }, "hi": { "t100": 0, "vTop": 0, "grip": 0 } }, "steering": { "lo": { "t100": 0, "vTop": 0, "grip": 0 }, "hi": { "t100": 0, "vTop": 0, "grip": 0 } }, "esc": { "lo": { "t100": 0, "vTop": 0, "grip": 0.021 }, "hi": { "t100": 0, "vTop": 0, "grip": -0.001 } }, "brakeBias": { "lo": { "t100": 0, "vTop": 0, "grip": 0 }, "hi": { "t100": 0, "vTop": 0, "grip": 0 } } }, "muscle-car": { "finalDrive": { "lo": { "t100": -0.058, "vTop": -19.7, "grip": -0.002 }, "hi": { "t100": 0.083, "vTop": 19.7, "grip": -0.001 } }, "nitro": { "lo": { "t100": 0, "vTop": 0, "grip": 0 }, "hi": { "t100": 0, "vTop": 0, "grip": 0 } }, "pressure": { "lo": { "t100": 0, "vTop": 0, "grip": -0.008 }, "hi": { "t100": 0.008, "vTop": 0, "grip": -0.002 } }, "width": { "lo": { "t100": 0.267, "vTop": 0, "grip": -0.061 }, "hi": { "t100": -0.217, "vTop": 0, "grip": 0.043 } }, "camber": { "lo": { "t100": -0.317, "vTop": 0, "grip": -0.115 }, "hi": { "t100": 0.308, "vTop": 0, "grip": 0.066 } }, "wing": { "lo": { "t100": 0.025, "vTop": 0, "grip": -0.109 }, "hi": { "t100": -0.017, "vTop": 0, "grip": 0.089 } }, "springs": { "lo": { "t100": 0.058, "vTop": 0, "grip": 0.002 }, "hi": { "t100": -0.15, "vTop": 0, "grip": -0.028 } }, "dampers": { "lo": { "t100": -0.067, "vTop": 0, "grip": -0.015 }, "hi": { "t100": 0.108, "vTop": 0, "grip": -0.043 } }, "antiRoll": { "lo": { "t100": 0.008, "vTop": 0, "grip": 0.013 }, "hi": { "t100": 0, "vTop": 0, "grip": -0.013 } }, "steering": { "lo": { "t100": 0.008, "vTop": 0, "grip": 0.002 }, "hi": { "t100": 0, "vTop": 0, "grip": -0.013 } }, "esc": { "lo": { "t100": 0.017, "vTop": 0, "grip": -0.012 }, "hi": { "t100": 0.008, "vTop": 0, "grip": 0.002 } }, "brakeBias": { "lo": { "t100": 0, "vTop": 0, "grip": 0 }, "hi": { "t100": 0, "vTop": 0, "grip": 0 } } }, "jdm": { "finalDrive": { "lo": { "t100": -0.05, "vTop": -18.6, "grip": 0.017 }, "hi": { "t100": 0.042, "vTop": 18.6, "grip": -0.001 } }, "nitro": { "lo": { "t100": 0, "vTop": 0, "grip": 0 }, "hi": { "t100": 0, "vTop": 0, "grip": 0 } }, "pressure": { "lo": { "t100": 0, "vTop": 0, "grip": 0 }, "hi": { "t100": 0, "vTop": 0, "grip": 0 } }, "width": { "lo": { "t100": 0.208, "vTop": 0, "grip": -0.101 }, "hi": { "t100": -0.167, "vTop": 0, "grip": 0.099 } }, "camber": { "lo": { "t100": -0.225, "vTop": 0, "grip": -0.125 }, "hi": { "t100": 0.258, "vTop": 0, "grip": 0.123 } }, "wing": { "lo": { "t100": 0.008, "vTop": 0, "grip": -0.263 }, "hi": { "t100": 0, "vTop": 0, "grip": 0.258 } }, "springs": { "lo": { "t100": -0.017, "vTop": 0, "grip": -0.005 }, "hi": { "t100": -0.042, "vTop": 0, "grip": 0.005 } }, "dampers": { "lo": { "t100": -0.025, "vTop": 0, "grip": -0.001 }, "hi": { "t100": -0.008, "vTop": 0, "grip": 0.003 } }, "antiRoll": { "lo": { "t100": 0, "vTop": 0, "grip": 0.002 }, "hi": { "t100": 0, "vTop": 0, "grip": -0.001 } }, "steering": { "lo": { "t100": 0, "vTop": 0, "grip": 0.001 }, "hi": { "t100": 0, "vTop": 0, "grip": 0 } }, "esc": { "lo": { "t100": 0, "vTop": 0, "grip": 0.019 }, "hi": { "t100": 0, "vTop": 0, "grip": -0.038 } }, "brakeBias": { "lo": { "t100": 0, "vTop": 0, "grip": 0 }, "hi": { "t100": 0, "vTop": 0, "grip": 0 } } } };

/** The stats' change for a car tuned so (each knob its end's, half of it at ±1; added up). */
export function tunedStats(carId: string, tuning: Partial<Record<TuneKey, number>>): TuneEffect {
  const sum: TuneEffect = { t100: 0, vTop: 0, grip: 0 };
  const effects = TUNE_EFFECTS[carId] ?? {};
  for (const [key, level] of Object.entries(tuning) as [TuneKey, number][]) {
    const e = effects[key];
    if (!e || !level) continue;
    const end = level < 0 ? e.lo : e.hi;
    const k = Math.min(2, Math.abs(level)) / 2;
    sum.t100 += end.t100 * k;
    sum.vTop += end.vTop * k;
    sum.grip += end.grip * k;
  }
  return sum;
}
