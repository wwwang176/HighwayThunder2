import { t, type Key } from './i18n';

/**
 * The loading screen (index.html's #loading: there before any script, so nothing shows half-built): the game's
 * name as at the title, a bar of slanted segments lighting up, the step and its percent. Over the page as the
 * game starts (the car files, the physics, the scene and its shaders), and over the black as a race is set up.
 * Each step waits for its frame to be drawn: the work after it holds the page, and without it the bar would sit
 * where it was until the end.
 */

/** The bar's segments (index.html's <i>s). */
export const LOADING_SEGMENTS = 24;
/** Seconds it holds at its start and its end: a cached load is over in a frame, and a bar flashing by reads as a glitch. */
export const LOADING_HOLD = 0.12;
/** Seconds it fades out over. */
const FADE_OUT = 0.35;

/** A share done (0..1) as a percent, clamped (a broken one: 0 %). */
export function loadingPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}

/** How many of `n` segments a share done lights (a segment once reached, all at the end). */
export function segmentsLit(fraction: number, n = LOADING_SEGMENTS): number {
  return Math.round((loadingPercent(fraction) / 100) * n);
}

/** Done `done` of `total` (none to do: all done). */
export function shareDone(done: number, total: number): number {
  return total > 0 ? Math.min(1, Math.max(0, done / total)) : 1;
}

/** Until the browser has drawn a frame (the first rAF runs before it, the second after). */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

const wait = (s: number) => new Promise<void>((resolve) => setTimeout(resolve, s * 1000));

export class LoadingScreen {
  private readonly step: HTMLElement;
  private readonly pct: HTMLElement;
  private readonly segs: HTMLElement[];
  private hideTimer = 0;

  constructor(private readonly el: HTMLElement = document.getElementById('loading')!) {
    this.step = el.querySelector('.ld-step')!;
    this.pct = el.querySelector('.ld-pct')!;
    this.segs = [...el.querySelectorAll<HTMLElement>('.ld-seg i')];
  }

  /** Over the screen again from 0 (a race being set up), in `accent` (the player's car's). */
  show(accent?: string): void {
    clearTimeout(this.hideTimer);
    if (accent) this.el.style.setProperty('--accent', accent);
    this.set('loading.preparing', 0);
    this.el.classList.remove('out');
    this.el.hidden = false;
  }

  /** The step and how far along, drawn on the next frame (for progress as files come in: the page draws on). */
  set(label: Key, fraction: number): void {
    this.step.textContent = t(label);
    const p = loadingPercent(fraction);
    this.pct.textContent = `${p}%`;
    const lit = segmentsLit(fraction, this.segs.length);
    this.segs.forEach((s, i) => s.classList.toggle('on', i < lit));
  }

  /** Its start shown (held LOADING_HOLD s) before the work. */
  async hold(): Promise<void> {
    await nextPaint();
    await wait(LOADING_HOLD);
  }

  /** The next step, back once it is on the screen (the work after it may hold the page). */
  async next(label: Key, fraction: number): Promise<void> {
    this.set(label, fraction);
    await nextPaint();
  }

  /** At 100 %, held a moment, then faded out. */
  async finish(label: Key): Promise<void> {
    this.set(label, 1);
    await nextPaint();
    await wait(LOADING_HOLD);
    this.el.classList.add('out');
    this.hideTimer = window.setTimeout(() => (this.el.hidden = true), FADE_OUT * 1000);
  }
}
