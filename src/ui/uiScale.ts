/**
 * One zoom for every panel (the race setup's drawer, the tuning, the pop-ups, the pause, the finish): the sizes are
 * in vw, drawn for a 16:9 screen - on a shorter one (wider than 16:9) they all go down by its height against
 * that, no smaller than UI_MIN_ZOOM; past that a panel scrolls (or tightens: the drawer's compact layout).
 * Set on #ui as --ui-z (styles.css: the panels' zoom); the panels that fill the screen's height read uiZoom().
 */
export const UI_MIN_ZOOM = 0.75;

export function uiZoom(w = innerWidth, h = innerHeight): number {
  return Math.max(UI_MIN_ZOOM, Math.min(1, h / ((w * 9) / 16)));
}

/** --ui-z on `root`, now and as the window changes. */
export function applyUiZoom(root: HTMLElement): void {
  const set = () => root.style.setProperty('--ui-z', String(uiZoom()));
  set();
  addEventListener('resize', set);
}
