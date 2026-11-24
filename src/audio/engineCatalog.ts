/**
 * The engine sounds: which clips each vehicle's engine is made of, and the rpm each was recorded at.
 *
 * The recordings are licensed for use inside the game only: they are NOT in this repository and must never be
 * committed (docs/sound.md). They are built into public/audio/engines.bin (git-ignored) in the private audio
 * repository; without that file the game runs with its engines silent.
 *
 * Each clip is one steady rev of one engine, a seamless loop. Its rpm: from its harmonics (the engine's firing
 * series), every pair of neighbours confirmed by matching their spectra (the ratio that lines their harmonics up);
 * one engine's numbers are only right relative to each other (what the crossfades need), not the real car's.
 */

/** One clip: the rpm it holds. */
export interface EngineClip {
  rpm: number;
  /**
   * Made into a rev limiter when it's built: the fuel cut put on it, `hz` times a second (to a whole number of cuts
   * a lap), each `depthDb` down - for an engine whose own limiter recording won't do.
   */
  stutter?: { hz: number; depthDb: number };
}

/**
 * A vehicle's engine: its clips in rising rpm (on the throttle, pulling); the same revs off it (`offClips`, one for
 * each: the engine overrunning, a deeper note - the idle's its own, the same clip); its rev limiter (its top rev
 * with the fuel cut stuttering it about 12 times a second - heard at the redline in its place); its start-up (played
 * once, as the race is started); how much higher than recorded it's all played (1: as recorded); how much louder
 * than its clips' common loudness it's played (dB; 0: as they are).
 */
export interface EngineSet {
  clips: string[];
  offClips: string[];
  limiter: string;
  startup: string;
  pitch: number;
  gainDb: number;
}

export type EngineKind = 'super' | 'muscle' | 'jdm' | 'sedan' | 'truck' | 'container';

/** A car body's engine: its own, the police SUV the muscle car's (a big engine; no set of its own). */
export const engineOf = (style: 'super' | 'muscle' | 'jdm' | 'suv'): EngineKind => (style === 'suv' ? 'muscle' : style);

/**
 * Every clip, by id (`<engine>-<rev>`; each `-limiter` its rev limiter, its rpm by its spectrum against its top
 * rev's; each `-startup` its start-up, a one-shot: no rpm).
 */
export const ENGINE_CLIPS: Record<string, EngineClip> = {
  // The supercar's V10 (a rev below its idle left out: ~1299 against ~1411).
  'g10-idle': { rpm: 1411 },
  'g10-low': { rpm: 1819 },
  'g10-low-med': { rpm: 2111 },
  'g10-med': { rpm: 2849 },
  'g10-med-high': { rpm: 3368 },
  'g10-high': { rpm: 3697 },
  'g10-very-high': { rpm: 4304 },
  'g10-limiter': { rpm: 4304 },
  'g10-startup': { rpm: 0 },
  // The muscle car's V8 (its idle a lumpy one, no steady harmonics: its rpm from its spectrum against the next
  // three revs').
  'v8c-idle': { rpm: 1920 },
  'v8c-idle-low': { rpm: 2212 },
  'v8c-low': { rpm: 2803 },
  'v8c-low-med': { rpm: 4351 },
  'v8c-med': { rpm: 4800 },
  'v8c-med-high': { rpm: 4961 },
  'v8c-high': { rpm: 5218 },
  'v8c-very-high': { rpm: 5934 },
  // (its own limiter recording a ragged burble, off its top rev's pitch, no steady cut: its top rev, the cut put on it)
  'v8c-limiter': { rpm: 5934, stutter: { hz: 12, depthDb: 16 } },
  'v8c-startup': { rpm: 0 },
  // The JDM's four (a rev below its idle left out, as the V10's): each rev against the idle's spectrum directly.
  'i4j-idle': { rpm: 1388 },
  'i4j-low': { rpm: 1837 },
  'i4j-low-med': { rpm: 2546 },
  'i4j-med': { rpm: 2800 },
  'i4j-med-high': { rpm: 3125 },
  'i4j-high': { rpm: 3254 },
  'i4j-very-high': { rpm: 3398 },
  // (its own limiter recording a smeared roar with no steady pitch to it: likewise its top rev, the cut put on it)
  'i4j-limiter': { rpm: 3398, stutter: { hz: 12, depthDb: 16 } },
  'i4j-startup': { rpm: 0 },
  // The traffic's sedans' four (likewise).
  'i4g-idle': { rpm: 957 },
  'i4g-low': { rpm: 1227 },
  'i4g-low-med': { rpm: 1480 },
  'i4g-med': { rpm: 1908 },
  'i4g-med-high': { rpm: 2016 },
  'i4g-high': { rpm: 2425 },
  'i4g-very-high': { rpm: 2810 },
  'i4g-limiter': { rpm: 2810 },
  'i4g-startup': { rpm: 0 },
  // The trucks' diesel (its idle a six's firing at 30 Hz: 600).
  'trk-idle': { rpm: 600 },
  'trk-idle-low': { rpm: 763 },
  'trk-low': { rpm: 907 },
  'trk-low-med': { rpm: 1075 },
  'trk-med': { rpm: 1246 },
  'trk-med-high': { rpm: 1394 },
  'trk-high': { rpm: 1654 },
  'trk-very-high': { rpm: 1856 },
  'trk-limiter': { rpm: 1851 },
  'trk-startup': { rpm: 0 },
};

