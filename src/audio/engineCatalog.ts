/**
 * The engine sounds: which recordings each vehicle's engine is made of, and the rpm each was recorded at.
 *
 * The recordings are licensed recordings:
 * they are NOT in this repository, and must never be committed (docs/audio.md). tools/build-engine-audio.ts makes
 * them, from a local copy of the pack, into public/audio/engines.bin (git-ignored); without that file the game runs
 * with its engines silent.
 *
 * Each clip is one steady rev of one engine, a seamless loop. Its rpm: from its harmonics (the engine's firing
 * series), every pair of neighbours confirmed by matching their spectra (the ratio that lines their harmonics up);
 * a pack's numbers are only right relative to each other (what the crossfades need), not the real car's.
 */

/** One recording: where it is in the pack (its folder, its file without .wav) and the rpm it holds. */
export interface EngineClip {
  pack: string;
  file: string;
  rpm: number;
  /**
   * Made into a rev limiter when it's built (tools/build-engine-audio.ts): the fuel cut put on it, `hz` times a
   * second (to a whole number of cuts a lap), each `depthDb` down - for a pack whose own limiter recording won't do.
   */
  stutter?: { hz: number; depthDb: number };
}

/**
 * A vehicle's engine: its clips in rising rpm; its rev limiter (the pack's limiter recording: its top rev, the fuel cut
 * stuttering it about 12 times a second - heard at the redline in its place); its start-up (played once, as the
 * race is started); how much higher than recorded it's all played (1: as recorded).
 */
export interface EngineSet {
  clips: string[];
  limiter: string;
  startup: string;
  pitch: number;
}

export type EngineKind = 'super' | 'muscle' | 'jdm' | 'sedan' | 'truck' | 'container';

/**
 * Every clip, by id (`<pack tag>-<rev>`; each `-limiter` its pack's limiter recording, its rpm by its spectrum against
 * top rev's; each `-startup` its start-up, a one-shot: no rpm).
 */
export const ENGINE_CLIPS: Record<string, EngineClip> = {
  // V10 (a rev below idle left out: it sits below its idle, ~1299 against ~1411).
  'g10-idle': { rpm: 1411 },
  'g10-low': { rpm: 1819 },
  'g10-low-med': { rpm: 2111 },
  'g10-med': { rpm: 2849 },
  'g10-med-high': { rpm: 3368 },
  'g10-high': { rpm: 3697 },
  'g10-very-high': { rpm: 4304 },
  'g10-limiter': { rpm: 4304 },
  'g10-startup': { rpm: 0 },
  // V8 (its idle a lumpy one, no steady harmonics: its rpm from its spectrum against the next
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
  // JDM four (a rev below idle left out, as the V10's): each rev against the idle's spectrum directly.
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
  // sedan four (likewise).
  'i4g-idle': { rpm: 957 },
  'i4g-low': { rpm: 1227 },
  'i4g-low-med': { rpm: 1480 },
  'i4g-med': { rpm: 1908 },
  'i4g-med-high': { rpm: 2016 },
  'i4g-high': { rpm: 2425 },
  'i4g-very-high': { rpm: 2810 },
  'i4g-limiter': { rpm: 2810 },
  'i4g-startup': { rpm: 0 },
  // truck diesel (its idle a six's firing at 30 Hz: 600).
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

/** A pack's steady revs (its rev limiter and its start-up apart). */
const revsOf = (tag: string): string[] =>
  Object.keys(ENGINE_CLIPS).filter((id) => id.startsWith(tag + '-') && id !== `${tag}-limiter` && id !== `${tag}-startup`);
const setOf = (tag: string, pitch = 1): EngineSet =>
  ({ clips: revsOf(tag), limiter: `${tag}-limiter`, startup: `${tag}-startup`, pitch });

/** Each vehicle's engine. The truck: the tractor unit's engine, played higher (lighter, revvier). */
export const ENGINE_SETS: Record<EngineKind, EngineSet> = {
  super: setOf('g10'),
  muscle: setOf('v8c'),
  jdm: setOf('i4j'),
  sedan: setOf('i4g'),
  truck: setOf('trk', 1.2),
  container: setOf('trk'),
};

/**
 * The exhaust's crackle (a backfire's run of pops: one for the run, src/audio/sound.ts): the pack's short muffler
 * crackles, each a one-shot - as heard from inside the car (the player's own) and from outside (everyone else's).
 * Their ids `crackle-in-N` / `crackle-out-N`: tools/build-engine-audio.ts builds them with the engines.
 */
export const CRACKLE_COUNT = 10;
export const crackleClip = (inside: boolean, n: number): { id: string; pack: string; file: string } => inside
  ? { id: `crackle-in-${n}`, pack: 'crackles/Interior', file: `int_c${n}` }
  : { id: `crackle-out-${n}`, pack: 'crackles', file: `c${n}` };

/** Where the built sounds are (under the site's root). */
export const ENGINE_BUNDLE_URL = 'audio/engines.bin';
