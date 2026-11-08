/**
 * The picture's quality (the settings pop-up: Garage): how finely the race is drawn, as the renderer's pixel ratio.
 * Plain data and functions, and the setting's reading and keeping.
 *
 * Each level is an absolute pixel ratio, the same load on any screen: Balanced draws one pixel per CSS pixel on a
 * desktop and a laptop alike. A level finer than the screen's own (its devicePixelRatio) does nothing: it is drawn
 * as the screen's, and greyed in the pop-up (qualityAvailable). The HUD is HTML: its words stay sharp at any level.
 * (Drawn at the 150 % laptop screen's 1.5, the race's GPU took twice Balanced's: ~20 ms a frame.)
 */
import type { Key } from '../ui/i18n';

export interface QualityLevel {
  /** Its name (i18n). */
  readonly label: Key;
  /** The renderer's pixel ratio (no finer than the screen's: pixelRatioFor). */
  readonly pixelRatio: number;
}

/** Finest first (the pop-up's order). Named by how the picture looks and runs, not by its numbers. */
export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { label: 'quality.ultra', pixelRatio: 2 },
  { label: 'quality.sharp', pixelRatio: 1.5 },
  { label: 'quality.balanced', pixelRatio: 1 },
  { label: 'quality.smooth', pixelRatio: 0.75 },
  { label: 'quality.fast', pixelRatio: 0.5 },
];

/** Never set: Balanced. */
export const DEFAULT_QUALITY = 1;

/** Never finer than this, whatever the screen (a 4K laptop's 3 would draw more than twice 2's pixels). */
const MAX_PIXEL_RATIO = 2;

/** The finest this screen shows: its own ratio, at most MAX_PIXEL_RATIO. */
function deviceCap(devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, MAX_PIXEL_RATIO);
}

/** A level's pixel ratio as drawn on this screen: the level's, no finer than the screen's (anything broken: the default). */
export function pixelRatioFor(pixelRatio: number, devicePixelRatio: number): number {
  const q = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : DEFAULT_QUALITY;
  return Math.min(q, deviceCap(devicePixelRatio));
}

/** Whether a level shows on this screen: still finer than the next one down once capped (the lowest always does). */
export function qualityAvailable(pixelRatio: number, devicePixelRatio: number): boolean {
  const i = QUALITY_LEVELS.findIndex((q) => q.pixelRatio === pixelRatio);
  const lower = QUALITY_LEVELS[i + 1];
  return i < 0 || lower === undefined || lower.pixelRatio < deviceCap(devicePixelRatio);
}

const QUALITY_KEY = 'ht2.pixelRatio';

/** The level kept (only one of QUALITY_LEVELS; anything else, or storage off: the default). */
export function readQuality(): number {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return QUALITY_LEVELS.find((q) => String(q.pixelRatio) === v)?.pixelRatio ?? DEFAULT_QUALITY;
  } catch {
    return DEFAULT_QUALITY;
  }
}

/** Keep it for the next visit (storage full or off: not kept, the game goes on). */
export function saveQuality(pixelRatio: number): void {
  try {
    localStorage.setItem(QUALITY_KEY, String(pixelRatio));
  } catch {
    // Nothing to do: the next visit starts at the default.
  }
}