/** An engine's steady revs (its rev limiter, its start-up and its revs off the throttle apart). */
const revsOf = (tag: string): string[] =>
  Object.keys(ENGINE_CLIPS).filter((id) => id.startsWith(tag + '-') && id !== `${tag}-limiter` && id !== `${tag}-startup` && !id.endsWith(OFF));
/** A rev's clip off the throttle: its id with this on (each recorded at the same rpm as its rev on it). */
const OFF = '-off';
/** The rev's clip off the throttle (the idle: itself). */
export const offOf = (id: string): string => (id.endsWith('-idle') ? id : id + OFF);
// Every rev but the idle its clip off the throttle too.
for (const id of Object.keys(ENGINE_CLIPS)) {
  const tag = id.slice(0, id.indexOf('-'));
  if (revsOf(tag).includes(id) && offOf(id) !== id) ENGINE_CLIPS[offOf(id)] = { rpm: ENGINE_CLIPS[id].rpm };
}
const setOf = (tag: string, pitch = 1, gainDb = 0): EngineSet =>
  ({ clips: revsOf(tag), offClips: revsOf(tag).map(offOf), limiter: `${tag}-limiter`, startup: `${tag}-startup`, pitch, gainDb });

/**
 * Each vehicle's engine. The truck: the tractor unit's engine, played higher (lighter, revvier). The supercar's V10
 * a little louder: at one loudness with the others it sounded the smaller - a smooth, mid-range note (peaks ~8 dB
 * under the V8's at the same level, its lows 5-10 dB under: what the loudness measure counts least), and the wind
 * and the tyres at its speeds on top of it.
 */
export const ENGINE_SETS: Record<EngineKind, EngineSet> = {
  super: setOf('g10', 1, 3),
  muscle: setOf('v8c'),
  jdm: setOf('i4j'),
  sedan: setOf('i4g'),
  truck: setOf('trk', 1.2),
  container: setOf('trk'),
};

/**
 * The exhaust's pops (one for each backfire flame, src/audio/sound.ts): short muffler crackles, as heard from outside
 * (the camera's behind the car: the player's too, as its engine), CRACKLE_COUNT of them cut into single pops as they
 * are built with the engines - their ids `pop-1`, `pop-2`, ... (as many as were cut).
 */
export const CRACKLE_COUNT = 10;
export const popId = (n: number): string => `pop-${n}`;

/**
 * A near miss's rush of air: winds (steady loops, as heard from outside), a WIND_PIECE s stretch of the middle of
 * each cut out as they are built, their ids `wind-1`, ...; src/audio/sound.ts swells and fades it.
 */
export const WIND_COUNT = 6;
export const WIND_PIECE = 0.8; // s
export const windId = (n: number): string => `wind-${n}`;
/** The wind past the player's car (src/audio/wind.ts): one of the winds whole, a loop as the engines'. */
export const WIND_LOOP = { id: 'wind-loop' };

/**
 * The player's tyre squeal: a skid loop, as heard from outside (9.5 s, the steadiest of four). Built with the engines,
 * a loop as they are.
 */
export const SKID_CLIP = { id: 'skid' };

/** Where the built sounds are (under the site's root). */
export const ENGINE_BUNDLE_URL = 'audio/engines.bin';
